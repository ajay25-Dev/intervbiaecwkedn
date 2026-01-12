import { Controller, Get, Param, UseGuards, Req } from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';

@Controller('v1')
export class AppController {
  getHello() {
    return 'Hello World!';
  }

  @Get('health')
  health() {
    return {
      ok: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      node_env: process.env.NODE_ENV || 'development',
    };
  }

  @UseGuards(SupabaseGuard)
  @Get('me')
  me(@Req() req: any) {
    return { user: req.user };
  }

  @UseGuards(SupabaseGuard)
  @Get('orgs/:id')
  async getOrg() {
    /* query Supabase Postgres with RLS via pg */ return {};
  }
}
