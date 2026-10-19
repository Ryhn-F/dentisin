// How many proof clips each child already has today on this phone, for the daily clip limit
// (my_account().limits.proofMaxPerChildPerDay; the server counts per child per WIB day,
// ACCOUNTS_AND_FLOWS.md §3, SYNC_EVENTS.md §3.8). Pure. The phone only decides whether to OFFER
// the camera; the server stays the final judge (limit_exceeded).
//
// A clip counts once, whichever place knows it: the brushing record (proofId) or the upload
// queue entry. A clip the server refused (terminal rejection of its event) does not count.

import { dateKeyInZone } from '@/domain/streak';
import type { BrushingRecord } from '@/domain/models';

import type { ProofUpload } from './proof-uploads';

/** The server counts a "day" in WIB. */
export const PROOF_LIMIT_ZONE = 'Asia/Jakarta';

/** Failures where the event never got applied: the server did not count that clip. */
const NOT_COUNTED_FAILURES: ReadonlySet<string> = new Set([
  'limit_exceeded',
  'consent_required',
  'feature_disabled',
  'forbidden',
  'deletion_pending',
  'schema_invalid',
  'dependency_rejected',
  'not_registered',
]);

type RecordLike = Pick<BrushingRecord, 'childId' | 'startedAt' | 'proofId'>;
type UploadLike = Pick<ProofUpload, 'childId' | 'proofId' | 'createdAt' | 'state' | 'failure'>;

function isToday(when: Date, today: string): boolean {
  return !Number.isNaN(when.getTime()) && dateKeyInZone(when, PROOF_LIMIT_ZONE) === today;
}

/** childId -> number of today's (WIB) proof clips that still count against the daily limit. */
export function proofCountsToday(
  records: readonly RecordLike[],
  uploads: readonly UploadLike[],
  now: Date = new Date(),
): Record<string, number> {
  const today = dateKeyInZone(now, PROOF_LIMIT_ZONE);
  const refused = new Set<string>();
  const seen = new Map<string, string>(); // proofId -> childId
  for (const u of uploads) {
    const proofId = u.proofId.toLowerCase();
    if (u.state === 'failed' && u.failure && NOT_COUNTED_FAILURES.has(u.failure)) {
      refused.add(proofId);
      continue;
    }
    if (isToday(new Date(u.createdAt), today)) seen.set(proofId, u.childId);
  }
  for (const r of records) {
    if (!r.proofId) continue;
    const proofId = r.proofId.toLowerCase();
    if (refused.has(proofId) || seen.has(proofId)) continue;
    if (isToday(new Date(r.startedAt), today)) seen.set(proofId, r.childId);
  }
  const counts: Record<string, number> = {};
  for (const childId of seen.values()) counts[childId] = (counts[childId] ?? 0) + 1;
  return counts;
}
