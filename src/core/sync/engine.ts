// Wires the local store, the outbox and the sync bridge to the session (mounted once in the
// root layout via useSyncEngine).
//
// - Scope: signed in -> local data and outbox of that user id; guest -> local data 'guest', no
//   outbox (no-account mode never sends anything); signed out / loading -> neither.
// - Once both scopes are loaded, and whenever my_account() changes: align the local children
//   with the account (child account / teen self profile), reconcile unsynced records, flush.
// - Flush triggers besides the outbox's own debounce after enqueue: app back to the foreground
//   (retries now after a network/server failure), every 60 s while in the foreground with
//   events waiting, and on every session user change (above).
// - Going to the background writes pending local changes immediately.

import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAccount } from '@/core/account/account-store';
import { useSession, type AuthStatus } from '@/core/auth/session-store';
import { GUEST_SCOPE, useLocalData } from '@/data/local-store';

import { installSyncBridge, reconcile } from './bridge';
import { outbox } from './outbox';

export const PERIODIC_FLUSH_MS = 60_000;

/** Which local-data scope and which outbox scope a session state maps to (pure). */
export function scopesFor(status: AuthStatus, userId: string | null): { local: string | null; outbox: string | null } {
  if (status === 'signedIn' && userId) return { local: userId, outbox: userId };
  if (status === 'guest') return { local: GUEST_SCOPE, outbox: null };
  return { local: null, outbox: null };
}

/** Aligns children with the account, queues anything unsynced, and starts a flush. */
export function syncNow(): void {
  useLocalData.getState().applyAccount(useAccount.getState().me);
  reconcile();
  void outbox.flush();
}

let stop: (() => void) | null = null;

/** Starts the engine (idempotent). Returns the stop function. */
export function startSyncEngine(): () => void {
  if (stop) return stop;
  const uninstallBridge = installSyncBridge();
  let appliedKey: string | null = null;

  const applyScopes = () => {
    const { status, userId } = useSession.getState();
    const scopes = scopesFor(status, userId);
    const key = `${scopes.local ?? ''}|${scopes.outbox ?? ''}`;
    if (key === appliedKey) return;
    appliedKey = key;
    const localReady = useLocalData.getState().setScope(scopes.local);
    const outboxReady = outbox.setScope(scopes.outbox);
    void Promise.all([localReady, outboxReady]).then(() => {
      if (appliedKey === key && scopes.local) syncNow();
    });
  };

  const unsubscribeSession = useSession.subscribe((s, prev) => {
    if (s.status !== prev.status || s.userId !== prev.userId) applyScopes();
  });
  const unsubscribeAccount = useAccount.subscribe((s, prev) => {
    if (s.me !== prev.me) syncNow();
  });
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') void outbox.flush({ ignoreBackoff: true });
    else void useLocalData.getState().flushWrites();
  });
  const timer = setInterval(() => {
    if (AppState.currentState === 'active' && outbox.pendingCount() > 0) void outbox.flush();
  }, PERIODIC_FLUSH_MS);

  applyScopes();

  stop = () => {
    unsubscribeSession();
    unsubscribeAccount();
    appState.remove();
    clearInterval(timer);
    uninstallBridge();
    stop = null;
  };
  return stop;
}

/** Mount once in the root layout, before the session is hydrated. */
export function useSyncEngine(): void {
  useEffect(() => startSyncEngine(), []);
}
