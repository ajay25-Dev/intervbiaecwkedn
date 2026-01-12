import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createLocalJWKSet, jwtVerify, decodeJwt, JWK } from 'jose';

@Injectable()
export class SupabaseGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseGuard.name);
  private jwks?: ReturnType<typeof createLocalJWKSet>;

  private async getJwks(): Promise<ReturnType<typeof createLocalJWKSet>> {
    if (!this.jwks) {
      const base =
        process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!base) {
        throw new InternalServerErrorException('SUPABASE_URL not configured');
      }

      const jwksUrl = `${base}/auth/v1/certs`;
      const apiKey =
        process.env.SUPABASE_SERVICE_ROLE ||
        process.env.SUPABASE_ANON_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      try {
        const response = await fetch(jwksUrl, {
          headers: apiKey
            ? {
                apikey: apiKey,
              }
            : undefined,
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch JWKS: ${response.status}`);
        }

        const jwks = await response.json();
        this.jwks = createLocalJWKSet(jwks);
      } catch (error) {
        throw new InternalServerErrorException(
          `Failed to initialize JWKS: ${error.message}`,
        );
      }
    }

    return this.jwks;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    const requestUrl = request.url;
    const requestMethod = request.method;

    // Allow CORS preflight checks through without requiring auth
    if (requestMethod === 'OPTIONS') {
      return true;
    }

    // this.logger.log(`Authentication attempt for ${requestMethod} ${requestUrl}`, {
    //   hasAuthHeader: !!authHeader,
    //   authHeaderFormat: authHeader ? (authHeader.startsWith('Bearer ') ? 'Bearer' : 'Other') : 'None',
    //   userAgent: request.headers['user-agent'],
    //   timestamp: new Date().toISOString(),
    // });

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.logger.warn('Authentication failed: No valid authorization header', {
        requestUrl,
        requestMethod,
        authHeader: authHeader ? 'Present but invalid format' : 'Missing',
      });
      throw new UnauthorizedException('No valid authorization header found');
    }

    const token = authHeader.substring(7);

    // Check if we should allow unverified JWT tokens in development
    const allowDevUnverified = process.env.ALLOW_DEV_UNVERIFIED_JWT === '1';

    if (allowDevUnverified) {
      // this.logger.log('Using development mode - unverified JWT allowed');
      try {
        // In development mode, just decode the token without verification
        const payload = decodeJwt(token);

        // this.logger.log('Token decoded successfully in dev mode', {
        //   hasSubject: !!payload.sub,
        //   hasExpiration: !!payload.exp,
        //   subject: payload.sub,
        //   tokenKeys: Object.keys(payload),
        //   expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : 'No expiration',
        // });

        // Basic validation - ensure token has required fields
        if (!payload.sub || !payload.exp) {
          this.logger.error(
            'Token validation failed: Missing required fields',
            {
              hasSubject: !!payload.sub,
              hasExpiration: !!payload.exp,
              tokenKeys: Object.keys(payload),
            },
          );
          throw new UnauthorizedException('Invalid token structure');
        }

        // Check if token is expired
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp < now) {
          this.logger.error('Token validation failed: Token expired', {
            tokenExpiration: payload.exp,
            currentTime: now,
            expiredBy: now - payload.exp,
          });
          throw new UnauthorizedException('Token expired');
        }

        // Attach user info to request with enhanced logging
        request.user = payload;

        // this.logger.log('User authenticated successfully in dev mode', {
        //   userId: payload.sub,
        //   userEmail: payload.email || 'Not provided',
        //   userRole: payload.role || 'Not specified',
        //   tokenKeys: Object.keys(payload),
        // });

        return true;
      } catch (error) {
        // this.logger.error('Development mode token processing failed', {
        //   error: error.message,
        //   tokenLength: token.length,
        //   tokenStart: token.substring(0, 20) + '...',
        // });
        // If decoding fails, fall through to normal verification
      }
    }

    try {
      // this.logger.log('Attempting JWT verification with JWKS');
      const jwks = await this.getJwks();
      const { payload } = await jwtVerify(token, jwks);

      // this.logger.log('JWT verified successfully', {
      //   userId: payload.sub,
      //   userEmail: payload.email || 'Not provided',
      //   userRole: payload.role || 'Not specified',
      //   tokenKeys: Object.keys(payload),
      // });

      // Attach user info to request
      request.user = payload;

      return true;
    } catch (error) {
      this.logger.error('JWT verification failed', {
        error: error.message,
        tokenLength: token.length,
        tokenStart: token.substring(0, 20) + '...',
        requestUrl,
        requestMethod,
      });
      throw new UnauthorizedException('Invalid token');
    }
  }
}
