import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  SupabaseClient,
  createClient,
  Session,
  User,
} from '@supabase/supabase-js';
import { SignJWT, jwtVerify } from 'jose';
import { UserLoginDto, UserLoginResponseDto } from './user-auth.dto';
import { GamificationService } from '../gamification.service';

@Injectable()
export class UserAuthService {
  private readonly logger = new Logger(UserAuthService.name);
  private supabase: SupabaseClient;
  private restUrl: string;
  private serviceKey: string;

  constructor(private readonly gamificationService: GamificationService) {
    const supabaseUrl =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE environment variables are required',
      );
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.restUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1`;
    this.serviceKey = supabaseKey;
  }

  /**
   * Helper method to make REST API calls with service role authentication
   */
  private async makeServiceRoleRequest(
    endpoint: string,
    method: string = 'GET',
    body?: any,
    preferHeader?: string,
  ): Promise<any> {
    try {
      const headers: Record<string, string> = {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        'Content-Type': 'application/json',
      };

      if (preferHeader) {
        headers.Prefer = preferHeader;
      }

      const response = await fetch(`${this.restUrl}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Request failed: ${response.status} - ${errorText}`);
      }

      const responseText = await response.text();
      if (!responseText || responseText.trim() === '') {
        this.logger.warn(`Empty response received from ${endpoint}`);
        return []; // Return empty array for empty responses to maintain consistency
      }

      try {
        return JSON.parse(responseText);
      } catch (parseError) {
        this.logger.error(
          `Failed to parse JSON response from ${endpoint}: ${parseError.message}`,
        );
        this.logger.error(`Response text: ${responseText}`);
        throw new Error(`Invalid JSON response: ${parseError.message}`);
      }
    } catch (error) {
      this.logger.error(`Service role request failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get or create the default organization ID
   * This ensures we have a valid org_id for profile creation
   */
  private async getDefaultOrgId(): Promise<string> {
    try {
      this.logger.log('Attempting to get or create default organization');

      // First, try to get existing default org
      const orgs = await this.makeServiceRoleRequest(
        '/orgs?name=eq.Default',
        'GET',
      );

      this.logger.log(`Found ${orgs.length} organizations with name 'Default'`);

      if (orgs.length > 0) {
        const orgId = orgs[0].id;
        this.logger.log(`Using existing default organization: ${orgId}`);
        return orgId;
      }

      this.logger.log(
        'No existing default organization found, creating new one',
      );

      // Create default org if it doesn't exist
      const newOrgs = await this.makeServiceRoleRequest(
        '/orgs',
        'POST',
        [{ name: 'Default' }],
        'return=representation',
      );

      if (!newOrgs || newOrgs.length === 0) {
        this.logger.error('Organization creation returned empty response');
        throw new Error('Organization creation failed: empty response');
      }

      const newOrgId = newOrgs[0].id;
      this.logger.log(`Created new default organization: ${newOrgId}`);
      return newOrgId;
    } catch (error) {
      this.logger.error(`Failed to get default org: ${error.message}`);
      throw new Error('Failed to get default organization');
    }
  }

  async login(userLoginDto: UserLoginDto): Promise<UserLoginResponseDto> {
    const { email, password } = userLoginDto;

    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      this.logger.warn(`SignIn failed for ${email}: ${error.message}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!data || !data.user || !data.session) {
      throw new UnauthorizedException('Authentication failed');
    }

    const authenticatedUser = data.user;
    const authenticatedSession = data.session;
    const roleValue =
      (authenticatedUser.user_metadata?.role as string) || 'student';
    const role = roleValue === 'admin' ? 'admin' : 'student';

    // Use direct REST API calls with service role to avoid RLS issues during login
    try {
      // First, try to get existing profile to preserve onboarding_completed
      let onboardingCompleted = false;

      // Try to get existing profile using our helper method
      try {
        const profiles = await this.makeServiceRoleRequest(
          `/profiles?id=eq.${authenticatedUser.id}&select=onboarding_completed`,
          'GET',
        );
        if (profiles.length > 0) {
          onboardingCompleted = profiles[0].onboarding_completed || false;
        }
      } catch (profileError) {
        this.logger.warn(
          `Failed to fetch existing profile: ${profileError.message}`,
        );
        // Continue with default value if profile fetch fails
      }

      // Get or create default organization
      let orgId = '00000000-0000-0000-0000-000000000000'; // Default fallback
      try {
        orgId = await this.getDefaultOrgId();
      } catch (orgError) {
        this.logger.error(`Failed to get organization: ${orgError.message}`);
        // Continue with fallback orgId if organization fetch fails
      }

      // Upsert profile using our helper method with org_id included
      try {
        await this.makeServiceRoleRequest(
          '/profiles',
          'POST',
          [
            {
              id: authenticatedUser.id,
              org_id: orgId,
              role,
              onboarding_completed: onboardingCompleted,
              updated_at: new Date().toISOString(),
            },
          ],
          'resolution=merge-duplicates',
        );
      } catch (upsertError) {
        this.logger.error(
          `Profile upsert error via REST API: ${upsertError.message}`,
        );
        // Non-fatal, continue with login
      }
    } catch (upsertError) {
      this.logger.error(`Profile upsert failed: ${upsertError.message}`);
      // Non-fatal, continue with login
    }

    // Generate JWT token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new BadRequestException('JWT_SECRET not configured');
    }

    const expirationTime = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours

    const token = await new SignJWT({
      sub: authenticatedUser.id,
      email: authenticatedUser.email,
      role,
      aud: 'authenticated',
      iss: `${process.env.SUPABASE_URL}/auth/v1`,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(expirationTime)
      .setIssuedAt(Date.now() / 1000)
      .sign(new TextEncoder().encode(jwtSecret));

    // Record login activity for gamification (fire and forget to not block the response)
    try {
      const streakResult =
        await this.gamificationService.updateDailyLoginStreakSimple(
          authenticatedUser.id,
          token,
        );
      await this.gamificationService.recordActivity(
        authenticatedUser.id,
        'login',
        undefined,
        undefined,
        undefined,
        token,
        { streakResult },
      );
    } catch (error) {
      // Log the error but don't fail the login
      this.logger.error(
        `Failed to record login activity for user ${authenticatedUser.id}: ${error.message}`,
      );
    }

    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: expirationTime,
      user: {
        id: authenticatedUser.id,
        email: authenticatedUser.email || '',
        role,
      },
      supabase_session: this.serializeSupabaseSession(authenticatedSession),
    };
  }

  /**
   * Record login history to database for security auditing and analytics
   * This is called asynchronously and doesn't block the login response
   */
  async recordLoginHistory(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
    deviceType?: string,
    location?: string,
  ): Promise<void> {
    try {
      const { error } = await this.supabase.from('login_history').insert({
        user_id: userId,
        ip_address: ipAddress || null,
        user_agent: userAgent || null,
        device_type: deviceType || null,
        location: location || null,
      });

      if (error) {
        this.logger.warn(
          `Failed to record login history for user ${userId}: ${error.message}`,
        );
      }
    } catch (error) {
      this.logger.error(`Error recording login history: ${error.message}`);
    }
  }

  private serializeSupabaseSession(session: Session) {
    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      token_type: session.token_type,
      user: session.user,
    };
  }
}
