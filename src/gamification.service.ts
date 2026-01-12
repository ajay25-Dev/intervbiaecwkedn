import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  logLearningActivityPresence,
  SimpleStreakUpdateResult,
  updateDailyLoginStreakRecord,
} from './lib/learning-streak';

export interface Achievement {
  id: string;
  name: string;
  display_name: string;
  description: string;
  icon: string;
  category: string;
  color: string;
  points_reward: number;
  is_repeatable: boolean;
}

export interface UserAchievement {
  id: string;
  achievement_type_id: string;
  earned_at: string;
  points_earned: number;
  metadata: any;
  is_featured: boolean;
  achievement: Achievement;
}

export interface PointsHistory {
  id: string;
  points_change: number;
  reason: string;
  reference_type: string;
  metadata: any;
  created_at: string;
}

export interface DailyChallenge {
  id: string;
  title: string;
  description: string;
  challenge_type: string;
  target_value: number;
  points_reward: number;
  difficulty_level: string;
  date_active: string;
  progress?: UserChallengeProgress;
}

export interface UserChallengeProgress {
  id: string;
  current_progress: number;
  completed_at: string | null;
  points_earned: number;
  date_attempted: string;
}

export interface LeaderboardEntry {
  user_id: string;
  rank_position: number;
  score_value: number;
  full_name?: string;
  avatar_url?: string;
}

export interface BadgeCatalogEntry {
  id: string;
  badge_code: string;
  display_name: string;
  description: string;
  icon: string;
  color_primary: string;
  rarity: string;
  badge_type: string;
  unlock_rule: any;
}

export interface UserBadge {
  id: string;
  badge_id: string;
  earned_at: string;
  reason?: string;
  reference_id?: string;
  reference_type?: string;
  is_equipped: boolean;
  is_featured?: boolean;
  metadata?: any;
  badge: BadgeCatalogEntry;
}

export interface UserBadgeHistory {
  id: string;
  user_id: string;
  badge_id: string;
  event_type: string;
  reason?: string;
  reference_id?: string;
  reference_type?: string;
  metadata?: any;
  created_at: string;
}

export interface GamificationStats {
  total_points: number;
  current_level: number;
  current_streak: number;
  longest_streak: number;
  achievements_count: number;
  badges_count: number;
  rank_position?: number;
}

export interface ScopeXpContext {
  courseId?: string;
  subjectId?: string;
  moduleId?: string;
  sectionId?: string;
}

export interface LearningStreak {
  id: string;
  streak_type: string;
  current_count: number;
  start_date: string;
  longest_count: number;
  is_active: boolean;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  data: any;
  is_read: boolean;
  created_at: string;
  expires_at?: string;
}

export interface LeaderboardInsight {
  type: string;
  message: string;
  suggestion: string;
}

export interface StreakUpdateSummary {
  action?: string;
  currentCount?: number;
  longestCount?: number;
  updatedToday?: boolean;
}

export interface LoginRewardSummary {
  awarded: boolean;
  amount?: number;
  streakCount?: number;
  streakAction?: string;
}

export interface RecordActivityResult {
  success: boolean;
  activityType: string;
  pointsAwarded: number;
  streak?: StreakUpdateSummary;
  loginReward?: LoginRewardSummary;
}

@Injectable()
export class GamificationService {
  private restUrl = `${process.env.SUPABASE_URL}/rest/v1`;
  private serviceKey = process.env.SUPABASE_SERVICE_ROLE;
  private anonKey = process.env.SUPABASE_ANON_KEY;
  private readonly logger = new Logger(GamificationService.name);
  private readonly badgeCacheTtlMs = 5 * 60 * 1000;
  private badgeCacheByCode = new Map<
    string,
    { entry: BadgeCatalogEntry; cachedAt: number }
  >();
  private badgeCacheById = new Map<
    string,
    { entry: BadgeCatalogEntry; cachedAt: number }
  >();
  private readonly learningActivityTypes = new Set<string>([
    'lecture_viewed',
    'lecture_completed',
    'lecture_watched',
    'quiz_completed',
    'quiz_question_attempt',
    'quiz_attempt',
    'course_completed',
    'section_completed',
    'practice_completed',
    'practice_exercise_completed',
    'practice_submission',
    'practice_attempt',
    'practice_question_attempt',
  ]);

  private headers(userToken?: string) {
    if (!process.env.SUPABASE_URL) {
      if (process.env.NODE_ENV === 'test') {
        return { 'Content-Type': 'application/json' } as Record<string, string>;
      }
      throw new InternalServerErrorException('SUPABASE_URL not set');
    }

    const sk = this.serviceKey?.trim();
    const looksJwt = sk && sk.split('.').length === 3 && sk.length > 60;

    if (looksJwt) {
      return {
        apikey: sk,
        Authorization: `Bearer ${sk}`,
        'Content-Type': 'application/json',
      };
    }

    if (this.anonKey && userToken) {
      return {
        apikey: this.anonKey,
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      };
    }

    if (process.env.NODE_ENV === 'test') {
      return { 'Content-Type': 'application/json' } as Record<string, string>;
    }

    throw new InternalServerErrorException('Supabase keys missing');
  }

