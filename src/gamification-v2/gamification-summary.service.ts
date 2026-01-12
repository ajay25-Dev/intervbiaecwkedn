import { Injectable, Logger } from '@nestjs/common';
import { getLevelForXp, xpToReachLevel } from './gamification-core';
import { GamificationConfigProvider } from './gamification.interfaces';
import { getSupabaseRestUrl, supabaseHeaders } from './supabase.providers';

interface UserProgressRow {
  total_xp?: number;
  current_level?: number;
  last_xp_event_at?: string | null;
}

const MS_IN_DAY = 86_400_000;

interface StreakRow {
  current_count?: number;
  last_activity_date?: string | null;
  start_date?: string | null;
}

interface StreakInfo {
  currentCount: number;
  lastActivityDate?: string | null;
  startDate?: string | null;
}

export interface StreakCalendarEntry {
  date: string;
  present: boolean;
  activityCount: number;
  lastActivityAt?: string | null;
  isFuture?: boolean;
}

export interface LeaderboardSummaryEntry {
  userId: string;
  name: string;
  xp: number;
  rank: number;
}

@Injectable()
export class GamificationSummaryService {
  private readonly logger = new Logger(GamificationSummaryService.name);
  private readonly restUrl = getSupabaseRestUrl();

  constructor(private readonly configProvider: GamificationConfigProvider) {}

  async getUserSummary(userId: string) {
    const [progress, streakInfo] = await Promise.all([
      this.fetchProgress(userId),
      this.fetchStreak(userId),
    ]);
    const streakCalendar = await this.fetchStreakCalendar(userId, streakInfo);

    const config = await this.configProvider.getConfig();
    const totalXp = Number(progress?.total_xp ?? 0);
    const level = progress?.current_level ?? getLevelForXp(totalXp, config);

    const xpForCurrent = xpToReachLevel(level, config);
    const xpForNext = xpToReachLevel(level + 1, config);
    const xpIntoLevel = totalXp - xpForCurrent;
    const levelWindow = Math.max(1, xpForNext - xpForCurrent);
    const levelProgressPercent = Math.min(
      100,
      Math.max(0, Math.round((xpIntoLevel / levelWindow) * 100)),
    );

    const tier = this.resolveTier(level, totalXp);
    const freezeAllowance = this.getFreezeAllowance(tier, totalXp);
    const calendarDerivedStreak = this.calculateStreakWithFreezes(
      streakCalendar,
      freezeAllowance,
      streakInfo?.currentCount ?? 0,
    );
    const streakDays =
      typeof streakInfo?.currentCount === 'number' &&
      Number.isFinite(streakInfo.currentCount)
        ? Math.max(0, streakInfo.currentCount)
        : calendarDerivedStreak;

    return {
      totalXp,
      level,
      tier,
      streakDays,
      levelProgressPercent,
      lastXpEventAt: progress?.last_xp_event_at ?? null,
      streakCalendar,
    };
  }

