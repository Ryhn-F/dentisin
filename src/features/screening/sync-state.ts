// Where a saved screening stands on its way to the account (result screen sync line).
import { useEffect, useReducer } from 'react';

import { useSession, type AuthStatus } from '@/core/auth/session-store';
import { syncRefs } from '@/core/sync/bridge';
import { outbox, type OutboxEntryState } from '@/core/sync/outbox';
import { useLocalData } from '@/data/local-store';

/**
 * - guest: no account, nothing is ever sent;
 * - local_only: signed in but consent (b) is off for this child (bridge sends nothing);
 * - blocked: the server stopped taking this child's data (deletion pending);
 * - synced: screening_recorded applied (or already on the server);
 * - attention: the event was rejected or is held behind a rejected one;
 * - pending: queued, waiting to be sent (offline, backoff, not deployed yet ...).
 */
export type ScreeningSyncState = 'guest' | 'local_only' | 'blocked' | 'synced' | 'attention' | 'pending';

export function screeningSyncState(input: {
  session: AuthStatus;
  synced: boolean;
  consentB: boolean;
  blocked: boolean;
  eventState: OutboxEntryState | null;
}): ScreeningSyncState | null {
  if (input.session === 'guest') return 'guest';
  if (input.session !== 'signedIn') return null;
  if (input.synced || input.eventState === 'applied') return 'synced';
  if (input.blocked) return 'blocked';
  if (!input.consentB) return 'local_only';
  if (input.eventState === 'rejected' || input.eventState === 'held') return 'attention';
  return 'pending';
}

/** Latest queued screening_recorded state for a record, or null when none is queued. */
function screeningEventState(recordId: string): OutboxEntryState | null {
  const entries = outbox.findByRef(syncRefs.screening(recordId));
  return entries.length ? entries[entries.length - 1].state : null;
}

/** Live sync state of a saved screening (null id = nothing saved, nothing to show). */
export function useScreeningSyncState(recordId: string | null): ScreeningSyncState | null {
  const session = useSession((s) => s.status);
  const record = useLocalData((s) => (recordId ? s.screenings.find((r) => r.id === recordId) : undefined));
  const childId = record?.childId ?? null;
  const consentB = useLocalData((s) => (childId ? s.consentRecords[childId]?.b?.value === true : false));
  const blocked = useLocalData((s) => (childId ? !!s.syncBlocked[childId] : false));
  // Entry state changes do not touch any store this screen reads: re-render on outbox notices.
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => outbox.subscribe(() => bump()), []);
  if (!record) return null;
  return screeningSyncState({
    session,
    synced: record.synced,
    consentB,
    blocked,
    eventState: screeningEventState(record.id),
  });
}
