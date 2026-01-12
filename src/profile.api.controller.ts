import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { ProfilesService, ProfileRow } from './profiles.service';

// Additional API namespace to expose /api/profile alongside /v1/profile
@Controller('')
export class ProfileApiController {
  constructor(private readonly profiles: ProfilesService) {}

  @UseGuards(SupabaseGuard)
  @Get('profile')
  async getProfile(@Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const p = await this.profiles.ensureProfile(req.user.sub, token);
    return p;
  }

  // Save profile details. Accept both PUT and POST for flexibility.
  @UseGuards(SupabaseGuard)
  @Put('profile')
  async putProfile(@Req() req: any, @Body() body: Partial<ProfileRow>) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    // Mirror role update constraints from ProfileController
    const patch: Partial<ProfileRow> = {
      ...(typeof (body as any).role === 'string'
        ? (() => {
            const roleIn = String((body as any).role)
              .trim()
              .toLowerCase();
            if (roleIn === 'student' || roleIn === 'teacher')
              return { role: roleIn } as Partial<ProfileRow>;
            if (roleIn === 'admin') {
              return { role: 'admin' } as Partial<ProfileRow>;
            }
            return {} as Partial<ProfileRow>;
          })()
        : {}),
      education: body.education ?? null,
      graduation_year: body.graduation_year ?? null,
      domain: body.domain ?? null,
      profession: body.profession ?? null,
      full_name: body.full_name ?? null,
      year_of_study: body.year_of_study ?? null,
      qualification: body.qualification ?? null,
      location: body.location ?? null,
      current_institute: body.current_institute ?? null,
      previous_learning_experiences: body.previous_learning_experiences ?? null,
      reason_for_learning: body.reason_for_learning ?? null,
      best_study_time: body.best_study_time ?? null,
      past_challenges: body.past_challenges ?? null,
      hobbies_extracurricular: body.hobbies_extracurricular ?? null,
      favorites: body.favorites ?? null,
      sports_arts: body.sports_arts ?? null,
      languages: body.languages ?? null,
      motivations: body.motivations ?? null,
      // New enhanced onboarding fields
      learning_style: body.learning_style ?? null,
      career_goal: body.career_goal ?? null, // Note: frontend sends career_goals, backend expects career_goal
      experience_level: body.experience_level ?? null,
      preferred_pace: body.preferred_pace ?? null,
      time_commitment: body.time_commitment ?? null,
      focus_areas: body.focus_areas ?? null,
      onboarding_completed: body.onboarding_completed ?? null,
    };
    const updated = await this.profiles.updateProfile(
      req.user.sub,
      patch ?? {},
      token,
    );
    return updated;
  }

  @UseGuards(SupabaseGuard)
  @Post('profile')
  async postProfile(@Req() req: any, @Body() body: Partial<ProfileRow>) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const updated = await this.profiles.updateProfile(
      req.user.sub,
      body ?? {},
      token,
    );
    return updated;
  }
}
