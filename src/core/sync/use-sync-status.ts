import type { SyncStatus } from '@/components/sync-status-pill';
import { useSession, type AuthStatus } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';

import { useOutboxStatus, type OutboxStatus } from './outbox';

/**
 * SyncStatusPill state from the session and the outbox (pure):
 * - 'local': guest / signed out (nothing is ever sent);
 * - 'attention': the server rejected something, an event is held behind a rejection, or the
 *   session must be renewed (auth_required);
 * - 'synced': nothing waiting; 'offline': waiting after a network failure;
 * - 'pending': waiting otherwise (queued, sending, server trouble, sync_events not deployed).
 */
export function deriveSyncStatus(session: AuthStatus, outbox: OutboxStatus): SyncStatus {
  if (session !== 'signedIn') return 'local';
  if (outbox.pauseReason === 'auth_required' || outbox.rejected > 0 || outbox.held > 0) return 'attention';
  if (!outbox.ready) return 'pending';
  if (outbox.pending === 0) return 'synced';
  if (outbox.backoffReason === 'network') return 'offline';
  return 'pending';
}

export function useSyncStatus(): SyncStatus {
  const session = useSession((s) => s.status);
  return useOutboxStatus((s) => deriveSyncStatus(session, s));
}

const t = id.syncV2;

/** Short explanation of the current outbox state for a banner, or null when nothing to say. */
export function syncMessage(session: AuthStatus, outbox: OutboxStatus): string | null {
  if (session === 'guest') return t.messages.localOnly;
  if (session !== 'signedIn') return null;
  if (outbox.pauseReason === 'auth_required') return t.messages.authRequired;
  if (outbox.rejected > 0 || outbox.held > 0) return t.messages.needsAttention;
  if (outbox.pauseReason === 'unavailable') return t.messages.unavailable;
  if (outbox.pending > 0 && outbox.backoffReason === 'network') return t.messages.offline;
  if (outbox.pending > 0) return t.messages.pending;
  return null;
}

export function useSyncMessage(): string | null {
  const session = useSession((s) => s.status);
  return useOutboxStatus((s) => syncMessage(session, s));
}

/** Text for a rejection code shown in the "needs attention" list (unknown codes -> generic). */
export function rejectionMessage(code: string | null | undefined): string {
  const codes: Record<string, string> = t.codes;
  return (code && codes[code]) || t.codes.unknown;
}
