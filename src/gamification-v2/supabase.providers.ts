import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { GamificationConfig, QuestionProgress } from './gamification-core';
import {
  GamificationConfigProvider,
  LectureProgressRepository,
  UserProgress,
  UserProgressRepository,
  UserQuestionProgress,
  UserQuestionProgressRepository,
} from './gamification.interfaces';

type SupabaseRow = Record<string, any>;

export function getSupabaseRestUrl(): string {
  const base = process.env.SUPABASE_URL?.trim();
  if (!base) {
    throw new InternalServerErrorException('SUPABASE_URL is not configured');
  }
  return `${base.replace(/\/$/, '')}/rest/v1`;
}

function getSupabaseServiceKey(): string {
  const sk = process.env.SUPABASE_SERVICE_ROLE?.trim();
  const looksJwt = sk && sk.split('.').length === 3 && sk.length > 60;
  if (!looksJwt) {
    throw new InternalServerErrorException(
      'Supabase service role key is not configured',
    );
  }
  return sk;
}

export function supabaseHeaders(contentType = 'application/json') {
  const sk = getSupabaseServiceKey();

  return {
    apikey: sk,
    Authorization: `Bearer ${sk}`,
    'Content-Type': contentType,
  };
}

export async function ensureOk(response: globalThis.Response, label: string) {
  if (!response.ok) {
    const text = await response.text();
    throw new InternalServerErrorException(
      `${label} failed: ${response.status} ${text}`,
    );
  }
}

@Injectable()
export class SupabaseGamificationConfigService extends GamificationConfigProvider {
  private cache?: { config: GamificationConfig; expiresAt: number };
  private readonly cacheTtlMs = 60 * 1000;

  async getConfig(): Promise<GamificationConfig> {
    const now = Date.now();
    if (this.cache && now < this.cache.expiresAt) {
      return this.cache.config;
    }

    const url = `${getSupabaseRestUrl()}/gamification_config?is_active=eq.true&select=config&order=created_at.desc&limit=1`;
    const res = await fetch(url, { headers: supabaseHeaders() });
    await ensureOk(res, 'Fetch gamification config');
    const rows = (await res.json()) as Array<{ config: GamificationConfig }>;
    if (!rows?.length || !rows[0]?.config) {
      throw new InternalServerErrorException(
        'Active gamification config row not found',
      );
    }
    const config = rows[0].config;
    this.cache = { config, expiresAt: now + this.cacheTtlMs };
    return config;
  }
}

@Injectable()
export class SupabaseUserProgressRepository extends UserProgressRepository {
  private readonly logger = new Logger(SupabaseUserProgressRepository.name);

  private get url() {
    return `${getSupabaseRestUrl()}/user_progress`;
  }

  async getUserProgress(userId: string): Promise<UserProgress | null> {
    const res = await fetch(`${this.url}?user_id=eq.${userId}&limit=1`, {
      headers: supabaseHeaders(),
    });
    await ensureOk(res, 'Fetch user progress');
    const rows = (await res.json()) as SupabaseRow[];
    if (!rows?.length) {
      return null;
    }
    return this.mapToUserProgress(rows[0]);
  }

  async saveUserProgress(progress: UserProgress): Promise<void> {
    const payload = {
      user_id: progress.userId,
      total_xp: progress.totalXp,
      current_level: progress.currentLevel,
      last_xp_event_at: progress.lastXpEventAt
        ? new Date(progress.lastXpEventAt).toISOString()
        : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(),
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify([payload]),
    });
    await ensureOk(res, 'Upsert user progress');

    try {
      await this.syncLegacyProfileStats(progress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Legacy profile gamification sync failed for ${progress.userId}: ${message}`,
      );
    }
  }

  private mapToUserProgress(row: SupabaseRow): UserProgress {
    return {
      userId: row.user_id,
      totalXp: row.total_xp ?? 0,
      currentLevel: row.current_level ?? 1,
      lastXpEventAt: row.last_xp_event_at,
    };
  }

  private async syncLegacyProfileStats(progress: UserProgress): Promise<void> {
    const patch = {
      total_points: progress.totalXp,
      current_level: progress.currentLevel,
    };
    const encodedUserId = encodeURIComponent(progress.userId);
    const res = await fetch(
      `${getSupabaseRestUrl()}/profiles?id=eq.${encodedUserId}`,
      {
        method: 'PATCH',
        headers: supabaseHeaders(),
        body: JSON.stringify(patch),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`profiles sync failed: ${res.status} ${text}`);
    }
  }
}

@Injectable()
export class SupabaseUserQuestionProgressRepository extends UserQuestionProgressRepository {
  private get url() {
    return `${getSupabaseRestUrl()}/user_question_progress`;
  }

  async getQuestionProgress(
    userId: string,
    questionId: string,
  ): Promise<UserQuestionProgress | null> {
    const res = await fetch(
      `${this.url}?user_id=eq.${userId}&question_id=eq.${questionId}&limit=1`,
      { headers: supabaseHeaders() },
    );
    await ensureOk(res, 'Fetch question progress');
    const rows = (await res.json()) as SupabaseRow[];
    if (!rows?.length) {
      return null;
    }
    return this.mapRow(rows[0]);
  }

  async saveQuestionProgress(progress: UserQuestionProgress): Promise<void> {
    const payload = {
      user_id: progress.userId,
      question_id: progress.questionId,
      attempts_count: progress.attemptsCount,
      first_attempt_correct: !!progress.firstAttemptCorrect,
      second_attempt_correct: !!progress.secondAttemptCorrect,
      total_xp_earned: progress.totalXpEarnedForThisQuestion,
      updated_at: new Date().toISOString(),
    };

    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(),
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify([payload]),
    });
    await ensureOk(res, 'Upsert question progress');
  }

  private mapRow(row: SupabaseRow): UserQuestionProgress {
    const base: QuestionProgress = {
      questionId: row.question_id,
      attemptsCount: row.attempts_count ?? 0,
      firstAttemptCorrect: row.first_attempt_correct ?? false,
      secondAttemptCorrect: row.second_attempt_correct ?? false,
      totalXpEarnedForThisQuestion: row.total_xp_earned ?? 0,
    };
    return {
      userId: row.user_id,
      ...base,
    };
  }
}

@Injectable()
export class SupabaseLectureProgressRepository extends LectureProgressRepository {
  private get url() {
    return `${getSupabaseRestUrl()}/lecture_completion`;
  }

  async hasUserCompletedLecture(
    userId: string,
    lectureId: string,
  ): Promise<boolean> {
    const res = await fetch(
      `${this.url}?user_id=eq.${userId}&lecture_id=eq.${lectureId}&select=lecture_id&limit=1`,
      { headers: supabaseHeaders() },
    );
    await ensureOk(res, 'Check lecture completion');
    const rows = (await res.json()) as SupabaseRow[];
    return rows?.length > 0;
  }

  async markLectureCompleted(userId: string, lectureId: string): Promise<void> {
    const payload = {
      user_id: userId,
      lecture_id: lectureId,
      completed_at: new Date().toISOString(),
    };
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(),
        Prefer: 'resolution=ignore-duplicates',
      },
      body: JSON.stringify([payload]),
    });
    await ensureOk(res, 'Insert lecture completion');
  }
}