  private async fetchProgress(userId: string): Promise<UserProgressRow | null> {
    try {
      const url = `${this.restUrl}/user_progress?user_id=eq.${userId}&select=total_xp,current_level,last_xp_event_at&limit=1`;
      const res = await fetch(url, {
        headers: supabaseHeaders(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(`user_progress query failed: ${res.status} ${text}`);
        return null;
      }
      const rows = (await res.json()) as UserProgressRow[];
      return rows[0] ?? null;
    } catch (error) {
      this.logger.error(`Unable to fetch user progress: ${error.message}`);
      return null;
    }
  }

  private async fetchStreak(userId: string): Promise<StreakInfo | null> {
    try {
      const url = `${this.restUrl}/learning_streaks?user_id=eq.${userId}&streak_type=eq.daily_login&select=current_count,last_activity_date,start_date&order=updated_at.desc&limit=1`;
      const res = await fetch(url, {
        headers: supabaseHeaders(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `learning_streaks query failed: ${res.status} ${text}`,
        );
        return null;
      }
      const rows = (await res.json()) as StreakRow[];
      if (!rows[0]) {
        return null;
      }
      return {
        currentCount: rows[0].current_count ?? 0,
        lastActivityDate: rows[0].last_activity_date ?? null,
        startDate: rows[0].start_date ?? null,
      };
    } catch (error) {
      this.logger.error(`Unable to fetch learning streak: ${error.message}`);
      return null;
    }
  }

  private async fetchStreakCalendar(
    userId: string,
    streakInfo: StreakInfo | null,
    monthsBefore = 6,
    monthsAfter = 6,
  ): Promise<StreakCalendarEntry[]> {
    const now = new Date();
    const todayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const todayIso = todayUtc.toISOString().slice(0, 10);

    const start = new Date(
      Date.UTC(
        todayUtc.getUTCFullYear(),
        todayUtc.getUTCMonth() - monthsBefore,
        1,
      ),
    );
    const end = new Date(
      Date.UTC(
        todayUtc.getUTCFullYear(),
        todayUtc.getUTCMonth() + monthsAfter + 1,
        0,
      ),
    );
    const startParam = start.toISOString();
    const daysBetween = Math.max(
      1,
      Math.round((todayUtc.getTime() - start.getTime()) / 86400000),
    );
    const limit = Math.min(Math.max(daysBetween * 5, 500), 2000);

    try {
      const url = `${this.restUrl}/login_history?user_id=eq.${userId}&activity_category=in.(learning,login)&login_timestamp=gte.${startParam}&select=login_timestamp&order=login_timestamp.desc&limit=${limit}`;
      const res = await fetch(url, { headers: supabaseHeaders() });
      if (!res.ok) {
        if (res.status === 404) {
          this.logger.log(
            'login_history table not found; using derived streak timeline',
          );
        } else {
          const text = await res.text().catch(() => '');
          this.logger.warn(`login_history query failed: ${res.status} ${text}`);
        }
        return this.generateTimelineFromStreak(
          start,
          end,
          todayIso,
          streakInfo,
        );
      }
      const rows = (await res.json()) as {
        login_timestamp?: string;
      }[];
      const presenceByDate = new Map<
        string,
        { count: number; lastLoginAt: string | null }
      >();
      for (const row of rows) {
        if (!row?.login_timestamp) continue;
        const isoDate = row.login_timestamp.slice(0, 10);
        if (!isoDate) continue;
        const existing = presenceByDate.get(isoDate) || {
          count: 0,
          lastLoginAt: null,
        };
        existing.count += 1;
        if (
          !existing.lastLoginAt ||
          row.login_timestamp > existing.lastLoginAt
        ) {
          existing.lastLoginAt = row.login_timestamp;
        }
        presenceByDate.set(isoDate, existing);
      }

      return this.buildTimelineFromPresence(
        start,
        end,
        todayIso,
        presenceByDate,
      );
    } catch (error) {
      this.logger.error(`Unable to fetch streak calendar: ${error.message}`);
      return this.generateTimelineFromStreak(start, end, todayIso, streakInfo);
    }
  }

  private buildTimelineFromPresence(
    start: Date,
    end: Date,
    todayIso: string,
    presenceByDate: Map<string, { count: number; lastLoginAt: string | null }>,
  ): StreakCalendarEntry[] {
    const timeline: StreakCalendarEntry[] = [];
    const totalDays =
      Math.round((end.getTime() - start.getTime()) / MS_IN_DAY) + 1;
    for (let i = 0; i < totalDays; i += 1) {
      const day = new Date(start.getTime() + i * MS_IN_DAY);
      const iso = day.toISOString().slice(0, 10);
      const presence = presenceByDate.get(iso);
      const isFuture = iso > todayIso;
      timeline.push({
        date: iso,
        present: Boolean(presence) && !isFuture,
        activityCount: presence?.count ?? 0,
        lastActivityAt: presence?.lastLoginAt ?? null,
        isFuture,
      });
    }
    return timeline;
  }

  private generateTimelineFromStreak(
    start: Date,
    end: Date,
    todayIso: string,
    streakInfo: StreakInfo | null,
  ): StreakCalendarEntry[] {
    const presenceByDate = new Map<
      string,
      { count: number; lastLoginAt: string | null }
    >();
    if (streakInfo?.currentCount && streakInfo.currentCount > 0) {
      const lastIso = streakInfo.lastActivityDate?.slice(0, 10) ?? todayIso;
      const lastDate = new Date(`${lastIso}T00:00:00Z`);
      for (let i = 0; i < streakInfo.currentCount; i += 1) {
        const iso = new Date(lastDate.getTime() - i * MS_IN_DAY)
          .toISOString()
          .slice(0, 10);
        presenceByDate.set(iso, {
          count: 1,
          lastLoginAt: `${iso}T23:59:59Z`,
        });
      }
    }
    return this.buildTimelineFromPresence(start, end, todayIso, presenceByDate);
  }

  private resolveTier(level: number, totalXp: number) {
    if (totalXp >= 25000) return 'Platinum';
    if (totalXp >= 15000) return 'Gold';
    if (totalXp >= 10000) return 'Silver';
    return 'Bronze';
  }

  private getFreezeAllowance(tier: string | null, totalXp: number): number {
    const normalizedTier = tier?.toLowerCase() ?? '';
    if (normalizedTier === 'gold' || normalizedTier === 'platinum') {
      return 2;
    }
    if (normalizedTier === 'silver') {
      return 2;
    }
    if (totalXp >= 15000) {
      return 2;
    }
    return 1;
  }

  private calculateStreakWithFreezes(
    calendar: StreakCalendarEntry[] | null,
    freezeAllowance: number,
    fallbackCount: number,
  ): number {
    if (!Array.isArray(calendar) || calendar.length === 0) {
      return Math.max(0, fallbackCount);
    }
    const dayMap = new Map<string, boolean>();
    let lastActiveIso: string | null = null;
    let earliestIso: string | null = null;

    for (const entry of calendar) {
      const iso = entry?.date?.slice(0, 10);
      if (!iso || entry?.isFuture) {
        continue;
      }
      dayMap.set(iso, Boolean(entry.present));
      if (entry.present) {
        if (!lastActiveIso || iso > lastActiveIso) {
          lastActiveIso = iso;
        }
      }
      if (!earliestIso || iso < earliestIso) {
        earliestIso = iso;
      }
    }

    if (!lastActiveIso) {
      return Math.max(0, fallbackCount);
    }
    if (!earliestIso) {
      earliestIso = lastActiveIso;
    }

    const startDate = new Date(`${earliestIso}T00:00:00Z`);
    let cursor = new Date(`${lastActiveIso}T00:00:00Z`);
    let streak = 0;
    let remainingFreezes = Math.max(0, freezeAllowance || 0);

    while (cursor >= startDate) {
      const iso = cursor.toISOString().slice(0, 10);
      const isPresent = dayMap.get(iso) ?? false;
      if (isPresent) {
        streak += 1;
      } else if (remainingFreezes > 0) {
        remainingFreezes -= 1;
        streak += 1;
      } else {
        break;
      }
      cursor = new Date(cursor.getTime() - MS_IN_DAY);
    }

    return Math.max(streak, Math.max(0, fallbackCount));
  }

  async getLeaderboardTop(limit = 5000): Promise<LeaderboardSummaryEntry[]> {
    try {
      const url = `${this.restUrl}/user_progress?select=user_id,total_xp,profiles(full_name)&order=total_xp.desc&limit=10`;
      const res = await fetch(url, {
        headers: supabaseHeaders(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `user_progress leaderboard query failed: ${res.status} ${text}`,
        );
        return [];
      }
      const rows = (await res.json()) as Array<{
        user_id: string;
        total_xp?: number;
        profiles?: { full_name?: string };
      }>;
      return rows.map((row, index) => ({
        userId: row.user_id,
        xp: Math.max(0, Number(row.total_xp ?? 0)),
        name: row.profiles?.full_name?.trim() || 'Learner',
        rank: index + 1,
      }));
    } catch (error) {
      this.logger.error(
        `Unable to fetch leaderboard: ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  }
}
