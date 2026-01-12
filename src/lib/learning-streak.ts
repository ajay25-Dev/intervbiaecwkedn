import { Logger } from '@nestjs/common';

export type LearningActivityCategory = 'login' | 'learning';

interface LogLearningActivityOptions {
  restUrl: string;
  userId: string;
  activityType: string;
  headers?: Record<string, string>;
  category?: LearningActivityCategory;
  logger?: Logger;
  userTimezone?: string;
}

interface UpdateDailyLoginStreakOptions {
  restUrl: string;
  userId: string;
  headers?: Record<string, string>;
  streakType?: string;
  logger?: Logger;
}

export interface SimpleStreakUpdateResult {
  success: boolean;
  action: 'incremented' | 'reset' | 'none';
  current_count: number;
  longest_count: number;
  streak_type: string;
  updated_today: boolean;
}

function getTodayDateRange(userTimezone?: string): {
  start: Date;
  end: Date;
  iso: string;
} {
  const now = new Date();
  let today: Date;

  if (userTimezone) {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: userTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const parts = formatter.formatToParts(now);
      const year = parseInt(
        parts.find((p) => p.type === 'year')?.value ||
          String(now.getFullYear()),
        10,
      );
      const month =
        parseInt(parts.find((p) => p.type === 'month')?.value || '01', 10) - 1;
      const day = parseInt(
        parts.find((p) => p.type === 'day')?.value || '01',
        10,
      );
      today = new Date(year, month, day);
    } catch {
      today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
  } else {
    today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const start = new Date(today.toISOString());
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(start.getTime() + 86400000);
  const isoDate = today.toISOString().split('T')[0];

  return { start, end, iso: isoDate };
}

export async function logLearningActivityPresence({
  restUrl,
  userId,
  activityType,
  headers = {},
  category = 'learning',
  logger,
  userTimezone,
}: LogLearningActivityOptions): Promise<boolean> {
  try {
    const { iso: dateIso } = getTodayDateRange(userTimezone);
    const payload = [
      {
        user_id: userId,
        login_timestamp: new Date().toISOString(),
        activity_category: category,
        activity_type: activityType,
        activity_date: dateIso,
      },
    ];

    const response = await fetch(`${restUrl}/login_history`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    });

    if (!response.ok && response.status !== 404) {
      const text = await response.text().catch(() => '');
      logger?.warn?.(
        `Failed to log ${category} presence (${activityType}): ${response.status} ${text}`,
      );
      return false;
    }

    return response.ok;
  } catch (error) {
    logger?.warn?.(
      `Learning presence logging failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

export async function updateDailyLoginStreakRecord({
  restUrl,
  userId,
  headers = {},
  streakType = 'daily_login',
  logger,
}: UpdateDailyLoginStreakOptions): Promise<SimpleStreakUpdateResult> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString().split('T')[0];
  const nowIso = new Date().toISOString();
  const jsonHeaders =
    headers['Content-Type'] || headers['content-type']
      ? headers
      : { ...headers, 'Content-Type': 'application/json' };

  const buildStreakResult = (
    action: 'incremented' | 'reset' | 'none',
    currentCount: number,
    longestCount: number,
    updatedToday: boolean,
  ): SimpleStreakUpdateResult => ({
    success: true,
    action,
    current_count: currentCount,
    longest_count: longestCount,
    streak_type: streakType,
    updated_today: updatedToday,
  });

  try {
    const streakUrl = `${restUrl}/learning_streaks?user_id=eq.${userId}&streak_type=eq.${streakType}&select=*&limit=1`;
    const streakResponse = await fetch(streakUrl, { headers });
    if (!streakResponse.ok) {
      const message = await streakResponse
        .text()
        .catch(() => streakResponse.statusText);
      throw new Error(`Failed to fetch streak: ${message}`);
    }

    const streakRows = (await streakResponse.json()) as Array<{
      id: string;
      current_count?: number;
      longest_count?: number;
      start_date?: string;
      last_activity_date?: string;
      is_active?: boolean;
    }>;

    const streakRecord = streakRows[0];

    if (!streakRecord) {
      const payload = {
        user_id: userId,
        streak_type: streakType,
        current_count: 1,
        start_date: todayIso,
        last_activity_date: todayIso,
        longest_count: 1,
        total_points_earned: 0,
        is_active: true,
        updated_at: nowIso,
      };

      const createResponse = await fetch(`${restUrl}/learning_streaks`, {
        method: 'POST',
        headers: { ...jsonHeaders, Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      });

      if (!createResponse.ok) {
        const text = await createResponse
          .text()
          .catch(() => createResponse.statusText);
        throw new Error(`Failed to create streak: ${text}`);
      }

      await fetch(`${restUrl}/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({
          current_streak: 1,
          longest_streak: 1,
          last_activity_date: todayIso,
        }),
      }).catch(() => null);

      return buildStreakResult('incremented', 1, 1, true);
    }

    const existingCurrent = streakRecord.current_count ?? 0;
    const existingLongest =
      streakRecord.longest_count ?? Math.max(existingCurrent, 1);
    const lastActivityDate = streakRecord.last_activity_date;

    if (lastActivityDate === todayIso) {
      return buildStreakResult('none', existingCurrent, existingLongest, false);
    }

    let nextCount = existingCurrent || 0;
    let nextStartDate = streakRecord.start_date || todayIso;
    let action: 'incremented' | 'reset' = 'reset';

    if (lastActivityDate) {
      const lastDate = new Date(lastActivityDate);
      lastDate.setHours(0, 0, 0, 0);
      const diffDays = Math.floor(
        (today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (diffDays === 1) {
        nextCount = existingCurrent + 1;
        action = 'incremented';
      } else {
        nextCount = 1;
        nextStartDate = todayIso;
        action = 'reset';
      }
    } else {
      nextCount = 1;
      nextStartDate = todayIso;
      action = 'reset';
    }

    const nextLongest = Math.max(nextCount, existingLongest);
    const updatePayload = {
      current_count: nextCount,
      longest_count: nextLongest,
      start_date: nextStartDate,
      last_activity_date: todayIso,
      updated_at: nowIso,
      is_active: true,
    };

    const updateResponse = await fetch(
      `${restUrl}/learning_streaks?id=eq.${streakRecord.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify(updatePayload),
      },
    );

    if (!updateResponse.ok) {
      const text = await updateResponse
        .text()
        .catch(() => updateResponse.statusText);
      throw new Error(`Failed to update streak: ${text}`);
    }

    await fetch(`${restUrl}/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({
        current_streak: nextCount,
        longest_streak: nextLongest,
        last_activity_date: todayIso,
      }),
    }).catch(() => null);

    return buildStreakResult(action, nextCount, nextLongest, true);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown streak update error';
    logger?.warn?.(`Daily streak update failed: ${message}`);
    throw error;
  }
}
