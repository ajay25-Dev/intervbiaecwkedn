import { Injectable, Logger } from '@nestjs/common';
import { calculateLectureXp, getLevelForXp } from './gamification-core';
import {
  GamificationConfigProvider,
  LectureProgressRepository,
  UserProgress,
  UserProgressRepository,
} from './gamification.interfaces';
import { recordPointsHistoryEntry } from '../lib/points-history';
import {
  logLearningActivityPresence,
  updateDailyLoginStreakRecord,
} from '../lib/learning-streak';
import { getSupabaseRestUrl, supabaseHeaders } from './supabase.providers';

export interface LectureCompletionResponse {
  xpAwarded: number;
  userProgress: UserProgress;
}

@Injectable()
export class LectureGamificationService {
  private readonly logger = new Logger(LectureGamificationService.name);
  private readonly restUrl = getSupabaseRestUrl();

  constructor(
    private readonly configProvider: GamificationConfigProvider,
    private readonly userProgressRepo: UserProgressRepository,
    private readonly lectureProgressRepo: LectureProgressRepository,
  ) {}

  async applyLectureCompletionForUser(
    userId: string,
    lectureId: string,
  ): Promise<LectureCompletionResponse> {
    const config = await this.configProvider.getConfig();
    const completedBefore =
      await this.lectureProgressRepo.hasUserCompletedLecture(userId, lectureId);

    const xpAwarded = calculateLectureXp(completedBefore, config);

    const existingUserProgress = (await this.userProgressRepo.getUserProgress(
      userId,
    )) ?? {
      userId,
      totalXp: 0,
      currentLevel: 1,
    };

    if (xpAwarded <= 0) {
      return {
        xpAwarded: 0,
        userProgress: existingUserProgress,
      };
    }

    await this.lectureProgressRepo.markLectureCompleted(userId, lectureId);

    const newTotalXp = existingUserProgress.totalXp + xpAwarded;
    const newLevel = getLevelForXp(newTotalXp, config);

    const updatedUserProgress: UserProgress = {
      ...existingUserProgress,
      totalXp: newTotalXp,
      currentLevel: newLevel,
      lastXpEventAt: new Date(),
    };

    await this.userProgressRepo.saveUserProgress(updatedUserProgress);
    try {
      await recordPointsHistoryEntry({
        userId,
        pointsChange: xpAwarded,
        reason: 'lecture_completed',
        referenceId: lectureId,
        referenceType: 'lecture',
        metadata: {
          completedBefore,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Unable to record lecture completion points history: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    await this.trackLearningActivityForStreak(userId, 'lecture_completed');

    return {
      xpAwarded,
      userProgress: updatedUserProgress,
    };
  }

  private async trackLearningActivityForStreak(
    userId: string,
    activityType: string,
  ): Promise<void> {
    try {
      const headers = supabaseHeaders();
      const logged = await logLearningActivityPresence({
        restUrl: this.restUrl,
        userId,
        activityType,
        headers,
        category: 'learning',
        logger: this.logger,
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
        `Unable to update streak for ${activityType}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
