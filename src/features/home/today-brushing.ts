// Today's brushing sessions from the server, merged with this phone's records (pure functions).
// A child can brush on their own phone (child account): the streak counter already comes from
// brushing_streak(), and the Pagi/Malam slot cards and the "last brushing" row must see the
// same sessions. Slot rule unchanged: any session in the slot counts (no minimum duration).
import type { BrushingRecord, HistoryItem } from '@/domain/models';

/** Items asked from child_history() for today's slots (two slots, a few extra sessions). */
export const TODAY_BRUSHING_LIMIT = 20;

/** Start of the current calendar day in the device time zone, as an ISO timestamp (UTC). */
export function startOfTodayIso(now: Date = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

/** child_history() brushing items as brushing records of `childId` (synced by definition). */
export function serverBrushingRecords(childId: string, items: readonly HistoryItem[]): BrushingRecord[] {
  const records: BrushingRecord[] = [];
  for (const item of items) {
    if (item.kind !== 'brushing') continue;
    records.push({
      id: item.id,
      childId,
      startedAt: item.occurredAt,
      durationS: item.data.durationS,
      spiritScore: item.data.spiritScore,
      slot: item.data.slot,
      cameraMode: item.data.cameraMode,
      synced: true,
      proofId: null,
    });
  }
  return records;
}

/**
 * Local records first (they may be unsynced and carry the richer detail view), then server
 * sessions this phone does not have; deduplicated by brushing id.
 */
export function mergeBrushing(local: readonly BrushingRecord[], server: readonly BrushingRecord[]): BrushingRecord[] {
  if (server.length === 0) return [...local];
  const seen = new Set(local.map((r) => r.id));
  const merged = [...local];
  for (const r of server) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
  }
  return merged;
}

/** The newest record, or null. */
export function latestBrushing(records: readonly BrushingRecord[]): BrushingRecord | null {
  return records.reduce<BrushingRecord | null>((latest, r) => (!latest || r.startedAt > latest.startedAt ? r : latest), null);
}
