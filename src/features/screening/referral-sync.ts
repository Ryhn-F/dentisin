// referral_created (SYNC_EVENTS.md §3.5) for a saved screening whose referral letter was opened.
// The local store keeps one referral per screening (reason codes = triage reason ids, no
// facility code) and hands it to the sync bridge, which queues it behind the screening event
// and only while consent (b) is on. Routine results get no referral record.
import { useLocalData, type ReferralRecord } from '@/data/local-store';

import { useScreeningSession } from './session-store';

/**
 * Records the referral for a saved, non-routine screening once; later calls return the same
 * record. Null when the screening is not saved on this device or is routine.
 */
export function ensureReferral(screeningId: string): ReferralRecord | null {
  const store = useLocalData.getState();
  const screening = store.screenings.find((r) => r.id === screeningId);
  if (!screening || screening.level === 'routine') return null;
  if (screening.referralId) return store.referrals.find((r) => r.id === screening.referralId) ?? null;
  const referral = store.addReferral({ screeningId });
  if (referral) useScreeningSession.getState().setReferralId(screeningId, referral.id);
  return referral;
}
