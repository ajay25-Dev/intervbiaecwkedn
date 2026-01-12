import { Body, Controller, Get, Put, UseGuards, Req } from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { ProfilesService, ProfileRow } from './profiles.service';

@Controller('v1')
export class ProfileController {
  constructor(private readonly profiles: ProfilesService) {}

  @UseGuards(SupabaseGuard)
  @Get('profile')
  async getProfile(@Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );

    let p = await this.profiles.ensureProfile(req.user.sub, token);

    if (!p) {
      p = { id: req.user.sub, role: 'student' } as any;
    }
    const completed =
      typeof p.onboarding_completed === 'boolean'
        ? p.onboarding_completed
        : Boolean(p.education && p.graduation_year && p.domain && p.profession);
    return { ...p, onboarding_completed: completed } as ProfileRow;
  }

  @UseGuards(SupabaseGuard)
  @Put('profile')
  async putProfile(@Req() req: any, @Body() body: Partial<ProfileRow>) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const patch: Partial<ProfileRow> = {
      // Allow role updates: student, teacher, or admin (no admin code required)
      ...(typeof (body as any).role === 'string'
        ? (() => {
            const roleIn = String((body as any).role)
              .trim()
              .toLowerCase();
            if (
              roleIn === 'student' ||
              roleIn === 'teacher' ||
              roleIn === 'admin'
            )
              return { role: roleIn } as Partial<ProfileRow>;
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
      career_goal: body.career_goal ?? null,
      experience_level: body.experience_level ?? null,
      preferred_pace: body.preferred_pace ?? null,
      time_commitment: body.time_commitment ?? null,
      focus_areas: body.focus_areas ?? null,
    };

    // Handle explicit onboarding_completed flag or auto-set if basic fields provided
    if (body.onboarding_completed === true) {
      (patch as any).onboarding_completed = true;
    } else if (
      patch.education &&
      patch.graduation_year &&
      patch.domain &&
      patch.profession
    ) {
      (patch as any).onboarding_completed = true;
    }
    const updated = await this.profiles.updateProfile(
      req.user.sub,
      patch,
      token,
    );
    const completed =
      typeof updated.onboarding_completed === 'boolean'
        ? updated.onboarding_completed
        : Boolean(
            updated.education &&
              updated.graduation_year &&
              updated.domain &&
              updated.profession,
          );
    return { ...updated, onboarding_completed: completed } as ProfileRow;
  }
}
