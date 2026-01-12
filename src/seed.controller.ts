import { Controller, Post, Req, UseGuards, Get } from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { AdminGuard } from './auth/admin.guard';
import { AssessmentDataSeeder } from './seed-assessment-data';

@Controller('v1/admin/seed')
@UseGuards(SupabaseGuard, AdminGuard)
export class SeedController {
  constructor(private readonly assessmentDataSeeder: AssessmentDataSeeder) {}

  @Post('assessment-data')
  async seedAssessmentData(@Req() req: any) {
    await this.assessmentDataSeeder.seedInitialData(req.user.sub);
    return { success: true, message: 'Assessment data seeded successfully' };
  }

  @Get('status')
  async getSeedStatus() {
    return {
      success: true,
      message: 'Seed controller is available',
      endpoints: [
        'POST /v1/admin/seed/assessment-data - Seed initial assessment questions and categories',
      ],
    };
  }
}
