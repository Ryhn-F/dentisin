// Local, PII-free tally of why photos were rejected (app/CLAUDE.md §6.2: "catat lokal alasan
// penolakan untuk memperbaiki panduan"). Only counters — no photo, child, time or device data.
// Never synced; it helps the team tune the capture guide during field tests.
import { appStorage } from '@/core/auth/secure-storage';
import { reasonOrder, type QualityReason } from '@/ml/quality-gate';

const KEY = 'dentisai.qualityRejects.v1';

export type RejectTally = { attempts: number; rejected: number } & Record<QualityReason, number>;

const empty = (): RejectTally => ({
  attempts: 0,
  rejected: 0,
  ...(Object.fromEntries(reasonOrder.map((r) => [r, 0])) as Record<QualityReason, number>),
});

export async function readRejectTally(): Promise<RejectTally> {
  try {
    const stored = await appStorage.getItem(KEY);
    return stored ? { ...empty(), ...(JSON.parse(stored) as Partial<RejectTally>) } : empty();
  } catch {
    return empty();
  }
}

/** Records one quality-gate run. Failures are swallowed: the tally must never block the flow. */
export async function recordQualityCheck(reasons: readonly QualityReason[]): Promise<void> {
  try {
    const tally = await readRejectTally();
    tally.attempts += 1;
    if (reasons.length) tally.rejected += 1;
    for (const r of reasons) tally[r] += 1;
    await appStorage.setItem(KEY, JSON.stringify(tally));
  } catch {
    // ignore
  }
}
