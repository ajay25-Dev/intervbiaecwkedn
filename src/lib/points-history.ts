import {
  getSupabaseRestUrl,
  supabaseHeaders,
} from '../gamification-v2/supabase.providers';

export type PointsHistoryEntryInput = {
  userId: string;
  pointsChange: number;
  reason: string;
  referenceId?: string | null;
  referenceType?: string | null;
  metadata?: Record<string, any> | null;
  occurredAt?: string | Date | null;
};

function buildPayload(entry: PointsHistoryEntryInput) {
  return {
    user_id: entry.userId,
    points_change: entry.pointsChange,
    reason: entry.reason,
    reference_id: entry.referenceId ?? null,
    reference_type: entry.referenceType ?? null,
    metadata: entry.metadata ?? null,
    created_at: entry.occurredAt
      ? new Date(entry.occurredAt).toISOString()
      : new Date().toISOString(),
  };
}

export async function recordPointsHistoryEntry(
  entry: PointsHistoryEntryInput,
): Promise<void> {
  const url = `${getSupabaseRestUrl()}/points_history`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(),
      Prefer: 'return=minimal',
    },
    body: JSON.stringify([buildPayload(entry)]),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Failed to record points history entry (${response.status}): ${text}`,
    );
  }
}
