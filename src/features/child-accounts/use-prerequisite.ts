import { useCallback, useEffect, useRef, useState } from 'react';

import { queuedConsentGrant } from '@/core/sync/bridge';
import { outbox, useOutboxStatus } from '@/core/sync/outbox';
import { useLocalData } from '@/data/local-store';
import type { ChildSummary } from '@/domain/models';

import type { ChildSummariesState } from './use-child-summaries';

// Creating a child account needs the child to exist on the server (ACCOUNTS_AND_FLOWS 2.2):
// the consent (b) grant creates the profile there. This works out where that stands from the
// local consent record, the outbox entry and list_children.
export type Prerequisite =
  /** The child is on the server: the create form may open. */
  | 'ready'
  /** Consent (b) is off locally: ask for it first. */
  | 'needs_consent'
  /** Consent (b) is on but not applied yet (queued, sending, or offline). */
  | 'waiting'
  /** The server refused the consent/child event. */
  | 'rejected';

export type PrerequisiteState = {
  state: Prerequisite;
  /** The outbox is backing off after a network failure. */
  offline: boolean;
  /** A manual re-check is running. */
  checking: boolean;
  /** Sends what is queued now and re-reads list_children. */
  recheck: () => Promise<void>;
};

export function derivePrerequisite(input: {
  row: Pick<ChildSummary, 'deletionPending'> | null | undefined;
  bValue: boolean;
  bSynced: boolean;
  eventState: 'pending' | 'inflight' | 'applied' | 'rejected' | 'held' | null;
}): Prerequisite {
  if (input.row) return 'ready';
  if (!input.bValue) return 'needs_consent';
  if (input.bSynced) return 'ready';
  if (input.eventState === 'rejected' || input.eventState === 'held') return 'rejected';
  return 'waiting';
}

export function usePrerequisite(childId: string, summaries: ChildSummariesState): PrerequisiteState {
  const record = useLocalData((s) => s.consentRecords[childId]?.b);
  const backoff = useOutboxStatus((s) => s.backoffReason);
  const pending = useOutboxStatus((s) => s.pending);
  const rejected = useOutboxStatus((s) => s.rejected + s.held);
  const [checking, setChecking] = useState(false);
  const alive = useRef(true);
  const row = summaries.rows[childId] ?? null;

  // `rejected` / `pending` are read only to re-render when the outbox moves.
  void rejected;
  void pending;
  const eventId = queuedConsentGrant(childId, 'b');
  const eventState = eventId ? outbox.getEventState(eventId) : null;
  const state = derivePrerequisite({
    row,
    bValue: record?.value === true,
    bSynced: record?.synced === true,
    eventState,
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Entering the waiting state: send what is queued now instead of waiting for the next timer.
  const waiting = state === 'waiting';
  useEffect(() => {
    if (waiting) void outbox.flush({ ignoreBackoff: true });
  }, [waiting]);

  // When the queue empties while waiting, ask the server whether the child is there now.
  const reload = summaries.reload;
  useEffect(() => {
    if (waiting && pending === 0) void reload();
  }, [waiting, pending, reload]);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      await outbox.flush({ ignoreBackoff: true });
      await reload();
    } finally {
      if (alive.current) setChecking(false);
    }
  }, [reload]);

  return { state, offline: backoff === 'network', checking, recheck };
}
