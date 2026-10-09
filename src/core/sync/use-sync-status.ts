import type { SyncStatus } from '@/components/sync-status-pill';
import { useSession } from '@/core/auth/session-store';

// Phase 2–3: sync is not implemented yet, so a signed-in user is honestly
// "pending". Phase 4 derives this from the outbox and the last sync_events result.
export function useSyncStatus(): SyncStatus {
  const status = useSession((s) => s.status);
  return status === 'signedIn' ? 'pending' : 'local';
}
