import { Controller, Get, Headers, UseGuards, Req } from '@nestjs/common';
import { decodeJwt } from 'jose';
import { SupabaseGuard } from './auth/supabase.guard';

@Controller('v1/debug')
export class DebugController {
  @Get('jwt')
  jwt(@Headers('authorization') auth?: string) {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (!token) return { error: 'no token' };
    try {
      const p: any = decodeJwt(token);
      return {
        sub: p.sub,
        iss: p.iss,
        aud: p.aud,
        iat: p.iat,
        exp: p.exp,
        email: p.email,
      };
    } catch (e: any) {
      return { error: e?.message || 'decode error' };
    }
  }

  @Get('jwks')
  async jwks() {
    const url = `${process.env.SUPABASE_URL}/auth/v1/keys`;
    try {
      const res = await fetch(url);
      return { url, status: res.status };
    } catch (e: any) {
      return { url, error: e?.message };
    }
  }

  @UseGuards(SupabaseGuard)
  @Get('auth-test')
  authTest(@Req() req: any) {
    return {
      success: true,
      user: req.user,
      timestamp: new Date().toISOString(),
      environment: {
        nodeEnv: process.env.NODE_ENV,
        allowDevUnverified: process.env.ALLOW_DEV_UNVERIFIED_JWT,
        supabaseUrl: process.env.SUPABASE_URL ? 'set' : 'missing',
      },
    };
  }

  @Get('env-check')
  envCheck() {
    return {
      nodeEnv: process.env.NODE_ENV,
      allowDevUnverified: process.env.ALLOW_DEV_UNVERIFIED_JWT,
      supabaseUrl: process.env.SUPABASE_URL ? 'set' : 'missing',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY ? 'set' : 'missing',
      port: process.env.PORT,
    };
  }
}
