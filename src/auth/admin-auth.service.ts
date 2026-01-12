import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';
import { AdminLoginDto, AdminLoginResponseDto } from './admin-auth.dto';

@Injectable()
export class AdminAuthService {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE environment variables are required',
      );
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async login(adminLoginDto: AdminLoginDto): Promise<AdminLoginResponseDto> {
    const { email, password } = adminLoginDto;

    try {
      // Attempt to sign in with Supabase
      const { data: authData, error: authError } =
        await this.supabase.auth.signInWithPassword({
          email,
          password,
        });

      if (authError || !authData.user) {
        throw new UnauthorizedException('Invalid credentials');
      }

      // Check if user has admin role in profile
      const { data: profile, error: profileError } = await this.supabase
        .from('profiles')
        .select('role, onboarding_completed')
        .eq('id', authData.user.id)
        .single();

      if (profileError) {
        console.error('Profile lookup error:', profileError);
        throw new UnauthorizedException('Unable to verify admin access');
      }

      // Check admin role
      const userRole = (profile?.role || '').toLowerCase();
      if (userRole !== 'admin') {
        throw new UnauthorizedException('Admin access required');
      }

      // Generate JWT token compatible with existing guards
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        throw new BadRequestException('JWT_SECRET not configured');
      }

      const expirationTime = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours

      const token = await new SignJWT({
        sub: authData.user.id,
        email: authData.user.email,
        role: 'admin',
        aud: 'authenticated',
        iss: `${process.env.SUPABASE_URL}/auth/v1`,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime(expirationTime)
        .setIssuedAt(Date.now() / 1000)
        .sign(new TextEncoder().encode(jwtSecret));

      return {
        access_token: token,
        token_type: 'Bearer',
        expires_in: expirationTime,
        user: {
          id: authData.user.id,
          email: authData.user.email || '',
          role: 'admin',
        },
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      console.error('Admin login error:', error);
      throw new UnauthorizedException('Login failed');
    }
  }

  async validateToken(token: string): Promise<any> {
    // This method can be used by other services to validate admin tokens
    try {
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        throw new BadRequestException('JWT_SECRET not configured');
      }

      // Import jwtVerify from jose
      const { jwtVerify } = await import('jose');

      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(jwtSecret),
      );
      return payload;
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
