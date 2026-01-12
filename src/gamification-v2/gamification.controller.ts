import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { GamificationService } from './gamification.service';
import { LectureGamificationService } from './lecture-gamification.service';
import {
  LectureCompletionDto,
  QuestionAttemptDto,
} from './gamification.interfaces';
import { SupabaseGuard } from '../auth/supabase.guard';

type AuthenticatedRequest = Request & { user?: { id?: string } };

@UseGuards(SupabaseGuard)
@Controller('gamification')
export class GamificationControllerV2 {
  constructor(private readonly gamificationService: GamificationService) {}

  @Post('question-attempt')
  async questionAttempt(
    @Req() req: AuthenticatedRequest,
    @Body() dto: QuestionAttemptDto,
  ) {
    const userId = this.getUserId(req);
    return this.gamificationService.applyQuestionAttemptForUser(userId, dto);
  }

  @Post('identified-question')
  async identifiedQuestion(
    @Req() req: AuthenticatedRequest,
    @Body() body: { exerciseId: string },
  ) {
    const userId = this.getUserId(req);
    return this.gamificationService.awardIdentifiedQuestionXp(
      userId,
      body.exerciseId,
    );
  }

  private getUserId(req: AuthenticatedRequest): string {
    const userPayload: any = req.user;
    const userId =
      userPayload?.id ?? userPayload?.user_id ?? userPayload?.sub ?? null;
    if (!userId) {
      throw new UnauthorizedException('Missing authenticated user');
    }
    return String(userId);
  }
}

@UseGuards(SupabaseGuard)
@Controller('gamification')
export class LectureGamificationControllerV2 {
  constructor(
    private readonly lectureGamificationService: LectureGamificationService,
  ) {}

  @Post('lecture-complete')
  async lectureComplete(
    @Req() req: AuthenticatedRequest,
    @Body() dto: LectureCompletionDto,
  ) {
    const userId = this.getUserId(req);
    return this.lectureGamificationService.applyLectureCompletionForUser(
      userId,
      dto.lectureId,
    );
  }

  private getUserId(req: AuthenticatedRequest): string {
    const userPayload: any = req.user;
    const userId =
      userPayload?.id ?? userPayload?.user_id ?? userPayload?.sub ?? null;
    if (!userId) {
      throw new UnauthorizedException('Missing authenticated user');
    }
    return String(userId);
  }
}