  // Award points to user and trigger level updates
  async awardPoints(
    userId: string,
    points: number,
    reason: string,
    referenceId?: string,
    referenceType?: string,
    userToken?: string,
    scopeContext?: ScopeXpContext,
  ): Promise<{ leveledUp: boolean; newLevel?: number; levelRewards?: any }> {
    try {
      // Get current user stats before awarding points
      const currentStats = await this.getUserStats(userId, userToken);
      const oldLevel = currentStats.current_level;
      const oldPoints = currentStats.total_points;

      // Award the points first
      const url = `${this.restUrl}/rpc/award_points`;
      const response = await fetch(url, {
        method: 'POST',
        headers: this.headers(userToken),
        body: JSON.stringify({
          p_user_id: userId,
          p_points: points,
          p_reason: reason,
          p_reference_id: referenceId,
          p_reference_type: referenceType,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new InternalServerErrorException(
          `Failed to award points: ${error}`,
        );
      }

      // Check for level progression after awarding points
      const newTotalPoints = oldPoints + points;
      const levelProgression = await this.checkAndUpdateLevelProgression(
        userId,
        newTotalPoints,
        oldLevel,
        userToken,
      );

      if (points !== 0) {
        const resolvedScope = await this.resolveScopeContext(
          scopeContext,
          referenceType,
          referenceId,
          userToken,
        );

        if (resolvedScope) {
          await this.recordScopedXp(
            userId,
            points,
            reason,
            referenceId,
            referenceType,
            resolvedScope,
            userToken,
          );
        }
      }

      return levelProgression;
    } catch (error) {
      throw new InternalServerErrorException(
        `Award points failed: ${error.message}`,
      );
    }
  }

  private async incrementScopeXp(
    userId: string,
    scopeType: 'course' | 'subject' | 'module' | 'section',
    scopeId: string,
    amount: number,
    reason: string,
    referenceId?: string,
    referenceType?: string,
    metadata?: any,
    userToken?: string,
  ) {
    const url = `${this.restUrl}/rpc/increment_scope_xp`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(userToken),
      body: JSON.stringify({
        p_user_id: userId,
        p_scope_type: scopeType,
        p_scope_id: scopeId,
        p_delta: amount,
        p_reason: reason,
        p_reference_id: referenceId,
        p_reference_type: referenceType,
        p_metadata: metadata ?? {},
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new InternalServerErrorException(
        `Failed to increment scope XP: ${text}`,
      );
    }
  }

  private async recordScopedXp(
    userId: string,
    amount: number,
    reason: string,
    referenceId: string | undefined,
    referenceType: string | undefined,
    scopeContext: ScopeXpContext,
    userToken?: string,
  ) {
    const hasScope =
      Boolean(scopeContext.courseId) ||
      Boolean(scopeContext.subjectId) ||
      Boolean(scopeContext.moduleId) ||
      Boolean(scopeContext.sectionId);

    if (!hasScope) {
      return;
    }

    const tasks: Promise<any>[] = [];

    if (scopeContext.courseId) {
      tasks.push(
        this.incrementScopeXp(
          userId,
          'course',
          scopeContext.courseId,
          amount,
          reason,
          referenceId,
          referenceType,
          scopeContext,
          userToken,
        ),
      );
    }

    if (scopeContext.subjectId) {
      tasks.push(
        this.incrementScopeXp(
          userId,
          'subject',
          scopeContext.subjectId,
          amount,
          reason,
          referenceId,
          referenceType,
          scopeContext,
          userToken,
        ),
      );
    }

    if (scopeContext.moduleId) {
      tasks.push(
        this.incrementScopeXp(
          userId,
          'module',
          scopeContext.moduleId,
          amount,
          reason,
          referenceId,
          referenceType,
          scopeContext,
          userToken,
        ),
      );
    }

    if (scopeContext.sectionId) {
      tasks.push(
        this.incrementScopeXp(
          userId,
          'section',
          scopeContext.sectionId,
          amount,
          reason,
          referenceId,
          referenceType,
          scopeContext,
          userToken,
        ),
      );
    }

    if (!tasks.length) {
      return;
    }

    await Promise.allSettled(tasks);
  }

  private async resolveScopeContext(
    provided: ScopeXpContext | undefined,
    referenceType?: string,
    referenceId?: string,
    userToken?: string,
  ): Promise<ScopeXpContext | null> {
    const context: ScopeXpContext = { ...(provided || {}) };

    const ensureSubjectCourse = async () => {
      if (context.subjectId && !context.courseId) {
        const subject = await this.fetchSubjectHierarchy(
          context.subjectId,
          userToken,
        );
        if (subject?.courseId) {
          context.courseId = subject.courseId;
        }
      }
    };

    const ensureModuleAncestors = async () => {
      if (context.moduleId && (!context.subjectId || !context.courseId)) {
        const module = await this.fetchModuleHierarchy(
          context.moduleId,
          userToken,
        );
        if (module) {
          context.subjectId = context.subjectId ?? module.subjectId;
          context.courseId = context.courseId ?? module.courseId;
        }
      }
    };

    const ensureSectionAncestors = async () => {
      if (context.sectionId && !context.moduleId) {
        const section = await this.fetchSectionHierarchy(
          context.sectionId,
          userToken,
        );
        if (section) {
          context.moduleId = context.moduleId ?? section.moduleId;
          context.subjectId = context.subjectId ?? section.subjectId;
          context.courseId = context.courseId ?? section.courseId;
        }
      }
    };

    if (referenceType && referenceId) {
      switch (referenceType) {
        case 'course':
          context.courseId = context.courseId ?? referenceId;
          break;
        case 'subject':
          context.subjectId = context.subjectId ?? referenceId;
          break;
        case 'module':
          context.moduleId = context.moduleId ?? referenceId;
          break;
        case 'section':
          context.sectionId = context.sectionId ?? referenceId;
          break;
        default:
          break;
      }
    }

    await ensureSectionAncestors();
    await ensureModuleAncestors();
    await ensureSubjectCourse();

    const hasScope =
      Boolean(context.courseId) ||
      Boolean(context.subjectId) ||
      Boolean(context.moduleId) ||
      Boolean(context.sectionId);

    return hasScope ? context : null;
  }

  private async fetchModuleHierarchy(
    moduleId: string,
    userToken?: string,
  ): Promise<{
    moduleId: string;
    subjectId?: string;
    courseId?: string;
  } | null> {
    try {
      const url = `${this.restUrl}/modules?id=eq.${moduleId}&select=id,subject_id,subjects(id,course_id)`;
      const response = await fetch(url, {
        headers: this.headers(userToken),
      });
      if (!response.ok) {
        return null;
      }
      const [row] = await response.json();
      if (!row) return null;
      const subjectData = row.subjects;
      let courseId: string | undefined;
      if (Array.isArray(subjectData)) {
        courseId = subjectData[0]?.course_id ?? undefined;
      } else if (subjectData) {
        courseId = subjectData.course_id ?? undefined;
      }
      return {
        moduleId: row.id,
        subjectId: row.subject_id ?? undefined,
        courseId,
      };
    } catch (error) {
      this.logger.warn(`Failed to fetch module hierarchy: ${error.message}`);
      return null;
    }
  }

  private async fetchSectionHierarchy(
    sectionId: string,
    userToken?: string,
  ): Promise<{
    sectionId: string;
    moduleId?: string;
    subjectId?: string;
    courseId?: string;
  } | null> {
    try {
      const url = `${this.restUrl}/sections?id=eq.${sectionId}&select=id,module_id,modules(id,subject_id,subjects(id,course_id))`;
      const response = await fetch(url, {
        headers: this.headers(userToken),
      });
      if (!response.ok) {
        return null;
      }
      const [row] = await response.json();
      if (!row) return null;
      const moduleInfo = row.modules || {};
      const subjectFromModule = Array.isArray(moduleInfo?.subjects)
        ? moduleInfo.subjects[0]
        : moduleInfo?.subjects;

      return {
        sectionId: row.id,
        moduleId: row.module_id ?? moduleInfo.id ?? undefined,
        subjectId: moduleInfo.subject_id ?? subjectFromModule?.id ?? undefined,
        courseId: subjectFromModule?.course_id ?? undefined,
      };
    } catch (error) {
      this.logger.warn(`Failed to fetch section hierarchy: ${error.message}`);
      return null;
    }
  }

  private async fetchSubjectHierarchy(
    subjectId: string,
    userToken?: string,
  ): Promise<{ subjectId: string; courseId?: string } | null> {
    try {
      const url = `${this.restUrl}/subjects?id=eq.${subjectId}&select=id,course_id`;
      const response = await fetch(url, {
        headers: this.headers(userToken),
      });
      if (!response.ok) return null;
      const [row] = await response.json();
      if (!row) return null;
      return {
        subjectId: row.id,
        courseId: row.course_id ?? undefined,
      };
    } catch (error) {
      this.logger.warn(`Failed to fetch subject hierarchy: ${error.message}`);
      return null;
    }
  }

  private getCachedBadgeByCode(code: string): BadgeCatalogEntry | null {
    const cached = this.badgeCacheByCode.get(code);
    if (!cached) return null;
    if (Date.now() - cached.cachedAt > this.badgeCacheTtlMs) {
      this.badgeCacheByCode.delete(code);
      return null;
    }
    return cached.entry;
  }

  private getCachedBadgeById(id: string): BadgeCatalogEntry | null {
    const cached = this.badgeCacheById.get(id);
    if (!cached) return null;
    if (Date.now() - cached.cachedAt > this.badgeCacheTtlMs) {
      this.badgeCacheById.delete(id);
      return null;
    }
    return cached.entry;
  }

  private cacheBadgeEntry(entry: BadgeCatalogEntry) {
    const record = { entry, cachedAt: Date.now() };
    this.badgeCacheByCode.set(entry.badge_code, record);
    this.badgeCacheById.set(entry.id, record);
  }

  async getBadgeCatalog(userToken?: string): Promise<BadgeCatalogEntry[]> {
    try {
      const url = `${this.restUrl}/badge_catalog?select=*`;
      const response = await fetch(url, {
        headers: this.headers(userToken),
      });
      if (!response.ok) {
        throw new InternalServerErrorException('Failed to fetch badge catalog');
      }
      const entries = await response.json();
      if (Array.isArray(entries)) {
        entries.forEach((entry: BadgeCatalogEntry) =>
          this.cacheBadgeEntry(entry),
        );
      }
      return entries;
    } catch (error) {
      throw new InternalServerErrorException(
        `Get badge catalog failed: ${error.message}`,
      );
    }
  }

  private async resolveBadgeCatalogEntry(
    identifier: string,
    userToken?: string,
  ): Promise<BadgeCatalogEntry | null> {
    const cachedByCode = this.getCachedBadgeByCode(identifier);
    if (cachedByCode) return cachedByCode;

    const byCode = await this.fetchBadgeCatalogEntry(identifier, userToken);
    if (byCode) return byCode;

    if (this.looksLikeUuid(identifier)) {
      const cachedById = this.getCachedBadgeById(identifier);
      if (cachedById) return cachedById;
      return this.fetchBadgeCatalogEntryById(identifier, userToken);
    }
    return null;
  }

  private async fetchBadgeCatalogEntry(
    badgeCode: string,
    userToken?: string,
  ): Promise<BadgeCatalogEntry | null> {
    try {
      const url = `${this.restUrl}/badge_catalog?badge_code=eq.${badgeCode}&select=*&limit=1`;
      const response = await fetch(url, {
        headers: this.headers(userToken),
      });
      if (!response.ok) return null;
      const rows = await response.json();
      const entry = rows?.[0] ?? null;
      if (entry) {
        this.cacheBadgeEntry(entry);
      }
      return entry;
    } catch (error) {
      this.logger.warn(`Failed to fetch badge catalog entry: ${error.message}`);
      return null;
    }
  }

  private async fetchBadgeCatalogEntryById(
    badgeId: string,
    userToken?: string,
  ): Promise<BadgeCatalogEntry | null> {
    try {
      const url = `${this.restUrl}/badge_catalog?id=eq.${badgeId}&select=*&limit=1`;
      const response = await fetch(url, {
        headers: this.headers(userToken),
      });
      if (!response.ok) return null;
      const rows = await response.json();
      const entry = rows?.[0] ?? null;
      if (entry) {
        this.cacheBadgeEntry(entry);
      }
      return entry;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch badge catalog entry by id: ${error.message}`,
      );
      return null;
    }
  }

  private looksLikeUuid(value: string): boolean {
    return /^[0-9a-fA-F-]{36}$/.test(value);
  }

  private async logBadgeHistory(
    userId: string,
    badgeId: string,
    eventType: string,
    reason?: string,
    referenceId?: string,
    referenceType?: string,
    metadata?: any,
    userToken?: string,
  ) {
    try {
      const url = `${this.restUrl}/user_badge_history`;
      await fetch(url, {
        method: 'POST',
        headers: {
          ...this.headers(userToken),
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          user_id: userId,
          badge_id: badgeId,
          event_type: eventType,
          reason: reason || null,
          reference_id: referenceId || null,
          reference_type: referenceType || null,
          metadata: metadata ?? {},
        }),
      });
    } catch (error) {
      this.logger.warn(`Failed to log badge history: ${error.message}`);
    }
  }

  // Check and update level progression based on points
  async checkAndUpdateLevelProgression(
    userId: string,
    totalPoints: number,
    currentLevel: number,
    userToken?: string,
  ): Promise<{ leveledUp: boolean; newLevel?: number; levelRewards?: any }> {
    try {
      // Calculate what level the user should be at based on points
      const targetLevel = await this.calculateLevelFromPoints(
        totalPoints,
        userToken,
      );

      if (targetLevel > currentLevel) {
        // User has leveled up!
        console.log(
          `🎉 User ${userId} leveled up from ${currentLevel} to ${targetLevel}!`,
        );

        // Update user's level in the database
        await this.updateUserLevel(userId, targetLevel, userToken);

        // Get level rewards and trigger level-up achievements
        const levelRewards = await this.processLevelUpRewards(
          userId,
          targetLevel,
          currentLevel,
          userToken,
        );

        // Create level-up notification
        await this.createLevelUpNotification(
          userId,
          targetLevel,
          levelRewards,
          userToken,
        );

        return {
          leveledUp: true,
          newLevel: targetLevel,
          levelRewards,
        };
      }

      return { leveledUp: false };
    } catch (error) {
      console.error('Level progression check failed:', error);
      return { leveledUp: false };
    }
  }

  // Calculate user level based on total points
  async calculateLevelFromPoints(
    totalPoints: number,
    userToken?: string,
  ): Promise<number> {
    try {
      // Get level configuration from database
      const url = `${this.restUrl}/level_config?select=level,points_required&order=level.asc`;
      const response = await fetch(url, {
        headers: this.headers(userToken),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch level configuration');
      }

      const levelConfigs = await response.json();

      // Find the highest level the user qualifies for
      let userLevel = 1;
      for (const config of levelConfigs) {
        if (totalPoints >= config.points_required) {
          userLevel = config.level;
        } else {
          break;
        }
      }

      return userLevel;
    } catch (error) {
      console.error('Failed to calculate level from points:', error);
      return 1; // Default to level 1 if calculation fails
    }
  }

  // Update user's level in the database
  async updateUserLevel(
    userId: string,
    newLevel: number,
    userToken?: string,
  ): Promise<void> {
    try {
      const url = `${this.restUrl}/profiles?id=eq.${userId}`;
      const response = await fetch(url, {
        method: 'PATCH',
        headers: this.headers(userToken),
        body: JSON.stringify({
          current_level: newLevel,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update user level');
      }

      // console.log(`✅ Updated user ${userId} to level ${newLevel}`);
    } catch (error) {
      console.error('Failed to update user level:', error);
      throw error;
    }
  }

  // Process level-up rewards and achievements
  async processLevelUpRewards(
    userId: string,
    newLevel: number,
    oldLevel: number,
    userToken?: string,
  ): Promise<any> {
    try {
      // Get level configuration for the new level
      const url = `${this.restUrl}/level_config?level=eq.${newLevel}&select=*`;
      const response = await fetch(url, {
        headers: this.headers(userToken),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch level rewards');
      }

      const [levelConfig] = await response.json();
      const rewards = levelConfig?.rewards || {};

      // Award level-up achievement
      await this.awardLevelUpAchievement(userId, newLevel, userToken);

      // Award milestone achievements for special levels
      await this.checkMilestoneAchievements(userId, newLevel, userToken);

      // Award any bonus points for leveling up
      if (rewards.bonus_points) {
        await this.awardBonusPoints(
          userId,
          rewards.bonus_points,
          `Level ${newLevel} bonus`,
          userToken,
        );
      }

      // Award any badges for reaching this level
      if (rewards.badges) {
        for (const badgeIdentifier of rewards.badges) {
          await this.awardBadge(userId, badgeIdentifier, userToken, {
            reason: `level_${newLevel}_reward`,
            referenceType: 'level_reward',
            referenceId: undefined,
          });
        }
      }

      // console.log(
      //   `🎁 Processed level-up rewards for user ${userId} reaching level ${newLevel}`,
      // );
      return {
        level: newLevel,
        title: levelConfig?.title || `Level ${newLevel}`,
        description:
          levelConfig?.description ||
          `Congratulations on reaching level ${newLevel}!`,
        rewards: rewards,
        levelsGained: newLevel - oldLevel,
      };
    } catch (error) {
      console.error('Failed to process level-up rewards:', error);
      return {
        level: newLevel,
        title: `Level ${newLevel}`,
        description: `Congratulations on reaching level ${newLevel}!`,
        rewards: {},
        levelsGained: newLevel - oldLevel,
      };
    }
  }

  // Award level-up achievement
  async awardLevelUpAchievement(
    userId: string,
    level: number,
    userToken?: string,
  ): Promise<void> {
    try {
      const achievementName = `level_${level}_reached`;
      await this.awardAchievement(
        userId,
        achievementName,
        { level },
        userToken,
      );
    } catch (error) {
      console.error(
        `Failed to award level-up achievement for level ${level}:`,
        error,
      );
    }
  }

  // Check and award milestone achievements
  async checkMilestoneAchievements(
    userId: string,
    level: number,
    userToken?: string,
  ): Promise<void> {
    try {
      const milestones = [5, 10, 25, 50, 100];

      if (milestones.includes(level)) {
        const achievementName = `milestone_level_${level}`;
        await this.awardAchievement(
          userId,
          achievementName,
          { milestone_level: level },
          userToken,
        );
        // console.log(
        //   `🏆 Awarded milestone achievement for level ${level} to user ${userId}`,
        // );
      }
    } catch (error) {
      console.error(
        `Failed to check milestone achievements for level ${level}:`,
        error,
      );
    }
  }

  // Award bonus points (without triggering level progression to avoid infinite loops)
  async awardBonusPoints(
    userId: string,
    points: number,
    reason: string,
    userToken?: string,
  ): Promise<void> {
    try {
      const url = `${this.restUrl}/rpc/award_points`;
      await fetch(url, {
        method: 'POST',
        headers: this.headers(userToken),
        body: JSON.stringify({
          p_user_id: userId,
          p_points: points,
          p_reason: reason,
          p_reference_type: 'level_bonus',
        }),
      });
      // console.log(
      //   `💰 Awarded ${points} bonus points to user ${userId} for: ${reason}`,
      // );
    } catch (error) {
      console.error('Failed to award bonus points:', error);
    }
  }

  // Award badge to user
  async awardBadge(
    userId: string,
    badgeIdentifier: string,
    userToken?: string,
    options?: {
      reason?: string;
      referenceId?: string;
      referenceType?: string;
      metadata?: any;
      allowRepeat?: boolean;
    },
  ): Promise<{ success: boolean; duplicate?: boolean }> {
    try {
      const badge = await this.resolveBadgeCatalogEntry(
        badgeIdentifier,
        userToken,
      );
      if (!badge) {
        throw new NotFoundException(
          `Badge not found for identifier ${badgeIdentifier}`,
        );
      }

      if (!options?.allowRepeat) {
        const existingUrl = `${this.restUrl}/user_badges?user_id=eq.${userId}&badge_id=eq.${badge.id}&select=id&limit=1`;
        const existingRes = await fetch(existingUrl, {
          headers: this.headers(userToken),
        });
        if (existingRes.ok) {
          const existingRows = await existingRes.json();
          if (Array.isArray(existingRows) && existingRows.length > 0) {
            return { success: false, duplicate: true };
          }
        }
      }

      const payload = {
        user_id: userId,
        badge_id: badge.id,
        earned_at: new Date().toISOString(),
        reason: options?.reason || null,
        reference_id: options?.referenceId || null,
        reference_type: options?.referenceType || null,
        metadata: options?.metadata ?? {},
        is_equipped: false,
      };

      const url = `${this.restUrl}/user_badges`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...this.headers(userToken),
          Prefer: 'return=representation',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new InternalServerErrorException(
          `Failed to award badge: ${errorText}`,
        );
      }

      await response.json().catch(() => null);
      await this.logBadgeHistory(
        userId,
        badge.id,
        'awarded',
        options?.reason,
        options?.referenceId,
        options?.referenceType,
        options?.metadata,
        userToken,
      );

      return { success: true, duplicate: false };
    } catch (error) {
      this.logger.error(
        `Failed to award badge ${badgeIdentifier} to user ${userId}: ${error.message}`,
      );
      throw error;
    }
  }

  // Create level-up notification
  async createLevelUpNotification(
    userId: string,
    newLevel: number,
    levelRewards: any,
    userToken?: string,
  ): Promise<void> {
    try {
      const url = `${this.restUrl}/gamification_notifications`;
      await fetch(url, {
        method: 'POST',
        headers: this.headers(userToken),
        body: JSON.stringify({
          user_id: userId,
          type: 'level_up',
          title: `🎉 Level Up!`,
          message: `Congratulations! You've reached ${levelRewards.title || `Level ${newLevel}`}!`,
          data: {
            new_level: newLevel,
            rewards: levelRewards.rewards,
            title: levelRewards.title,
            description: levelRewards.description,
          },
          expires_at: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000,
          ).toISOString(), // 7 days
        }),
      });
      // console.log(
      //   `📢 Created level-up notification for user ${userId} reaching level ${newLevel}`,
      // );
    } catch (error) {
      console.error('Failed to create level-up notification:', error);
    }
  }

  // Award achievement to user
  async awardAchievement(
    userId: string,
    achievementName: string,
    metadata = {},
    userToken?: string,
  ): Promise<void> {
    try {
      const url = `${this.restUrl}/rpc/award_achievement`;
      const response = await fetch(url, {
        method: 'POST',
        headers: this.headers(userToken),
        body: JSON.stringify({
          p_user_id: userId,
          p_achievement_name: achievementName,
          p_metadata: metadata,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new InternalServerErrorException(
          `Failed to award achievement: ${error}`,
        );
      }
    } catch (error) {
      throw new InternalServerErrorException(
        `Award achievement failed: ${error.message}`,
      );
    }
  }

  // Simple streak update method that handles daily login streaks directly
  async updateDailyLoginStreakSimple(
    userId: string,
    userToken?: string,
  ): Promise<SimpleStreakUpdateResult> {
    try {
      return await updateDailyLoginStreakRecord({
        restUrl: this.restUrl,
        userId,
        headers: this.headers(userToken),
        logger: this.logger,
      });
    } catch (error) {
      this.logger.error(
        `Simple streak update failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new InternalServerErrorException(
        `Simple streak update failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Get user's gamification stats
  async getUserStats(
    userId: string,
    userToken?: string,
  ): Promise<GamificationStats> {
    try {
      // Get basic stats from profile
      const profileUrl = `${this.restUrl}/profiles?id=eq.${userId}&select=total_points,current_level,current_streak,longest_streak`;
      const progressUrl = `${this.restUrl}/user_progress?user_id=eq.${userId}&select=total_xp,current_level&limit=1`;

      const [profileResponse, progressResponse] = await Promise.all([
        fetch(profileUrl, { headers: this.headers(userToken) }),
        fetch(progressUrl, { headers: this.headers(userToken) }).catch(
          () => null,
        ),
      ]);

      if (!profileResponse.ok) {
        throw new InternalServerErrorException('Failed to fetch profile stats');
      }

      const [profile] = await profileResponse.json();

      let progress: { total_xp?: number; current_level?: number } | null = null;
      if (progressResponse?.ok) {
        const rows = await progressResponse.json();
        progress = rows[0] ?? null;
      }

      // Get achievements count
      const achievementsUrl = `${this.restUrl}/user_achievements?user_id=eq.${userId}&select=id`;
      const achievementsResponse = await fetch(achievementsUrl, {
        headers: this.headers(userToken),
      });
      const achievements = await achievementsResponse.json();

      // Get badges count
      const badgesUrl = `${this.restUrl}/user_badges?user_id=eq.${userId}&select=id`;
      const badgesResponse = await fetch(badgesUrl, {
        headers: this.headers(userToken),
      });
      const badges = await badgesResponse.json();

      // Always reflect the authoritative streak counter from learning_streaks
      let currentStreak = profile?.current_streak || 0;
      try {
        const streakUrl = `${this.restUrl}/learning_streaks?user_id=eq.${userId}&streak_type=eq.daily_login&select=current_count&order=updated_at.desc&limit=1`;
        const streakResponse = await fetch(streakUrl, {
          headers: this.headers(userToken),
        });
        if (streakResponse.ok) {
          const streakRows = await streakResponse.json();
          const latest = streakRows?.[0];
          if (latest && typeof latest.current_count === 'number') {
            currentStreak = Math.max(currentStreak, latest.current_count);
          }
        } else if (streakResponse.status !== 404) {
          const text = await streakResponse.text().catch(() => '');
          this.logger.warn(
            `learning_streaks fetch failed in getUserStats: ${streakResponse.status} ${text}`,
          );
        }
      } catch (error) {
        this.logger.debug(
          `learning_streaks fetch error in getUserStats: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const totalPoints =
        typeof progress?.total_xp === 'number'
          ? progress.total_xp
          : profile?.total_points || 0;
      const currentLevel =
        typeof progress?.current_level === 'number'
          ? progress.current_level
          : profile?.current_level || 1;

      return {
        total_points: totalPoints,
        current_level: currentLevel,
        current_streak: currentStreak,
        longest_streak: profile?.longest_streak || 0,
        achievements_count: achievements?.length || 0,
        badges_count: badges?.length || 0,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `Get user stats failed: ${error.message}`,
      );
    }
  }

  // Get level progression information for user
  async getLevelProgression(userId: string, userToken?: string): Promise<any> {
    try {
      // Get user's current stats
      const stats = await this.getUserStats(userId, userToken);

      // Get all level configurations
      const levelsUrl = `${this.restUrl}/level_config?select=*&order=level.asc`;
      const levelsResponse = await fetch(levelsUrl, {
        headers: this.headers(userToken),
      });

      if (!levelsResponse.ok) {
        throw new InternalServerErrorException(
          'Failed to fetch level configurations',
        );
      }

      const levels = await levelsResponse.json();

      // Find current level details
      const currentLevelConfig = levels.find(
        (l: any) => l.level === stats.current_level,
      );

      // Find next level
      const nextLevelConfig = levels.find(
        (l: any) => l.level === stats.current_level + 1,
      );

      // Calculate progress to next level
      let progressToNext = 0;
      let pointsNeeded = 0;

      if (nextLevelConfig) {
        const currentLevelPoints = currentLevelConfig?.points_required || 0;
        const nextLevelPoints = nextLevelConfig.points_required;
        const pointsInCurrentLevel = stats.total_points - currentLevelPoints;
        const pointsRequiredForNext = nextLevelPoints - currentLevelPoints;

        progressToNext = Math.min(
          100,
          Math.max(0, (pointsInCurrentLevel / pointsRequiredForNext) * 100),
        );
        pointsNeeded = Math.max(0, nextLevelPoints - stats.total_points);
      }

      return {
        currentLevel: {
          level: stats.current_level,
          title: currentLevelConfig?.title || `Level ${stats.current_level}`,
          description: currentLevelConfig?.description || '',
          icon: currentLevelConfig?.icon || '',
          color: currentLevelConfig?.color || '#6366f1',
          rewards: currentLevelConfig?.rewards || {},
        },
        nextLevel: nextLevelConfig
          ? {
              level: nextLevelConfig.level,
              title: nextLevelConfig.title,
              description: nextLevelConfig.description,
              icon: nextLevelConfig.icon,
              color: nextLevelConfig.color,
              pointsRequired: nextLevelConfig.points_required,
              rewards: nextLevelConfig.rewards || {},
            }
          : null,
        progression: {
          totalPoints: stats.total_points,
          progressToNext: Math.round(progressToNext),
          pointsNeeded: pointsNeeded,
          isMaxLevel: !nextLevelConfig,
        },
        allLevels: levels.map((level: any) => ({
          level: level.level,
          title: level.title,
          pointsRequired: level.points_required,
          isUnlocked: stats.total_points >= level.points_required,
          isCurrent: level.level === stats.current_level,
        })),
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `Get level progression failed: ${error.message}`,
      );
    }
  }

  // Get user's achievements
  async getUserAchievements(
    userId: string,
    userToken?: string,
  ): Promise<UserAchievement[]> {
    try {
      const url = `${this.restUrl}/user_achievements?user_id=eq.${userId}&select=*,achievement_types(*)&order=earned_at.desc`;
      const response = await fetch(url, {
        headers: this.headers(userToken),
      });

      if (!response.ok) {
        throw new InternalServerErrorException('Failed to fetch achievements');
      }

      const achievements = await response.json();
      return achievements.map((item: any) => ({
        ...item,
        achievement: item.achievement_types,
      }));
    } catch (error) {
      throw new InternalServerErrorException(
        `Get achievements failed: ${error.message}`,
      );
    }
  }

  // Get user's points history
  async getPointsHistory(
    userId: string,
    limit = 50,
    userToken?: string,
  ): Promise<PointsHistory[]> {
    try {
      const url = `${this.restUrl}/points_history?user_id=eq.${userId}&select=*&order=created_at.desc&limit=${limit}`;
      const response = await fetch(url, {
        headers: this.headers(userToken),
      });

      if (!response.ok) {
        throw new InternalServerErrorException(
          'Failed to fetch points history',
        );
      }

      return await response.json();
    } catch (error) {
      throw new InternalServerErrorException(
        `Get points history failed: ${error.message}`,
      );
    }
  }

  // Dynamic reward multiplier system
  async calculateDynamicRewardMultiplier(
    userId: string,
    activityType: string,
    userToken?: string,
  ): Promise<number> {
    try {
      const analysis = await this.getAdvancedUserAnalysis(userId, userToken);
      let multiplier = 1.0;

      // Engagement trend bonuses
      if (analysis.engagementTrend === 'increasing') multiplier *= 1.2;
      else if (analysis.engagementTrend === 'decreasing') multiplier *= 1.5; // Recovery bonus

      // Streak bonuses
      if (analysis.currentStreak > 7) multiplier *= 1.3;
      else if (analysis.currentStreak > 30) multiplier *= 1.5;

      // Time-based multipliers
      const currentHour = new Date().getHours();
      if (currentHour >= 6 && currentHour <= 9) multiplier *= 1.1; // Morning bonus
      if (currentHour >= 22 || currentHour <= 5) multiplier *= 1.2; // Late night dedication

      // Weekend multiplier
      const dayOfWeek = new Date().getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) multiplier *= 1.15;

      // Activity-specific multipliers
      const activityFrequency = analysis.recentActivities.filter(
        (a: any) => a.activity_type === activityType,
      ).length;
      if (activityFrequency < 3) multiplier *= 1.2; // Bonus for trying new activities

      return Math.min(2.0, multiplier); // Cap at 2x multiplier
    } catch (error) {
      console.error('Failed to calculate dynamic reward multiplier:', error);
      return 1.0;
    }
  }

  // Adaptive difficulty system
  async getAdaptiveDifficulty(
    userId: string,
    challengeType: string,
    userToken?: string,
  ): Promise<string> {
    try {
      const patterns = await this.getCompletionPatterns(userId, userToken);
      const recentPerformance = patterns.averageCompletionRate;

      // Adjust difficulty based on recent performance
      if (recentPerformance > 0.85) {
        return 'hard'; // User is succeeding, increase challenge
      } else if (recentPerformance < 0.4) {
        return 'easy'; // User struggling, provide easier challenges
      }

      return 'medium'; // Balanced approach
    } catch (error) {
      console.error('Failed to calculate adaptive difficulty:', error);
      return 'medium';
    }
  }

  // Micro-rewards system for small achievements
  async awardMicroReward(
    userId: string,
    microAchievement: string,
    contextData: any = {},
    userToken?: string,
  ): Promise<void> {
    const microRewards = {
      first_question_of_day: 5,
      perfect_first_try: 10,
      quick_learner: 8,
      consistent_daily: 15,
      improvement_shown: 12,
      helpful_feedback: 6,
    };

    const basePoints =
      microRewards[microAchievement as keyof typeof microRewards] || 5;
    const multiplier = await this.calculateDynamicRewardMultiplier(
      userId,
      microAchievement,
      userToken,
    );
    const finalPoints = Math.round(basePoints * multiplier);

    const scopeHint: ScopeXpContext | undefined =
      contextData?.scopes && typeof contextData.scopes === 'object'
        ? contextData.scopes
        : undefined;

    await this.awardPoints(
      userId,
      finalPoints,
      `micro_reward_${microAchievement}`,
      contextData.referenceId,
      'micro_achievement',
      userToken,
      scopeHint,
    );

    // Create a micro-notification
    await this.createMicroNotification(
      userId,
      microAchievement,
      finalPoints,
      userToken,
    );
  }

  private async createMicroNotification(
    userId: string,
    achievement: string,
    points: number,
    userToken?: string,
  ): Promise<void> {
    const notifications = {
      first_question_of_day: {
        title: '🌟 Early Bird!',
        message: `Great start! +${points} XP`,
      },
      perfect_first_try: {
        title: '🎯 Bullseye!',
        message: `Perfect on first try! +${points} XP`,
      },
      quick_learner: {
        title: '⚡ Lightning Fast!',
        message: `Quick thinking! +${points} XP`,
      },
      consistent_daily: {
        title: '🔥 Consistency!',
        message: `Daily dedication pays off! +${points} XP`,
      },
      improvement_shown: {
        title: '📈 Growing!',
        message: `Clear improvement! +${points} XP`,
      },
      helpful_feedback: {
        title: '💡 Insightful!',
        message: `Great feedback! +${points} XP`,
      },
    };

    const notification = notifications[
      achievement as keyof typeof notifications
    ] || { title: '⭐ Nice!', message: `Well done! +${points} XP` };

    try {
      const url = `${this.restUrl}/gamification_notifications`;
      await fetch(url, {
        method: 'POST',
        headers: this.headers(userToken),
        body: JSON.stringify({
          user_id: userId,
          type: 'micro_reward',
          title: notification.title,
          message: notification.message,
          data: { achievement, points },
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
        }),
      });
    } catch (error) {
      console.error('Failed to create micro notification:', error);
    }
  }

  // Contextual achievement system
  async checkContextualAchievements(
    userId: string,
    activityData: any,
    userToken?: string,
  ): Promise<string[]> {
    const triggered: string[] = [];
    const analysis = await this.getAdvancedUserAnalysis(userId, userToken);

    // Time-based contextual achievements
    const currentHour = new Date().getHours();
    if (
      currentHour >= 5 &&
      currentHour <= 7 &&
      !analysis.recentActivities.some(
        (a: any) =>
          new Date(a.created_at).getHours() >= 5 &&
          new Date(a.created_at).getHours() <= 7,
      )
    ) {
      triggered.push('early_bird_learner');
    }

    // Performance pattern achievements
    if (
      activityData.activityType === 'quiz_completed' &&
      activityData.score === 100
    ) {
      const recentPerfects = analysis.recentActivities.filter(
        (a: any) =>
          a.activity_type === 'quiz_completed' && a.metadata?.score === 100,
      ).length;

      if (recentPerfects >= 2) {
        triggered.push('perfectionist_streak');
      }
    }

    // Learning velocity achievements
    if (
      activityData.durationMinutes &&
      activityData.durationMinutes < 10 &&
      activityData.completed
    ) {
      triggered.push('speed_learner_badge');
    }

    // Consistency achievements
    const todaysActivities = analysis.recentActivities.filter(
      (a: any) =>
        new Date(a.created_at).toDateString() === new Date().toDateString(),
    );

    if (todaysActivities.length === 1) {
      triggered.push('first_action_today');
    } else if (todaysActivities.length >= 5) {
      triggered.push('highly_active_day');
    }

    // Award all triggered achievements
    for (const achievement of triggered) {
      try {
        await this.awardAchievement(
          userId,
          achievement,
          activityData,
          userToken,
        );
      } catch (error) {
        console.error(
          `Failed to award contextual achievement ${achievement}:`,
          error,
        );
      }
    }

    return triggered;
  }

  // Dynamic leaderboard with contextual rankings
  async getDynamicLeaderboard(
    userId: string,
    context = 'weekly',
    userToken?: string,
  ): Promise<any> {
    try {
      const timeframes = {
        daily: 1,
        weekly: 7,
        monthly: 30,
        allTime: 365,
      };

      const days = timeframes[context as keyof typeof timeframes] || 7;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Get contextual rankings based on user's level and activity patterns
      const url = `${this.restUrl}/rpc/get_dynamic_leaderboard`;
      const response = await fetch(url, {
        method: 'POST',
        headers: this.headers(userToken),
        body: JSON.stringify({
          p_user_id: userId,
          p_context: context,
          p_start_date: startDate.toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch dynamic leaderboard');
      }

      const leaderboardData = await response.json();

      // Add personalized insights
      const userAnalysis = await this.getAdvancedUserAnalysis(
        userId,
        userToken,
      );
      const insights = this.generateLeaderboardInsights(
        leaderboardData,
        userAnalysis,
      );

      return {
        ...leaderboardData,
        personalizedInsights: insights,
        nextMilestone: this.calculateNextMilestone(
          leaderboardData.userRank,
          leaderboardData.userPoints,
        ),
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `Get dynamic leaderboard failed: ${error.message}`,
      );
    }
  }

  private generateLeaderboardInsights(
    leaderboard: any,
    userAnalysis: any,
  ): LeaderboardInsight[] {
    const insights: LeaderboardInsight[] = [];

    if (userAnalysis.engagementTrend === 'increasing') {
      insights.push({
        type: 'positive_trend',
        message: "You're on fire! Your engagement is trending upward 📈",
        suggestion: 'Keep this momentum going to climb the leaderboard!',
      });
    }

    const rankImprovement = leaderboard.rankChange || 0;
    if (rankImprovement > 0) {
      insights.push({
        type: 'rank_improvement',
        message: `You've climbed ${rankImprovement} positions! 🚀`,
        suggestion: "You're making great progress!",
      });
    }

    return insights;
  }

  private calculateNextMilestone(
    currentRank: number,
    currentPoints: number,
  ): any {
    // Calculate what user needs to reach next rank or point milestone
    const nextRankPoints =
      currentPoints + Math.ceil((currentRank - 1) * 0.1 * currentPoints);
    const pointsNeeded = nextRankPoints - currentPoints;

    return {
      type: 'rank_improvement',
      target: currentRank - 1,
      pointsNeeded,
      estimatedDays: Math.ceil(pointsNeeded / 50), // Assuming 50 points per day average
      message: `${pointsNeeded} more points to reach rank ${currentRank - 1}!`,
    };
  }

  // Get daily challenges for user (with dynamic generation)
  async getDailyChallenges(
    userId: string,
    userToken?: string,
  ): Promise<DailyChallenge[]> {
    try {
      const date = new Date().toISOString().split('T')[0];

      // First, try to get existing challenges for today
      const challengesUrl = `${this.restUrl}/daily_challenges?date_active=eq.${date}&is_active=eq.true&select=*`;
      const response = await fetch(challengesUrl, {
        headers: this.headers(userToken),
      });

      let challenges: any[] = [];
      if (response.ok) {
        challenges = await response.json();
      }

      // If no challenges exist for today, generate them dynamically
      if (challenges.length === 0) {
        challenges = await this.generateDynamicChallenges(
          userId,
          date,
          userToken,
        );
      }

      // Get user's progress for these challenges
      const challengeIds = challenges.map((c: any) => c.id);
      if (challengeIds.length === 0) return [];

      const progressUrl = `${this.restUrl}/user_daily_challenge_progress?user_id=eq.${userId}&challenge_id=in.(${challengeIds.join(',')})&select=*`;
      const progressResponse = await fetch(progressUrl, {
        headers: this.headers(userToken),
      });

      const progress = progressResponse.ok ? await progressResponse.json() : [];

      return challenges.map((challenge: any) => ({
        ...challenge,
        progress: progress.find((p: any) => p.challenge_id === challenge.id),
      }));
    } catch (error) {
      throw new InternalServerErrorException(
        `Get daily challenges failed: ${error.message}`,
      );
    }
  }

  // Generate truly dynamic challenges based on comprehensive user analysis
  private async generateDynamicChallenges(
    userId: string,
    date: string,
    userToken?: string,
  ): Promise<any[]> {
    try {
      // Get comprehensive user profile for advanced personalization
      const userAnalysis = await this.getAdvancedUserAnalysis(
        userId,
        userToken,
      );

      // Dynamic challenge templates based on advanced analysis
      const challengeTemplates =
        await this.getAdvancedDynamicChallengeTemplates(
          userId,
          userAnalysis,
          date,
          userToken,
        );

      // Select optimal challenges using ML-like scoring
      const selectedChallenges = this.selectOptimalChallengesAdvanced(
        challengeTemplates,
        userAnalysis,
      );

      // Create challenges in database with enhanced metadata
      const createdChallenges: any[] = [];
      for (const template of selectedChallenges) {
        const challengeData = {
          ...template,
          date_active: date,
          is_active: true,
          created_at: new Date().toISOString(),
          metadata: {
            ...template.metadata,
            generated_for_user: userId,
            personalization_factors: template.personalizationFactors,
            expected_engagement: template.expectedEngagement,
          },
        };

        const createUrl = `${this.restUrl}/daily_challenges`;
        const createResponse = await fetch(createUrl, {
          method: 'POST',
          headers: {
            ...this.headers(userToken),
            Prefer: 'return=representation',
          },
          body: JSON.stringify(challengeData),
        });

        if (createResponse.ok) {
          const [createdChallenge] = await createResponse.json();
          createdChallenges.push(createdChallenge);
        }
      }

      return createdChallenges;
    } catch (error) {
      console.error('Failed to generate dynamic challenges:', error);
      return [];
    }
  }

  // Advanced user analysis for sophisticated personalization
  private async getAdvancedUserAnalysis(
    userId: string,
    userToken?: string,
  ): Promise<any> {
    try {
      const [stats, recentActivities, completionPatterns, preferences] =
        await Promise.all([
          this.getUserStats(userId, userToken),
          this.getRecentActivities(userId, userToken),
          this.getCompletionPatterns(userId, userToken),
          this.getUserPreferences(userId, userToken),
        ]);

      return {
        level: stats.current_level || 1,
        totalPoints: stats.total_points || 0,
        currentStreak: stats.current_streak || 0,
        longestStreak: stats.longest_streak || 0,
        achievementsCount: stats.achievements_count || 0,
        recentActivities,
        completionPatterns,
        preferences,
        engagementTrend: this.calculateEngagementTrend(recentActivities),
        difficultyTolerance:
          this.calculateDifficultyTolerance(completionPatterns),
        motivationFactors: this.identifyMotivationFactors(
          stats,
          recentActivities,
        ),
        optimalChallengeTypes:
          this.identifyOptimalChallengeTypes(completionPatterns),
      };
    } catch (error) {
      console.error('Failed to get advanced user analysis:', error);
      return { level: 1, totalPoints: 0, currentStreak: 0 };
    }
  }

  private async getRecentActivities(
    userId: string,
    userToken?: string,
  ): Promise<any[]> {
    const url = `${this.restUrl}/user_activities?user_id=eq.${userId}&select=*&order=created_at.desc&limit=50`;
    const response = await fetch(url, { headers: this.headers(userToken) });
    return response.ok ? await response.json() : [];
  }

  private async getCompletionPatterns(
    userId: string,
    userToken?: string,
  ): Promise<any> {
    const url = `${this.restUrl}/user_daily_challenge_progress?user_id=eq.${userId}&select=*,daily_challenges(*)&order=date_attempted.desc&limit=30`;
    const response = await fetch(url, { headers: this.headers(userToken) });
    const history = response.ok ? await response.json() : [];

    const patterns = {
      averageCompletionRate: 0,
      preferredDifficulty: 'medium',
      completionTimePatterns: {},
      failureReasons: [],
      successFactors: [],
    };

    if (history.length > 0) {
      const completed = history.filter((h: any) => h.completed_at);
      patterns.averageCompletionRate = completed.length / history.length;

      // Analyze preferred difficulty based on completion rates
      const difficultyStats = history.reduce((acc: any, item: any) => {
        const difficulty = item.daily_challenges?.difficulty_level || 'medium';
        if (!acc[difficulty]) acc[difficulty] = { total: 0, completed: 0 };
        acc[difficulty].total++;
        if (item.completed_at) acc[difficulty].completed++;
        return acc;
      }, {});

      let bestRate = 0;
      for (const [diff, stats] of Object.entries(difficultyStats) as any) {
        const rate = stats.completed / stats.total;
        if (rate > bestRate) {
          bestRate = rate;
          patterns.preferredDifficulty = diff;
        }
      }
    }

    return patterns;
  }

  private async getUserPreferences(
    userId: string,
    userToken?: string,
  ): Promise<any> {
    const url = `${this.restUrl}/profiles?id=eq.${userId}&select=gamification_preferences`;
    const response = await fetch(url, { headers: this.headers(userToken) });
    const profiles = response.ok ? await response.json() : [];
    return profiles[0]?.gamification_preferences || {};
  }

  private calculateEngagementTrend(activities: any[]): string {
    if (activities.length < 7) return 'new_user';

    const recent = activities.slice(0, 7);
    const older = activities.slice(7, 14);

    const recentEngagement = recent.length;
    const olderEngagement = older.length;

    if (recentEngagement > olderEngagement * 1.2) return 'increasing';
    if (recentEngagement < olderEngagement * 0.8) return 'decreasing';
    return 'stable';
  }

  private calculateDifficultyTolerance(patterns: any): string {
    if (patterns.averageCompletionRate > 0.8) return 'high';
    if (patterns.averageCompletionRate > 0.5) return 'medium';
    return 'low';
  }

  private identifyMotivationFactors(stats: any, activities: any[]): string[] {
    const factors: string[] = [];

    if (stats.currentStreak > 7) factors.push('consistency');
    if (stats.achievementsCount > stats.level * 2)
      factors.push('achievement_oriented');
    if (
      activities.filter((a: any) => a.activity_type === 'quiz_completed')
        .length >
      activities.length * 0.6
    ) {
      factors.push('quiz_focused');
    }
    if (stats.totalPoints > stats.level * 500) factors.push('points_motivated');

    return factors.length > 0 ? factors : ['exploration'];
  }

  private identifyOptimalChallengeTypes(patterns: any): string[] {
    // This would analyze which challenge types the user completes most often
    return ['quiz_completion', 'course_progress', 'time_spent']; // Default set
  }

  // Advanced dynamic challenge templates with deep personalization
  private async getAdvancedDynamicChallengeTemplates(
    userId: string,
    analysis: any,
    date: string,
    userToken?: string,
  ): Promise<any[]> {
    const templates: any[] = [];
    const today = new Date(date);
    const dayOfWeek = today.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const currentHour = new Date().getHours();

    // Adaptive base challenges based on user analysis
    const baseTemplates = this.getAdaptiveBaseTemplates(analysis);
    templates.push(...baseTemplates);

    // Seasonal and event-based challenges
    const seasonalTemplates = this.getSeasonalChallenges(date, analysis);
    templates.push(...seasonalTemplates);

    // Time-sensitive contextual challenges
    const contextualTemplates = this.getContextualChallenges(
      analysis,
      dayOfWeek,
      currentHour,
    );
    templates.push(...contextualTemplates);

    // Community and social challenges
    const socialTemplates = await this.getSocialChallenges(
      userId,
      analysis,
      userToken,
    );
    templates.push(...socialTemplates);

    // Recovery and motivation challenges based on engagement trend
    if (analysis.engagementTrend === 'decreasing') {
      const recoveryTemplates = this.getRecoveryChallenges(analysis);
      templates.push(...recoveryTemplates);
    }

    // Advanced achievement-oriented challenges
    if (analysis.motivationFactors.includes('achievement_oriented')) {
      const achievementTemplates =
        this.getAdvancedAchievementChallenges(analysis);
      templates.push(...achievementTemplates);
    }

    // Learning path optimization challenges
    const optimizationTemplates =
      await this.getLearningPathOptimizationChallenges(
        userId,
        analysis,
        userToken,
      );
    templates.push(...optimizationTemplates);

    return templates;
  }

  private getAdaptiveBaseTemplates(analysis: any): any[] {
    const {
      level,
      difficultyTolerance,
      motivationFactors,
      optimalChallengeTypes,
      currentStreak,
    } = analysis;
    const templates: any[] = [];

    // Adaptive quiz challenges with personalized scaling
    templates.push({
      title: this.getPersonalizedTitle('quiz', motivationFactors),
      description: `Complete ${this.calculateOptimalTarget('quiz', level, difficultyTolerance)} quizzes`,
      challenge_type: 'quiz_completion',
      target_value: this.calculateOptimalTarget(
        'quiz',
        level,
        difficultyTolerance,
      ),
      points_reward: this.calculateDynamicReward(
        'quiz',
        level,
        difficultyTolerance,
      ),
      difficulty_level: this.mapDifficultyTolerance(difficultyTolerance),
      priority: optimalChallengeTypes.includes('quiz_completion') ? 1.2 : 0.8,
      personalizationFactors: ['difficulty_adaptive', 'reward_optimized'],
      expectedEngagement: this.calculateExpectedEngagement('quiz', analysis),
      metadata: {
        adaptive_scaling: true,
        personalization_level: 'high',
      },
    });

    // Adaptive time-based learning with smart scheduling
    const optimalStudyTime = this.calculateOptimalStudyTime(
      level,
      analysis.recentActivities,
    );
    templates.push({
      title: this.getPersonalizedTitle('study', motivationFactors),
      description: `Spend ${optimalStudyTime} minutes in focused learning`,
      challenge_type: 'time_spent',
      target_value: optimalStudyTime,
      points_reward: this.calculateDynamicReward(
        'time',
        level,
        difficultyTolerance,
      ),
      difficulty_level:
        optimalStudyTime > 45
          ? 'hard'
          : optimalStudyTime > 25
            ? 'medium'
            : 'easy',
      priority: this.calculateTimePriority(analysis),
      personalizationFactors: ['time_optimized', 'schedule_aware'],
      expectedEngagement: this.calculateExpectedEngagement('time', analysis),
      metadata: {
        optimal_time_calculated: true,
        activity_pattern_based: true,
      },
    });

    // Streak-aware challenges with dynamic motivation
    if (currentStreak > 0) {
      templates.push({
        title: `Streak Superhero (Day ${currentStreak + 1})`,
        description: `Keep your incredible ${currentStreak}-day streak alive!`,
        challenge_type: 'streak_maintain',
        target_value: 1,
        points_reward: Math.min(20 + currentStreak * 3, 100),
        difficulty_level: 'easy',
        priority: 1.5, // High priority for streak maintainers
        personalizationFactors: ['streak_motivated', 'consistency_rewarded'],
        expectedEngagement: 0.9,
        metadata: {
          current_streak: currentStreak,
          streak_milestone: currentStreak % 7 === 0,
        },
      });
    }

    return templates;
  }

  private getSeasonalChallenges(date: string, analysis: any): any[] {
    const templates: any[] = [];
    const currentDate = new Date(date);
    const month = currentDate.getMonth();
    const dayOfMonth = currentDate.getDate();

    // New Year motivation boost
    if (month === 0 && dayOfMonth <= 31) {
      templates.push({
        title: 'New Year, New Knowledge',
        description: 'Start the year strong with extra learning',
        challenge_type: 'new_year_boost',
        target_value: 2,
        points_reward: 60 + analysis.level * 5,
        difficulty_level: 'medium',
        priority: 1.1,
        personalizationFactors: ['seasonal', 'motivation_boost'],
        expectedEngagement: 0.8,
        metadata: { seasonal_event: 'new_year' },
      });
    }

    // Mid-week motivation (Wednesday)
    if (currentDate.getDay() === 3) {
      templates.push({
        title: 'Wednesday Wisdom',
        description: 'Conquer the mid-week learning challenge',
        challenge_type: 'midweek_boost',
        target_value: 1,
        points_reward: 35,
        difficulty_level: 'easy',
        priority: 0.9,
        personalizationFactors: ['temporal', 'motivation_timing'],
        expectedEngagement: 0.7,
      });
    }

    return templates;
  }

  private getContextualChallenges(
    analysis: any,
    dayOfWeek: number,
    currentHour: number,
  ): any[] {
    const templates: any[] = [];
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Morning momentum challenges (6-10 AM)
    if (currentHour >= 6 && currentHour <= 10) {
      templates.push({
        title: 'Morning Momentum',
        description: 'Start your day with learning energy',
        challenge_type: 'morning_boost',
        target_value: 1,
        points_reward: 40,
        difficulty_level: 'easy',
        priority: 1.0,
        personalizationFactors: ['circadian_optimized'],
        expectedEngagement: 0.8,
        metadata: { optimal_time_slot: 'morning' },
      });
    }

    // Weekend warrior challenges
    if (isWeekend) {
      templates.push({
        title: 'Weekend Learning Adventure',
        description: 'Make weekends count with extra exploration',
        challenge_type: 'weekend_explorer',
        target_value: Math.max(2, Math.floor(analysis.level / 2)),
        points_reward: 50 + analysis.level * 8,
        difficulty_level: 'medium',
        priority: 1.2,
        personalizationFactors: ['weekend_optimized', 'exploration_focused'],
        expectedEngagement: 0.75,
        metadata: { weekend_special: true },
      });
    }

    return templates;
  }

  private async getSocialChallenges(
    userId: string,
    analysis: any,
    userToken?: string,
  ): Promise<any[]> {
    // Get peer comparison data for social challenges
    try {
      const peerDataUrl = `${this.restUrl}/rpc/get_peer_comparison`;
      const response = await fetch(peerDataUrl, {
        method: 'POST',
        headers: this.headers(userToken),
        body: JSON.stringify({ p_user_id: userId, p_level_range: 2 }),
      });

      const peerData = response.ok ? await response.json() : null;
      const templates: any[] = [];

      if (peerData && peerData.length > 0) {
        const avgPeerPoints =
          peerData.reduce(
            (sum: number, peer: any) => sum + peer.weekly_points,
            0,
          ) / peerData.length;

        templates.push({
          title: 'Peer Challenge',
          description: `Match the average weekly points of your peer group (${Math.round(avgPeerPoints)} points)`,
          challenge_type: 'peer_competition',
          target_value: Math.round(avgPeerPoints),
          points_reward: 75,
          difficulty_level: 'medium',
          priority: analysis.motivationFactors.includes('achievement_oriented')
            ? 1.3
            : 0.7,
          personalizationFactors: ['social_comparison', 'peer_motivated'],
          expectedEngagement: 0.8,
          metadata: { peer_average: avgPeerPoints, social_challenge: true },
        });
      }

      return templates;
    } catch (error) {
      return [];
    }
  }

  private getRecoveryChallenges(analysis: any): any[] {
    // Gentle re-engagement challenges for users with decreasing engagement
    return [
      {
        title: 'Welcome Back Champion',
        description: "Let's ease back into learning with a gentle challenge",
        challenge_type: 'recovery_gentle',
        target_value: 1,
        points_reward: 25,
        difficulty_level: 'easy',
        priority: 1.4, // High priority for recovery
        personalizationFactors: ['recovery_focused', 'gentle_reengagement'],
        expectedEngagement: 0.9,
        metadata: { recovery_challenge: true, engagement_trend: 'decreasing' },
      },
    ];
  }

  private getAdvancedAchievementChallenges(analysis: any): any[] {
    const templates: any[] = [];

    // Multi-step progressive challenges
    templates.push({
      title: 'Achievement Hunter',
      description: 'Complete challenges across 3 different categories today',
      challenge_type: 'achievement_hunter',
      target_value: 3,
      points_reward: 100,
      difficulty_level: 'hard',
      priority: 1.2,
      personalizationFactors: ['achievement_focused', 'variety_seeking'],
      expectedEngagement: 0.85,
      metadata: { multi_category: true, achievement_oriented: true },
    });

    return templates;
  }

  private async getLearningPathOptimizationChallenges(
    userId: string,
    analysis: any,
    userToken?: string,
  ): Promise<any[]> {
    // Challenges that help optimize learning paths based on user's goals and progress
    const templates: any[] = [];

    // Skill gap analysis challenge
    templates.push({
      title: 'Skill Gap Closer',
      description: 'Focus on your weakest subject area today',
      challenge_type: 'skill_optimization',
      target_value: 2,
      points_reward: 60,
      difficulty_level: 'medium',
      priority: 1.0,
      personalizationFactors: ['skill_gap_analysis', 'growth_focused'],
      expectedEngagement: 0.7,
      metadata: { optimization_based: true, skill_development: true },
    });

    return templates;
  }

  private getPersonalizedTitle(
    challengeType: string,
    motivationFactors: string[],
  ): string {
    const titleVariants = {
      quiz: [
        'Quiz Master Challenge',
        'Knowledge Crusher',
        'Quiz Champion Quest',
        'Brain Power Challenge',
      ],
      study: [
        'Focus Time Challenge',
        'Deep Learning Session',
        'Concentration Quest',
        'Study Power Hour',
      ],
    };

    const variants = titleVariants[
      challengeType as keyof typeof titleVariants
    ] || ['Learning Challenge'];
    return variants[Math.floor(Math.random() * variants.length)];
  }

  private calculateOptimalTarget(
    challengeType: string,
    level: number,
    difficultyTolerance: string,
  ): number {
    const baseTargets = {
      quiz: { low: 1, medium: 2, high: 3 },
      time: { low: 15, medium: 25, high: 40 },
      course: { low: 1, medium: 2, high: 3 },
    };

    const base =
      baseTargets[challengeType as keyof typeof baseTargets]?.[
        difficultyTolerance
      ] || 2;
    const levelMultiplier = Math.min(1 + (level - 1) * 0.2, 2.5);
    return Math.round(base * levelMultiplier);
  }

  private calculateDynamicReward(
    challengeType: string,
    level: number,
    difficultyTolerance: string,
  ): number {
    const baseRewards = {
      quiz: { low: 20, medium: 35, high: 50 },
      time: { low: 15, medium: 25, high: 40 },
      course: { low: 30, medium: 45, high: 60 },
    };

    const base =
      baseRewards[challengeType as keyof typeof baseRewards]?.[
        difficultyTolerance
      ] || 30;
    return base + level * 5;
  }

  private calculateExpectedEngagement(
    challengeType: string,
    analysis: any,
  ): number {
    // ML-like scoring for expected user engagement
    let score = 0.5; // Base score

    if (analysis.optimalChallengeTypes.includes(challengeType)) score += 0.3;
    if (analysis.engagementTrend === 'increasing') score += 0.2;
    if (analysis.difficultyTolerance === 'high') score += 0.1;

    return Math.min(0.95, Math.max(0.1, score));
  }

  private mapDifficultyTolerance(tolerance: string): string {
    return tolerance === 'high'
      ? 'hard'
      : tolerance === 'low'
        ? 'easy'
        : 'medium';
  }

  private calculateOptimalStudyTime(level: number, activities: any[]): number {
    const recentStudySessions = activities.filter(
      (a: any) => a.duration_minutes > 0,
    );
    const avgSession =
      recentStudySessions.length > 0
        ? recentStudySessions.reduce(
            (sum: number, a: any) => sum + a.duration_minutes,
            0,
          ) / recentStudySessions.length
        : 20;

    return Math.min(60, Math.max(15, Math.round(avgSession * 1.2)));
  }

  private calculateTimePriority(analysis: any): number {
    if (
      analysis.recentActivities.filter(
        (a: any) => a.activity_type === 'lecture_viewed',
      ).length > 5
    )
      return 1.2;
    return 0.9;
  }

  private selectOptimalChallengesAdvanced(
    templates: any[],
    analysis: any,
  ): any[] {
    // Advanced challenge selection using engagement scoring
    const scoredTemplates = templates
      .map((template) => ({
        ...template,
        selectionScore: this.calculateSelectionScore(template, analysis),
      }))
      .sort((a, b) => b.selectionScore - a.selectionScore);

    const selected: any[] = [];
    const maxChallenges = Math.min(4 + Math.floor(analysis.level / 3), 6);

    // Ensure variety in challenge types and difficulties
    const usedTypes = new Set();
    const difficultyCount = { easy: 0, medium: 0, hard: 0 };

    for (const template of scoredTemplates) {
      if (selected.length >= maxChallenges) break;

      const hasTypeVariety =
        !usedTypes.has(template.challenge_type) || usedTypes.size >= 3;
      const hasDifficultyBalance =
        difficultyCount[
          template.difficulty_level as keyof typeof difficultyCount
        ] < 2;

      if (hasTypeVariety && hasDifficultyBalance) {
        selected.push(template);
        usedTypes.add(template.challenge_type);
        difficultyCount[
          template.difficulty_level as keyof typeof difficultyCount
        ]++;
      }
    }

    // Fill remaining slots with highest scored challenges
    for (const template of scoredTemplates) {
      if (selected.length >= maxChallenges) break;
      if (!selected.includes(template)) {
        selected.push(template);
      }
    }

    return selected;
  }

  private calculateSelectionScore(template: any, analysis: any): number {
    let score = template.priority || 1.0;

    // Boost based on expected engagement
    score *= (template.expectedEngagement || 0.5) * 2;

    // Adjust for user's engagement trend
    if (
      analysis.engagementTrend === 'decreasing' &&
      template.difficulty_level === 'easy'
    ) {
      score *= 1.3;
    }

    // Boost for personalized challenges
    if (template.personalizationFactors?.length > 0) {
      score *= 1.2;
    }

    // Adjust for motivation factors alignment
    const motivationBonus = template.personalizationFactors?.some(
      (factor: string) =>
        analysis.motivationFactors.some((mf: string) => factor.includes(mf)),
    )
      ? 1.3
      : 1.0;

    score *= motivationBonus;

    return score;
  }

  private getDynamicChallengeTemplates(
    userLevel: number,
    currentStreak: number,
    recentActivities: any[],
  ): any[] {
    const activityCounts = recentActivities.reduce((acc, activity) => {
      acc[activity.activity_type] = (acc[activity.activity_type] || 0) + 1;
      return acc;
    }, {});

    // Base challenge templates with dynamic scaling
    const templates = [
      // Quiz completion challenges (scaled by level)
      {
        title: 'Quiz Champion',
        description: `Complete ${Math.min(2 + Math.floor(userLevel / 2), 8)} quizzes today`,
        challenge_type: 'quiz_completion',
        target_value: Math.min(2 + Math.floor(userLevel / 2), 8),
        points_reward: 30 + userLevel * 5,
        difficulty_level:
          userLevel <= 3 ? 'easy' : userLevel <= 6 ? 'medium' : 'hard',
        priority: activityCounts.quiz_completed ? 0.7 : 1.0, // Lower priority if recently active
      },

      // Learning time challenges (adaptive based on level)
      {
        title: 'Study Session',
        description: `Spend ${15 + userLevel * 5} minutes learning today`,
        challenge_type: 'time_spent',
        target_value: 15 + userLevel * 5,
        points_reward: 25 + userLevel * 3,
        difficulty_level:
          userLevel <= 2 ? 'easy' : userLevel <= 5 ? 'medium' : 'hard',
        priority: activityCounts.lecture_viewed ? 0.8 : 1.0,
      },

      // Course progress challenges
      {
        title: 'Progress Maker',
        description: `Complete ${1 + Math.floor(userLevel / 3)} course sections`,
        challenge_type: 'course_progress',
        target_value: 1 + Math.floor(userLevel / 3),
        points_reward: 40 + userLevel * 4,
        difficulty_level:
          userLevel <= 2 ? 'easy' : userLevel <= 5 ? 'medium' : 'hard',
        priority: activityCounts.course_progress ? 0.6 : 1.0,
      },

      // Streak maintenance (higher priority for users with existing streaks)
      {
        title: 'Streak Keeper',
        description: 'Maintain your daily learning streak',
        challenge_type: 'streak_maintain',
        target_value: 1,
        points_reward:
          currentStreak > 0 ? 20 + Math.min(currentStreak * 2, 50) : 15,
        difficulty_level: 'easy',
        priority: currentStreak > 0 ? 1.2 : 0.5,
      },

      // Perfect score challenge (for intermediate+ users)
      {
        title: 'Perfectionist',
        description: 'Achieve a perfect score on any quiz',
        challenge_type: 'perfect_score',
        target_value: 1,
        points_reward: 50 + userLevel * 5,
        difficulty_level: 'hard',
        priority: userLevel >= 3 ? 1.0 : 0.3,
      },

      // Social/engagement challenges
      {
        title: 'Explorer',
        description: 'View course materials from 2 different subjects',
        challenge_type: 'subject_diversity',
        target_value: 2,
        points_reward: 30 + userLevel * 3,
        difficulty_level: 'medium',
        priority: 0.8,
      },
    ];

    // Add weekend or special day bonuses
    const today = new Date();
    const isWeekend = today.getDay() === 0 || today.getDay() === 6;

    if (isWeekend) {
      templates.push({
        title: 'Weekend Warrior',
        description: 'Complete double your usual learning on the weekend',
        challenge_type: 'weekend_bonus',
        target_value: 2,
        points_reward: 60 + userLevel * 8,
        difficulty_level: 'medium',
        priority: 1.1,
      });
    }

    return templates;
  }

  private selectOptimalChallenges(templates: any[], userLevel: number): any[] {
    // Sort by priority and difficulty appropriateness
    const sortedTemplates = templates
      .filter((t) => t.priority > 0.2) // Filter out very low priority
      .sort((a, b) => b.priority - a.priority);

    const selected: any[] = [];
    const maxChallenges = Math.min(3 + Math.floor(userLevel / 4), 5); // 3-5 challenges based on level

    // Always include at least one easy challenge
    const easyChallenges = sortedTemplates.filter(
      (t) => t.difficulty_level === 'easy',
    );
    if (easyChallenges.length > 0) {
      selected.push(easyChallenges[0]);
    }

    // Add medium and hard challenges based on user level
    const remainingTemplates = sortedTemplates.filter(
      (t) => !selected.includes(t),
    );

    for (const template of remainingTemplates) {
      if (selected.length >= maxChallenges) break;

      // Avoid duplicate challenge types
      const hasSimilarType = selected.some(
        (s) => s.challenge_type === template.challenge_type,
      );
      if (!hasSimilarType) {
        selected.push(template);
      }
    }

    // Fill remaining slots with highest priority challenges
    for (const template of remainingTemplates) {
      if (selected.length >= maxChallenges) break;
      if (!selected.includes(template)) {
        selected.push(template);
      }
    }

    return selected.slice(0, maxChallenges);
  }

  // Update challenge progress
  async updateChallengeProgress(
    userId: string,
    challengeId: string,
    progressIncrement: number,
    userToken?: string,
  ): Promise<void> {
    try {
      // Get current progress
      const progressUrl = `${this.restUrl}/user_daily_challenge_progress?user_id=eq.${userId}&challenge_id=eq.${challengeId}`;
      const progressResponse = await fetch(progressUrl, {
        headers: this.headers(userToken),
      });

      let currentProgress = 0;
      if (progressResponse.ok) {
        const [existing] = await progressResponse.json();
        currentProgress = existing?.current_progress || 0;
      }

      const newProgress = currentProgress + progressIncrement;

      // Get challenge info to check if completed
      const challengeUrl = `${this.restUrl}/daily_challenges?id=eq.${challengeId}`;
      const challengeResponse = await fetch(challengeUrl, {
        headers: this.headers(userToken),
      });
      const [challenge] = await challengeResponse.json();

      const isCompleted = newProgress >= challenge.target_value;
      const updateData: any = {
        user_id: userId,
        challenge_id: challengeId,
        current_progress: newProgress,
        date_attempted: new Date().toISOString().split('T')[0],
      };

      if (isCompleted && currentProgress < challenge.target_value) {
        updateData.completed_at = new Date().toISOString();
        updateData.points_earned = challenge.points_reward;
        // Award points
        await this.awardPoints(
          userId,
          challenge.points_reward,
          'daily_challenge',
          challengeId,
          'challenge',
          userToken,
          undefined,
        );
      }

      // Upsert progress
      const upsertUrl = `${this.restUrl}/user_daily_challenge_progress`;
      const upsertResponse = await fetch(upsertUrl, {
        method: 'POST',
        headers: {
          ...this.headers(userToken),
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(updateData),
      });

      if (!upsertResponse.ok) {
        const error = await upsertResponse.text();
        throw new InternalServerErrorException(
          `Failed to update challenge progress: ${error}`,
        );
      }
    } catch (error) {
      throw new InternalServerErrorException(
        `Update challenge progress failed: ${error.message}`,
      );
    }
  }

  // Get leaderboard
  async getLeaderboard(
    leaderboardName: string,
    limit = 100,
    userToken?: string,
  ): Promise<LeaderboardEntry[]> {
    try {
      // Get leaderboard configuration
      const leaderboardUrl = `${this.restUrl}/leaderboards?name=eq.${leaderboardName}&is_active=eq.true`;
      const leaderboardResponse = await fetch(leaderboardUrl, {
        headers: this.headers(userToken),
      });

      if (!leaderboardResponse.ok) {
        throw new InternalServerErrorException('Leaderboard not found');
      }

      const [leaderboard] = await leaderboardResponse.json();
      if (!leaderboard) {
        return [];
      }

      // Get leaderboard entries
      const entriesUrl = `${this.restUrl}/leaderboard_entries?leaderboard_id=eq.${leaderboard.id}&order=rank_position.asc&limit=${limit}&select=*,profiles(full_name)`;
      const entriesResponse = await fetch(entriesUrl, {
        headers: this.headers(userToken),
      });

      if (!entriesResponse.ok) {
        // If no entries exist, calculate and cache them
        return await this.calculateLeaderboard(leaderboard, limit, userToken);
      }

      const entries = await entriesResponse.json();

      return entries.map((entry: any) => ({
        user_id: entry.user_id,
        rank_position: entry.rank_position,
        score_value: entry.score_value,
        full_name: entry.profiles?.full_name || 'Anonymous User',
      }));
    } catch (error) {
      throw new InternalServerErrorException(
        `Get leaderboard failed: ${error.message}`,
      );
    }
  }

  // Calculate and cache leaderboard data
  private async calculateLeaderboard(
    leaderboard: any,
    limit: number,
    userToken?: string,
  ): Promise<LeaderboardEntry[]> {
    try {
      let query = '';
      let orderBy = '';

      switch (leaderboard.metric_type) {
        case 'total_points':
          query = `${this.restUrl}/profiles?select=id,full_name,total_points&order=total_points.desc&limit=${limit}`;
          orderBy = 'total_points';
          break;
        case 'current_streak':
          query = `${this.restUrl}/profiles?select=id,full_name,current_streak&order=current_streak.desc&limit=${limit}`;
          orderBy = 'current_streak';
          break;
        case 'achievements_count':
          query = `${this.restUrl}/user_achievements?select=user_id,profiles(full_name),count&group=user_id&order=count.desc&limit=${limit}`;
          orderBy = 'count';
          break;
        default:
          return [];
      }

      const response = await fetch(query, {
        headers: this.headers(userToken),
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const entries: LeaderboardEntry[] = data.map(
        (item: any, index: number) => ({
          user_id: item.id || item.user_id,
          rank_position: index + 1,
          score_value: item[orderBy] || item.count || 0,
          full_name:
            item.full_name || item.profiles?.full_name || 'Anonymous User',
        }),
      );

      // Cache the results
      await this.cacheLeaderboardEntries(leaderboard.id, entries, userToken);

      return entries;
    } catch (error) {
      console.error('Failed to calculate leaderboard:', error);
      return [];
    }
  }

  // Cache leaderboard entries for performance
  private async cacheLeaderboardEntries(
    leaderboardId: string,
    entries: LeaderboardEntry[],
    userToken?: string,
  ): Promise<void> {
    try {
      // Clear existing entries
      const clearUrl = `${this.restUrl}/leaderboard_entries?leaderboard_id=eq.${leaderboardId}`;
      await fetch(clearUrl, {
        method: 'DELETE',
        headers: this.headers(userToken),
      });

      // Insert new entries
      const insertData = entries.map((entry) => ({
        leaderboard_id: leaderboardId,
        user_id: entry.user_id,
        rank_position: entry.rank_position,
        score_value: entry.score_value,
        calculated_at: new Date().toISOString(),
      }));

      const insertUrl = `${this.restUrl}/leaderboard_entries`;
      await fetch(insertUrl, {
        method: 'POST',
        headers: this.headers(userToken),
        body: JSON.stringify(insertData),
      });
    } catch (error) {
      console.error('Failed to cache leaderboard entries:', error);
    }
  }

  // Get user badges
  async getUserBadges(
    userId: string,
    userToken?: string,
  ): Promise<UserBadge[]> {
    try {
      const url = `${this.restUrl}/user_badges?user_id=eq.${userId}&select=id,badge_id,earned_at,reason,reference_id,reference_type,is_equipped,is_featured,metadata,badge:badge_catalog(*)&order=earned_at.desc`;
      const response = await fetch(url, {
        headers: this.headers(userToken),
      });

      if (!response.ok) {
        throw new InternalServerErrorException('Failed to fetch user badges');
      }

      const badges = await response.json();
      return badges.map((item: any) => ({
        ...item,
        badge: item.badge,
      }));
    } catch (error) {
      throw new InternalServerErrorException(
        `Get user badges failed: ${error.message}`,
      );
    }
  }

  // Get user notifications
  async getNotifications(
    userId: string,
    limit = 50,
    userToken?: string,
  ): Promise<Notification[]> {
    try {
      const url = `${this.restUrl}/gamification_notifications?user_id=eq.${userId}&order=created_at.desc&limit=${limit}`;
      const response = await fetch(url, {
        headers: this.headers(userToken),
      });

      if (!response.ok) {
        throw new InternalServerErrorException('Failed to fetch notifications');
      }

      return await response.json();
    } catch (error) {
      throw new InternalServerErrorException(
        `Get notifications failed: ${error.message}`,
      );
    }
  }

  // Mark notifications as read
  async markNotificationsRead(
    userId: string,
    notificationIds: string[],
    userToken?: string,
  ): Promise<void> {
    try {
      const url = `${this.restUrl}/gamification_notifications?user_id=eq.${userId}&id=in.(${notificationIds.join(',')})`;
      const response = await fetch(url, {
        method: 'PATCH',
        headers: this.headers(userToken),
        body: JSON.stringify({ is_read: true }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new InternalServerErrorException(
          `Failed to mark notifications as read: ${error}`,
        );
      }
    } catch (error) {
      throw new InternalServerErrorException(
        `Mark notifications as read failed: ${error.message}`,
      );
    }
  }

  // Record user activity and trigger gamification events
  async recordActivity(
    userId: string,
    activityType: string,
    referenceId?: string,
    referenceType?: string,
    durationMinutes?: number,
    userToken?: string,
    options?: { streakResult?: SimpleStreakUpdateResult | null },
  ): Promise<RecordActivityResult> {
    const result: RecordActivityResult = {
      success: true,
      activityType,
      pointsAwarded: 0,
    };

    try {
      const pointsMap = {
        course_started: 10,
        course_completed: 100,
        quiz_completed: 25,
        lecture_viewed: 5,
        section_completed: 20,
        perfect_score: 50,
        streak_bonus: 15,
      };

      let pointsEarned = pointsMap[activityType] || 0;

      if (activityType === 'login') {
        await logLearningActivityPresence({
          restUrl: this.restUrl,
          userId,
          activityType,
          headers: this.headers(userToken),
          category: 'login',
          logger: this.logger,
        });

        const streakResult =
          options?.streakResult ||
          (await this.updateDailyLoginStreakSimple(userId, userToken));

        result.streak = {
          action: streakResult.action,
          currentCount: streakResult.current_count,
          longestCount: streakResult.longest_count,
          updatedToday: streakResult.updated_today,
        };

        if (streakResult.updated_today) {
          pointsEarned = 5;
          result.loginReward = {
            awarded: true,
            amount: pointsEarned,
            streakCount: streakResult.current_count,
            streakAction: streakResult.action,
          };
        } else {
          pointsEarned = 0;
          result.loginReward = {
            awarded: false,
            amount: 0,
            streakCount: streakResult.current_count,
            streakAction: streakResult.action,
          };
        }
      }

      const activityData = {
        user_id: userId,
        activity_type: activityType,
        reference_id: referenceId,
        reference_type: referenceType,
        duration_minutes: durationMinutes,
        points_earned: pointsEarned,
        created_at: new Date().toISOString(),
      };

      const activityUrl = `${this.restUrl}/user_activities`;
      const activityResponse = await fetch(activityUrl, {
        method: 'POST',
        headers: {
          ...this.headers(userToken),
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(activityData),
      });

      if (!activityResponse.ok) {
        const error = await activityResponse.text();
        throw new InternalServerErrorException(
          `Failed to record activity: ${error}`,
        );
      }

      if (pointsEarned > 0) {
        const awardReason =
          activityType === 'login' ? 'daily_login_bonus' : activityType;
        await this.awardPoints(
          userId,
          pointsEarned,
          awardReason,
          referenceId,
          referenceType,
          userToken,
          undefined,
        );
        result.pointsAwarded = pointsEarned;
      }

      if (
        this.isLearningStreakActivity(activityType) &&
        activityType !== 'login'
      ) {
        await logLearningActivityPresence({
          restUrl: this.restUrl,
          userId,
          activityType,
          headers: this.headers(userToken),
          category: 'learning',
          logger: this.logger,
        });
        await this.updateDailyLoginStreakSimple(userId, userToken);
      }

      await this.checkAndAwardAchievements(userId, activityType, userToken);
      await this.updateChallengesFromActivity(
        userId,
        activityType,
        durationMinutes || 0,
        userToken,
      );

      return result;
    } catch (error) {
      throw new InternalServerErrorException(
        `Record activity failed: ${error.message}`,
      );
    }
  }

  // Check and award achievements based on activity
  private async checkAndAwardAchievements(
    userId: string,
    activityType: string,
    userToken?: string,
  ): Promise<void> {
    try {
      // Get user's current stats and activities
      const stats = await this.getUserStats(userId, userToken);
      const activitiesUrl = `${this.restUrl}/user_activities?user_id=eq.${userId}&select=activity_type`;
      const activitiesResponse = await fetch(activitiesUrl, {
        headers: this.headers(userToken),
      });
      const activities = activitiesResponse.ok
        ? await activitiesResponse.json()
        : [];

      // Count activities by type
      const activityCounts = activities.reduce((acc: any, activity: any) => {
        acc[activity.activity_type] = (acc[activity.activity_type] || 0) + 1;
        return acc;
      }, {});

      // Achievement rules
      const achievementRules = [
        { name: 'first_course_started', trigger: 'course_started', count: 1 },
        {
          name: 'first_course_completed',
          trigger: 'course_completed',
          count: 1,
        },
        { name: 'quiz_master_bronze', trigger: 'quiz_completed', count: 5 },
        { name: 'quiz_master_silver', trigger: 'quiz_completed', count: 15 },
        { name: 'quiz_master_gold', trigger: 'quiz_completed', count: 50 },
        { name: 'perfect_score', trigger: 'perfect_score', count: 1 },
        { name: 'streak_3_days', trigger: 'streak_milestone', streakCount: 3 },
        { name: 'streak_7_days', trigger: 'streak_milestone', streakCount: 7 },
        {
          name: 'streak_30_days',
          trigger: 'streak_milestone',
          streakCount: 30,
        },
        {
          name: 'streak_100_days',
          trigger: 'streak_milestone',
          streakCount: 100,
        },
        { name: 'level_5_reached', trigger: 'level_milestone', level: 5 },
        { name: 'level_10_reached', trigger: 'level_milestone', level: 10 },
        { name: 'points_1000', trigger: 'points_milestone', points: 1000 },
        { name: 'points_5000', trigger: 'points_milestone', points: 5000 },
      ];

      for (const rule of achievementRules) {
        let shouldAward = false;

        if (rule.trigger === activityType && rule.count) {
          shouldAward = activityCounts[activityType] >= rule.count;
        } else if (
          rule.trigger === 'streak_milestone' &&
          activityType === 'login'
        ) {
          shouldAward = stats.current_streak >= (rule.streakCount || 0);
        } else if (rule.trigger === 'level_milestone') {
          shouldAward = stats.current_level >= (rule.level || 0);
        } else if (rule.trigger === 'points_milestone') {
          shouldAward = stats.total_points >= (rule.points || 0);
        }

        if (shouldAward) {
          // Check if achievement already exists
          const existingUrl = `${this.restUrl}/user_achievements?user_id=eq.${userId}&achievement_types.name=eq.${rule.name}`;
          const existingResponse = await fetch(existingUrl, {
            headers: this.headers(userToken),
          });
          const existing = await existingResponse.json();

          if (existing.length === 0) {
            await this.awardAchievement(userId, rule.name, {}, userToken);
          }
        }
      }
    } catch (error) {
      console.error('Failed to check achievements:', error);
    }
  }

  private isLearningStreakActivity(activityType: string): boolean {
    if (!activityType) {
      return false;
    }
    return (
      this.learningActivityTypes.has(activityType) || activityType === 'login'
    );
  }

  // Update challenges based on activity
  private async updateChallengesFromActivity(
    userId: string,
    activityType: string,
    duration: number,
    userToken?: string,
  ): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0];

      // Get active challenges for today
      const challengesUrl = `${this.restUrl}/daily_challenges?date_active=eq.${today}&is_active=eq.true`;
      const challengesResponse = await fetch(challengesUrl, {
        headers: this.headers(userToken),
      });

      if (!challengesResponse.ok) return;

      const challenges = await challengesResponse.json();

      for (const challenge of challenges) {
        let progressIncrement = 0;

        switch (challenge.challenge_type) {
          case 'quiz_completion':
            if (activityType === 'quiz_completed') progressIncrement = 1;
            break;
          case 'time_spent':
            if (['lecture_viewed', 'course_progress'].includes(activityType)) {
              progressIncrement = duration;
            }
            break;
          case 'course_progress':
            if (activityType === 'section_completed') progressIncrement = 1;
            break;
          case 'streak_maintain':
            if (
              ['course_completed', 'quiz_completed', 'login'].includes(
                activityType,
              )
            ) {
              progressIncrement = 1;
            }
            break;
          case 'perfect_score':
            if (activityType === 'perfect_score') progressIncrement = 1;
            break;
        }

        if (progressIncrement > 0) {
          await this.updateChallengeProgress(
            userId,
            challenge.id,
            progressIncrement,
            userToken,
          );
        }
      }
    } catch (error) {
      console.error('Failed to update challenges from activity:', error);
    }
  }

  // Generate personalized insights for the user
  async generateUserInsights(userId: string, userToken?: string): Promise<any> {
    try {
      const [stats, recentActivities, challenges, achievements] =
        await Promise.all([
          this.getUserStats(userId, userToken),
          this.getRecentUserActivities(userId, 50, userToken),
          this.getDailyChallenges(userId, userToken),
          this.getUserAchievements(userId, userToken),
        ]);

      const insights = {
        productivity: this.calculateProductivityInsights(recentActivities),
        progress: this.calculateProgressInsights(stats, achievements),
        recommendations: this.generateRecommendations(
          stats,
          recentActivities,
          challenges,
        ),
        streakStatus: this.analyzeStreakStatus(
          stats.current_streak,
          recentActivities,
        ),
        levelProgress: this.calculateLevelProgress(stats),
      };

      return insights;
    } catch (error) {
      console.error('Failed to generate user insights:', error);
      return {
        productivity: { message: 'Unable to calculate productivity' },
        progress: { message: 'Unable to analyze progress' },
        recommendations: [],
        streakStatus: { status: 'unknown' },
        levelProgress: { progress: 0 },
      };
    }
  }

  // Get recent user activities (helper method)
  private async getRecentUserActivities(
    userId: string,
    limit = 50,
    userToken?: string,
  ): Promise<any[]> {
    try {
      const url = `${this.restUrl}/user_activities?user_id=eq.${userId}&order=created_at.desc&limit=${limit}`;
      const response = await fetch(url, {
        headers: this.headers(userToken),
      });

      if (response.ok) {
        return await response.json();
      }
      return [];
    } catch (error) {
      console.error('Failed to fetch recent activities:', error);
      return [];
    }
  }

  private calculateProductivityInsights(activities: any[]): any {
    if (activities.length === 0) {
      return {
        message: 'Not enough activity data',
        weeklyAverage: 0,
        trend: 'neutral',
      };
    }

    // Calculate weekly activity pattern
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recentActivities = activities.filter(
      (a) => new Date(a.created_at) >= weekAgo,
    );

    // Group by day
    const dailyActivity = {};
    recentActivities.forEach((activity) => {
      const day = new Date(activity.created_at).toDateString();
      dailyActivity[day] = (dailyActivity[day] || 0) + 1;
    });

    const activeDays = Object.keys(dailyActivity).length;
    const weeklyAverage = recentActivities.length / 7;
    const trend =
      recentActivities.length > activities.slice(7, 14).length
        ? 'increasing'
        : 'decreasing';

    return {
      weeklyAverage: Math.round(weeklyAverage * 10) / 10,
      activeDays,
      trend,
      message: `You've been active ${activeDays} days this week with an average of ${Math.round(weeklyAverage * 10) / 10} activities per day.`,
    };
  }

  private calculateProgressInsights(stats: any, achievements: any[]): any {
    const recentAchievements = achievements.filter((a) => {
      const earnedDate = new Date(a.earned_at);
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return earnedDate >= weekAgo;
    });

    return {
      totalPoints: stats.total_points || 0,
      currentLevel: stats.current_level || 1,
      recentAchievements: recentAchievements.length,
      streakDays: stats.current_streak || 0,
      message: `You're at level ${stats.current_level || 1} with ${stats.total_points || 0} total points. You've earned ${recentAchievements.length} achievements this week!`,
    };
  }

  private generateRecommendations(
    stats: any,
    activities: any[],
    challenges: any[],
  ): string[] {
    const recommendations: string[] = [];
    const currentLevel = stats.current_level || 1;
    const currentStreak = stats.current_streak || 0;

    // Streak recommendations
    if (currentStreak === 0) {
      recommendations.push(
        'Start a learning streak by completing any activity today!',
      );
    } else if (currentStreak < 7) {
      recommendations.push(
        `You're on a ${currentStreak}-day streak! Keep it going to reach the 7-day milestone.`,
      );
    } else if (currentStreak >= 7 && currentStreak < 30) {
      recommendations.push(
        `Amazing ${currentStreak}-day streak! Can you make it to 30 days?`,
      );
    }

    // Challenge recommendations
    const incompleteChallenges = challenges.filter(
      (c) => !c.progress?.completed_at,
    );
    if (incompleteChallenges.length > 0) {
      const easiest = incompleteChallenges.find(
        (c) => c.difficulty_level === 'easy',
      );
      if (easiest) {
        recommendations.push(
          `Try completing "${easiest.title}" - it's an easy challenge that fits your level!`,
        );
      }
    }

    // Activity-based recommendations
    const quizCount = activities.filter(
      (a) => a.activity_type === 'quiz_completed',
    ).length;
    const courseCount = activities.filter(
      (a) => a.activity_type === 'course_completed',
    ).length;

    if (quizCount < 5) {
      recommendations.push(
        'Take more quizzes to test your knowledge and earn points!',
      );
    }

    if (courseCount === 0) {
      recommendations.push(
        'Complete your first course to unlock the Course Conqueror achievement!',
      );
    }

    // Level-based recommendations
    if (currentLevel < 3) {
      recommendations.push(
        'Focus on consistent daily learning to level up faster!',
      );
    } else if (currentLevel >= 5) {
      recommendations.push(
        "You're doing great! Try tackling some harder challenges for bonus points.",
      );
    }

    return recommendations.slice(0, 3); // Return top 3 recommendations
  }

  private analyzeStreakStatus(currentStreak: number, activities: any[]): any {
    const today = new Date().toDateString();
    const hasActivityToday = activities.some(
      (a) => new Date(a.created_at).toDateString() === today,
    );

    if (currentStreak === 0) {
      return {
        status: 'inactive',
        message: 'Start a new streak today!',
        action: 'Complete any learning activity',
        risk: 'none',
      };
    }

    if (hasActivityToday) {
      return {
        status: 'active',
        message: `Great! Your ${currentStreak}-day streak is secure for today.`,
        action: 'Keep learning tomorrow',
        risk: 'none',
      };
    }

    return {
      status: 'at_risk',
      message: `Your ${currentStreak}-day streak is at risk! Complete an activity today to maintain it.`,
      action: 'Complete any learning activity',
      risk: 'high',
    };
  }

  private calculateLevelProgress(stats: any): any {
    const currentLevel = stats.current_level || 1;
    const totalPoints = stats.total_points || 0;

    // Level thresholds from database schema
    const levelThresholds = [
      0, 100, 250, 500, 1000, 2000, 3500, 5500, 8000, 12000,
    ];

    const currentLevelThreshold = levelThresholds[currentLevel - 1] || 0;
    const nextLevelThreshold =
      levelThresholds[currentLevel] ||
      levelThresholds[levelThresholds.length - 1];

    const pointsInCurrentLevel = totalPoints - currentLevelThreshold;
    const pointsNeededForNext = nextLevelThreshold - currentLevelThreshold;
    const progress = pointsInCurrentLevel / pointsNeededForNext;

    return {
      currentLevel,
      totalPoints,
      pointsInCurrentLevel,
      pointsNeededForNext: nextLevelThreshold - totalPoints,
      progress: Math.min(progress, 1),
      nextLevel: currentLevel < 10 ? currentLevel + 1 : currentLevel,
    };
  }

  // Refresh daily challenges (force regeneration)
  async refreshDailyChallenges(
    userId: string,
    userToken?: string,
  ): Promise<DailyChallenge[]> {
    try {
      const date = new Date().toISOString().split('T')[0];

      // Deactivate existing challenges for today
      const deactivateUrl = `${this.restUrl}/daily_challenges?date_active=eq.${date}`;
      await fetch(deactivateUrl, {
        method: 'PATCH',
        headers: this.headers(userToken),
        body: JSON.stringify({ is_active: false }),
      });

      // Generate new challenges
      const newChallenges = await this.generateDynamicChallenges(
        userId,
        date,
        userToken,
      );

      return newChallenges;
    } catch (error) {
      throw new InternalServerErrorException(
        `Refresh daily challenges failed: ${error.message}`,
      );
    }
  }
}
