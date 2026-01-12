import { Module } from '@nestjs/common';
import {
  GamificationConfigProvider,
  LectureProgressRepository,
  UserProgressRepository,
  UserQuestionProgressRepository,
} from './gamification.interfaces';
import { GamificationService } from './gamification.service';
import { LectureGamificationService } from './lecture-gamification.service';
import { GamificationSummaryService } from './gamification-summary.service';
import {
  SupabaseGamificationConfigService,
  SupabaseLectureProgressRepository,
  SupabaseUserProgressRepository,
  SupabaseUserQuestionProgressRepository,
} from './supabase.providers';
import {
  GamificationControllerV2,
  LectureGamificationControllerV2,
} from './gamification.controller';

@Module({
  controllers: [GamificationControllerV2, LectureGamificationControllerV2],
  providers: [
    GamificationService,
    LectureGamificationService,
    GamificationSummaryService,
    {
      provide: GamificationConfigProvider,
      useClass: SupabaseGamificationConfigService,
    },
    {
      provide: UserProgressRepository,
      useClass: SupabaseUserProgressRepository,
    },
    {
      provide: UserQuestionProgressRepository,
      useClass: SupabaseUserQuestionProgressRepository,
    },
    {
      provide: LectureProgressRepository,
      useClass: SupabaseLectureProgressRepository,
    },
  ],
  exports: [
    GamificationService,
    LectureGamificationService,
    GamificationSummaryService,
  ],
})
export class GamificationV2Module {}
