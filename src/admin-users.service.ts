import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ProfileRow } from './profiles.service';
import { CreateUserRequest, UpdateUserRequest } from './admin-users.types';

export interface UserWithProfile {
  id: string;
  email: string;
  created_at: string;
  email_confirmed_at?: string;
  last_sign_in_at?: string;
  profile: ProfileRow;
}

export interface UserListResponse {
  users: UserWithProfile[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UserStats {
  totalUsers: number;
  students: number;
  teachers: number;
  admins: number;
  activeUsers: number;
  newUsersThisMonth: number;
}

@Injectable()
export class AdminUsersService {
  private supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  private restUrl = `${this.supabaseUrl}/rest/v1`;
  private authUrl = `${this.supabaseUrl}/auth/v1/admin`;
  private serviceKey = process.env.SUPABASE_SERVICE_ROLE;

  private headers() {
    const sk = this.serviceKey?.trim();
    const looksJwt = sk && sk.split('.').length === 3 && sk.length > 60;
    if (!looksJwt) {
      throw new InternalServerErrorException(
        'SUPABASE_SERVICE_ROLE is not set to a valid service role key. Please set the full service role JWT from Supabase Project Settings > API.',
      );
    }
    return {
      apikey: sk,
      Authorization: `Bearer ${sk}`,
      'Content-Type': 'application/json',
    };
  }

  private async getDefaultOrgId(): Promise<string> {
    try {
      // First, try to get existing default org
      const orgsResponse = await fetch(`${this.restUrl}/orgs?name=eq.Default`, {
        headers: this.headers(),
      });

      if (!orgsResponse.ok) {
        throw new InternalServerErrorException(
          'Failed to check for existing orgs',
        );
      }

      const orgs = await orgsResponse.json();

      if (orgs.length > 0) {
        return orgs[0].id;
      }

      // Create default org if it doesn't exist
      const createOrgResponse = await fetch(`${this.restUrl}/orgs`, {
        method: 'POST',
        headers: {
          ...this.headers(),
          Prefer: 'return=representation',
        },
        body: JSON.stringify([{ name: 'Default' }]),
      });

      if (!createOrgResponse.ok) {
        throw new InternalServerErrorException('Failed to create default org');
      }

      const newOrgs = await createOrgResponse.json();
      return newOrgs[0].id;
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to get default org: ${error.message}`,
      );
    }
  }

  async getUsers(params: {
    page: number;
    limit: number;
    search?: string;
    role?: 'student' | 'teacher' | 'admin';
  }): Promise<UserListResponse> {
    const { page, limit, search, role } = params;
    const offset = (page - 1) * limit;

    try {
      // Build query filters using PostgREST syntax (column=operator.value)
      const filterClauses: [string, string][] = [];
      if (role) {
        filterClauses.push(['role', `eq.${role}`]);
      }
      if (search) {
        filterClauses.push(['full_name', `ilike.*${search}*`]);
      }

      // Get profiles with filters
      const profilesParams = new URLSearchParams();
      profilesParams.set('select', '*');
      profilesParams.set('offset', offset.toString());
      profilesParams.set('limit', limit.toString());
      profilesParams.append('order', 'created_at.desc');
      for (const [key, value] of filterClauses) {
        profilesParams.append(key, value);
      }

      const profilesUrl = `${this.restUrl}/profiles?${profilesParams.toString()}`;

      const profilesResponse = await fetch(profilesUrl, {
        headers: this.headers(),
      });

      if (!profilesResponse.ok) {
        throw new InternalServerErrorException('Failed to fetch user profiles');
      }

      const profiles = (await profilesResponse.json()) as ProfileRow[];

      // Get total count with the same filters
      const countParams = new URLSearchParams();
      countParams.set('select', 'id');
      for (const [key, value] of filterClauses) {
        countParams.append(key, value);
      }

      const countResponse = await fetch(
        `${this.restUrl}/profiles?${countParams.toString()}`,
        {
          method: 'HEAD',
          headers: { ...this.headers(), Prefer: 'count=exact' },
        },
      );

      if (!countResponse.ok) {
        throw new InternalServerErrorException(
          'Failed to fetch total user count',
        );
      }

      const contentRange = countResponse.headers.get('content-range');
      const totalCount = contentRange
        ? parseInt(contentRange.split('/')[1] || '0', 10)
        : offset + profiles.length;

      // Get auth user data for each profile
      const users: UserWithProfile[] = [];

      for (const profile of profiles) {
        try {
          const userResponse = await fetch(
            `${this.authUrl}/users/${profile.id}`,
            {
              headers: this.headers(),
            },
          );

          if (userResponse.ok) {
            const authUser = await userResponse.json();
            users.push({
              id: authUser.id,
              email: authUser.email,
              created_at: authUser.created_at,
              email_confirmed_at: authUser.email_confirmed_at,
              last_sign_in_at: authUser.last_sign_in_at,
              profile,
            });
          } else {
            // If auth user not found, still include profile data
            users.push({
              id: profile.id,
              email: 'unknown@example.com',
              created_at: new Date().toISOString(),
              profile,
            });
          }
        } catch (error) {
          // If individual user fetch fails, skip to avoid breaking entire list
          console.warn(`Failed to fetch user ${profile.id}:`, error);
        }
      }

      return {
        users,
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to fetch users: ${error.message}`,
      );
    }
  }

  async getUser(userId: string): Promise<UserWithProfile> {
    try {
      // Get auth user
      const userResponse = await fetch(`${this.authUrl}/users/${userId}`, {
        headers: this.headers(),
      });

      if (!userResponse.ok) {
        throw new NotFoundException('User not found');
      }

      const authUser = await userResponse.json();

      // Get profile
      const profileResponse = await fetch(
        `${this.restUrl}/profiles?id=eq.${userId}`,
        {
          headers: this.headers(),
        },
      );

      if (!profileResponse.ok) {
        throw new InternalServerErrorException('Failed to fetch user profile');
      }

      const profiles = (await profileResponse.json()) as ProfileRow[];
      const profile = profiles[0];

      if (!profile) {
        throw new NotFoundException('User profile not found');
      }

      return {
        id: authUser.id,
        email: authUser.email,
        created_at: authUser.created_at,
        email_confirmed_at: authUser.email_confirmed_at,
        last_sign_in_at: authUser.last_sign_in_at,
        profile,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to fetch user: ${error.message}`,
      );
    }
  }

  async createUser(
    createUserRequest: CreateUserRequest,
  ): Promise<UserWithProfile> {
    // console.log('create user admin service');
    // console.log(`${this.authUrl}`);
    // console.log(createUserRequest);
    try {
      // Get or create default org
      const defaultOrgId = await this.getDefaultOrgId();

      // Check if user already exists by email first
      // const existingUserResponse = await fetch(`${this.authUrl}/users?email=${encodeURIComponent(createUserRequest.email)}`, {
      //   headers: this.headers(),
      // });

      // if (existingUserResponse.ok) {
      //   const existingUsers = await existingUserResponse.json();
      //   if (existingUsers.users && existingUsers.users.length > 0) {
      //     throw new BadRequestException(`User with email ${createUserRequest.email} already exists`);
      //   }
      // }

      // Create auth user
      const authResponse = await fetch(`${this.authUrl}/users`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          email: createUserRequest.email,
          password: createUserRequest.password,
          email_confirm: true,
          user_metadata: {
            full_name: createUserRequest.full_name,
          },
        }),
      });

      if (!authResponse.ok) {
        const error = await authResponse.text();
        throw new BadRequestException(`Failed to create user: ${error}`);
      }

      const authUser = await authResponse.json();

      // Check if profile already exists for this user ID
      const existingProfileResponse = await fetch(
        `${this.restUrl}/profiles?id=eq.${authUser.id}`,
        {
          headers: this.headers(),
        },
      );

      if (existingProfileResponse.ok) {
        const existingProfiles = await existingProfileResponse.json();
        if (existingProfiles.length > 0) {
          // Profile already exists, update it instead of creating new one
          const updateResponse = await fetch(
            `${this.restUrl}/profiles?id=eq.${authUser.id}`,
            {
              method: 'PATCH',
              headers: {
                ...this.headers(),
                Prefer: 'return=representation',
              },
              body: JSON.stringify({
                org_id: defaultOrgId,
                role: createUserRequest.role,
                full_name: createUserRequest.full_name,
                mobile: createUserRequest.mobile,
                education: createUserRequest.education,
                graduation_year: createUserRequest.graduation_year,
                domain: createUserRequest.domain,
                profession: createUserRequest.profession,
                location: createUserRequest.location,
                current_institute: createUserRequest.current_institute,
              }),
            },
          );

          if (!updateResponse.ok) {
            // If update fails, clean up auth user and throw error
            await this.cleanupAuthUser(authUser.id);
            const error = await updateResponse.text();
            throw new InternalServerErrorException(
              `Failed to update existing user profile: ${error}`,
            );
          }

          const updatedProfiles = (await updateResponse.json()) as ProfileRow[];
          return {
            id: authUser.id,
            email: authUser.email,
            created_at: authUser.created_at,
            email_confirmed_at: authUser.email_confirmed_at,
            last_sign_in_at: authUser.last_sign_in_at,
            profile: updatedProfiles[0],
          };
        }
      }

      // Create profile
      const profileData: Partial<ProfileRow> = {
        id: authUser.id,
        org_id: defaultOrgId,
        role: createUserRequest.role,
        full_name: createUserRequest.full_name,
        mobile: createUserRequest.mobile,
        education: createUserRequest.education,
        graduation_year: createUserRequest.graduation_year,
        domain: createUserRequest.domain,
        profession: createUserRequest.profession,
        location: createUserRequest.location,
        current_institute: createUserRequest.current_institute,
      };

      const profileResponse = await fetch(`${this.restUrl}/profiles`, {
        method: 'POST',
        headers: {
          ...this.headers(),
          Prefer: 'return=representation',
        },
        body: JSON.stringify([profileData]),
      });

      if (!profileResponse.ok) {
        // If profile creation fails, delete the auth user
        await this.cleanupAuthUser(authUser.id);

        const error = await profileResponse.text();
        throw new InternalServerErrorException(
          `Failed to create user profile: ${error}`,
        );
      }

      const profiles = (await profileResponse.json()) as ProfileRow[];

      return {
        id: authUser.id,
        email: authUser.email,
        created_at: authUser.created_at,
        email_confirmed_at: authUser.email_confirmed_at,
        last_sign_in_at: authUser.last_sign_in_at,
        profile: profiles[0],
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to create user: ${error.message}`,
      );
    }
  }

  private async cleanupAuthUser(userId: string): Promise<void> {
    try {
      const deleteResponse = await fetch(`${this.authUrl}/users/${userId}`, {
        method: 'DELETE',
        headers: this.headers(),
      });

      if (!deleteResponse.ok) {
        console.warn(
          `Failed to cleanup auth user ${userId} after profile creation failure`,
        );
      }
    } catch (error) {
      console.warn(`Error during auth user cleanup for ${userId}:`, error);
    }
  }

  async updateUser(
    userId: string,
    updateUserRequest: UpdateUserRequest,
  ): Promise<UserWithProfile> {
    try {
      // Update profile
      const profileResponse = await fetch(
        `${this.restUrl}/profiles?id=eq.${userId}`,
        {
          method: 'PATCH',
          headers: {
            ...this.headers(),
            Prefer: 'return=representation',
          },
          body: JSON.stringify(updateUserRequest),
        },
      );

      if (!profileResponse.ok) {
        throw new InternalServerErrorException('Failed to update user profile');
      }

      const profiles = (await profileResponse.json()) as ProfileRow[];

      if (profiles.length === 0) {
        throw new NotFoundException('User profile not found');
      }

      // Update auth user if full_name changed
      if (updateUserRequest.full_name) {
        await fetch(`${this.authUrl}/users/${userId}`, {
          method: 'PUT',
          headers: this.headers(),
          body: JSON.stringify({
            user_metadata: {
              full_name: updateUserRequest.full_name,
            },
          }),
        });
      }

      return this.getUser(userId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to update user: ${error.message}`,
      );
    }
  }

  async deleteUser(userId: string): Promise<{ message: string }> {
    try {
      // Delete profile first
      const profileResponse = await fetch(
        `${this.restUrl}/profiles?id=eq.${userId}`,
        {
          method: 'DELETE',
          headers: this.headers(),
        },
      );

      if (!profileResponse.ok && profileResponse.status !== 404) {
        throw new InternalServerErrorException('Failed to delete user profile');
      }

      // Delete auth user
      const authResponse = await fetch(`${this.authUrl}/users/${userId}`, {
        method: 'DELETE',
        headers: this.headers(),
      });

      if (!authResponse.ok && authResponse.status !== 404) {
        throw new InternalServerErrorException(
          'Failed to delete user from auth',
        );
      }

      return { message: 'User deleted successfully' };
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to delete user: ${error.message}`,
      );
    }
  }

  async getUserStats(): Promise<UserStats> {
    try {
      // Get total users and role counts
      const statsResponse = await fetch(
        `${this.restUrl}/profiles?select=role,created_at`,
        {
          headers: this.headers(),
        },
      );

      if (!statsResponse.ok) {
        throw new InternalServerErrorException(
          'Failed to fetch user statistics',
        );
      }

      const profiles = (await statsResponse.json()) as {
        role: string;
        created_at?: string;
      }[];

      const totalUsers = profiles.length;
      const students = profiles.filter((p) => p.role === 'student').length;
      const teachers = profiles.filter((p) => p.role === 'teacher').length;
      const admins = profiles.filter((p) => p.role === 'admin').length;

      // Calculate new users this month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const newUsersThisMonth = profiles.filter((p) => {
        if (!p.created_at) return false;
        const createdDate = new Date(p.created_at);
        return createdDate >= startOfMonth;
      }).length;

      // Get active users (users who signed in within last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // This would require querying auth.users table for last_sign_in_at
      // For now, we'll use a simple estimate
      const activeUsers = Math.round(totalUsers * 0.7); // 70% active rate estimate

      return {
        totalUsers,
        students,
        teachers,
        admins,
        activeUsers,
        newUsersThisMonth,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to fetch user stats: ${error.message}`,
      );
    }
  }
}
