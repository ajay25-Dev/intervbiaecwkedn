import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';

type ProfileRow = { role?: string };

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);
  private readonly restUrl = `${process.env.SUPABASE_URL}/rest/v1`;
  private readonly serviceKey = process.env.SUPABASE_SERVICE_ROLE?.trim();
  private readonly anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  private readonly allowDevAnon = process.env.ALLOW_DEV_UNVERIFIED_JWT === '1';

  // Build headers for PostgREST (service role in prod; anon in dev if allowed)
  private buildHeaders(): HeadersInit | null {
    const sk = this.serviceKey;
    const looksJwt = sk && sk.split('.').length === 3 && sk.length > 60;
    if (looksJwt) {
      return {
        apikey: sk,
        Authorization: `Bearer ${sk}`,
        'Content-Type': 'application/json',
      };
    }
    if (this.allowDevAnon && this.anonKey) {
      return {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        'Content-Type': 'application/json',
      };
    }
    return null; // no keys available → fail closed
  }

  private getUserId(user: any): string | null {
    return user?.id ?? user?.sub ?? null;
  }

  private async getRole(userId: string): Promise<string | null> {
    const headers = this.buildHeaders();
    if (!headers || !this.restUrl) return null;

    const url =
      `${this.restUrl}/profiles?select=role&limit=1&id=eq.` +
      encodeURIComponent(userId);

    try {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (!res.ok) return null;
      const rows = (await res.json()) as ProfileRow[];
      return rows?.[0]?.role ?? null;
    } catch {
      return null;
    }
  }

  // Returns true iff profile.role === 'admin'; false otherwise
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const requestUrl = req.url;
    const requestMethod = req.method;

    // this.logger.log(`Admin authorization check for ${requestMethod} ${requestUrl}`, {
    //   hasUser: !!req.user,
    //   userObject: req.user ? JSON.stringify(req.user, null, 2) : 'No user object',
    //   userKeys: req.user ? Object.keys(req.user) : [],
    // });

    const userId = this.getUserId(req?.user);

    // Expose a convenience flag to downstream handlers (optional)
    req.isAdmin = false;

    if (!userId) {
      this.logger.warn('Admin authorization failed: No user ID found', {
        requestUrl,
        requestMethod,
        userObject: req.user
          ? JSON.stringify(req.user, null, 2)
          : 'No user object',
        userKeys: req.user ? Object.keys(req.user) : [],
      });
      return false;
    }

    // this.logger.log(`Checking admin role for user ${userId}`);

    const role = await this.getRole(userId);
    const isAdmin = role === 'admin';
    req.isAdmin = isAdmin;

    // this.logger.log(`Admin authorization result for user ${userId}`, {
    //   userId,
    //   role: role || 'No role found',
    //   isAdmin,
    //   requestUrl,
    //   requestMethod,
    // });

    if (!isAdmin) {
      this.logger.warn(`Access denied: User ${userId} is not an admin`, {
        userId,
        role: role || 'No role found',
        requestUrl,
        requestMethod,
      });
    }

    return isAdmin;
  }
}
