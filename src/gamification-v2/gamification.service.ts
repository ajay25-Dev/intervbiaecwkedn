import { Injectable, Logger } from '@nestjs/common';
import { calculateQuestionXp, getLevelForXp } from './gamification-core';
import {
  GamificationConfigProvider,
  QuestionAttemptDto,
  UserProgress,
  UserProgressRepository,
  UserQuestionProgress,
  UserQuestionProgressRepository,
} from './gamification.interfaces';
import { recordPointsHistoryEntry } from '../lib/points-history';
import {
  logLearningActivityPresence,
  updateDailyLoginStreakRecord,
} from '../lib/learning-streak';
import {
  ensureOk,
  getSupabaseRestUrl,
  supabaseHeaders,
} from './supabase.providers';

export interface QuestionAttemptResponse {
  xpAwarded: number;
  userProgress: UserProgress;
  questionProgress: UserQuestionProgress;
}

export interface IdentifiedQuestionRewardResponse {
  xpAwarded: number;
  userProgress: UserProgress;
}

const IDENTIFIED_QUESTION_XP = 25;
const IDENTIFIED_QUESTION_REASON = 'identified_question';
const IDENTIFIED_QUESTION_REFERENCE_TYPE =
  'practice_exercise_identified_question';

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);
  private readonly restUrl = getSupabaseRestUrl();

  constructor(
    private readonly configProvider: GamificationConfigProvider,
    private readonly userProgressRepo: UserProgressRepository,
    private readonly questionProgressRepo: UserQuestionProgressRepository,
  ) {}

  async applyQuestionAttemptForUser(
    userId: string,
    dto: QuestionAttemptDto,
  ): Promise<QuestionAttemptResponse> {
    const config = await this.configProvider.getConfig();

    const existingUserProgress = (await this.userProgressRepo.getUserProgress(
      userId,
    )) ?? {
      userId,
      totalXp: 0,
      currentLevel: 1,
    };

    const previousQuestionProgress =
      (await this.questionProgressRepo.getQuestionProgress(
        userId,
        dto.questionId,
      )) ?? {
        userId,
        questionId: dto.questionId,
        attemptsCount: 0,
        firstAttemptCorrect: false,
        secondAttemptCorrect: false,
        totalXpEarnedForThisQuestion: 0,
      };

    const calculation = calculateQuestionXp(
      {
        questionId: dto.questionId,
        questionType: dto.questionType,
        difficulty: dto.difficulty,
        isCorrect: dto.isCorrect,
        previousProgress: previousQuestionProgress,
      },
      config,
    );

    const newTotalXp = existingUserProgress.totalXp + calculation.xpAwarded;
    const newLevel = getLevelForXp(newTotalXp, config);

    const updatedUserProgress: UserProgress = {
      ...existingUserProgress,
      totalXp: newTotalXp,
      currentLevel: newLevel,
      lastXpEventAt: new Date(),
    };

    const updatedQuestionProgress: UserQuestionProgress = {
      userId,
      ...calculation.updatedProgress,
    };

    await this.userProgressRepo.saveUserProgress(updatedUserProgress);
    await this.questionProgressRepo.saveQuestionProgress(
      updatedQuestionProgress,
    );
    if (calculation.xpAwarded > 0) {
      try {
        await recordPointsHistoryEntry({
          userId,
          pointsChange: calculation.xpAwarded,
          reason: 'question_attempt',
          referenceId: dto.questionId,
          referenceType: dto.questionType,
          metadata: {
            difficulty: dto.difficulty,
            isCorrect: dto.isCorrect,
          },
        });
      } catch (error) {
        this.logger.warn(
          `Unable to record question attempt points history: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const streakActivity =
      dto.questionType === 'practice'
        ? 'practice_question_attempt'
        : 'quiz_question_attempt';
    await this.trackLearningActivityForStreak(userId, streakActivity);

    return {
      xpAwarded: calculation.xpAwarded,
      userProgress: updatedUserProgress,
      questionProgress: updatedQuestionProgress,
    };
  }

  async awardIdentifiedQuestionXp(
    userId: string,
    exerciseId: string,
  ): Promise<IdentifiedQuestionRewardResponse> {
    if (!exerciseId) {
      const existingProgress = (await this.userProgressRepo.getUserProgress(
        userId,
      )) ?? {
        userId,
        totalXp: 0,
        currentLevel: 1,
      };
      return {
        xpAwarded: 0,
        userProgress: existingProgress,
      };
    }

    const alreadyAwarded = await this.hasIdentifiedQuestionRewarded(
      userId,
      exerciseId,
    );
    const currentProgress = (await this.userProgressRepo.getUserProgress(
      userId,
    )) ?? {
      userId,
      totalXp: 0,
      currentLevel: 1,
    };
    if (alreadyAwarded) {
      return {
        xpAwarded: 0,
        userProgress: currentProgress,
      };
    }

    const config = await this.configProvider.getConfig();

    const xpAwarded = IDENTIFIED_QUESTION_XP;
    const updatedTotalXp = currentProgress.totalXp + xpAwarded;
    const newLevel = getLevelForXp(updatedTotalXp, config);

    const updatedProgress: UserProgress = {
      ...currentProgress,
      totalXp: updatedTotalXp,
      currentLevel: newLevel,
      lastXpEventAt: new Date(),
    };

    await this.userProgressRepo.saveUserProgress(updatedProgress);

    try {
      await recordPointsHistoryEntry({
        userId,
        pointsChange: xpAwarded,
        reason: IDENTIFIED_QUESTION_REASON,
        referenceId: exerciseId,
        referenceType: IDENTIFIED_QUESTION_REFERENCE_TYPE,
      });
    } catch (error) {
      this.logger.warn(
        `Unable to record identified question reward history: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      xpAwarded,
      userProgress: updatedProgress,
    };
  }

  private async trackLearningActivityForStreak(
    userId: string,
    activityType: string,
  ): Promise<void> {
    try {
      const headers = supabaseHeaders();
      const userTimezone = await this.getUserTimezone(userId, headers);

      const logged = await logLearningActivityPresence({
        restUrl: this.restUrl,
        userId,
        activityType,
        headers,
        category: 'learning',
        logger: this.logger,
        userTimezone: userTimezone || undefined,
      });
      if (logged) {
        await updateDailyLoginStreakRecord({
          restUrl: this.restUrl,
          userId,
          headers,
          logger: this.logger,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Unable to update learning streak for ${activityType}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async hasIdentifiedQuestionRewarded(
    userId: string,
    exerciseId: string,
  ): Promise<boolean> {
    const encodedUserId = encodeURIComponent(userId);
    const encodedExerciseId = encodeURIComponent(exerciseId);
    const url = `${this.restUrl}/points_history?user_id=eq.${encodedUserId}&reference_type=eq.${IDENTIFIED_QUESTION_REFERENCE_TYPE}&reference_id=eq.${encodedExerciseId}&limit=1`;
    const res = await fetch(url, { headers: supabaseHeaders() });
    await ensureOk(res, 'Check identified question reward');
    const rows = (await res.json()) as Array<unknown>;
    return Array.isArray(rows) && rows.length > 0;
  }

  private async getUserTimezone(
    userId: string,
    headers: Record<string, string>,
  ): Promise<string | null> {
    try {
      const url = `${this.restUrl}/profiles?user_id=eq.${userId}&select=user_timezone&limit=1`;
      const res = await fetch(url, { headers });
      if (!res.ok) return null;

      const rows = (await res.json()) as Array<{
        user_timezone?: string | null;
      }>;
      return rows[0]?.user_timezone ?? null;
    } catch (error) {
      this.logger.debug(`Failed to fetch user timezone: ${error}`);
      return null;
    }
  }
}
