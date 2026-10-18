import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { appStorage } from '@/core/auth/secure-storage';
import { DEFAULT_LIMITS, type AccountLimits, type AccountType, type MyAccount } from '@/domain/models';

import { myAccount, parseMyAccount, type ApiErrorCode } from './api';

// Who is signed in, as the SERVER says (my_account(), ADR 017/018). Routing, role badges and
// capability-gated buttons read this store; nothing guesses the account type on the client.
// The last good answer is cached per user id in secure storage so an offline cold start
// routes to the right home. The session store tells this store which user is active.

export type AccountStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Foreground refresh at most this often (ms). */
export const FOREGROUND_REFRESH_MS = 5 * 60 * 1000;

const CACHE_PREFIX = 'dentisai.account.';

function cacheKey(userId: string): string {
  return `${CACHE_PREFIX}${userId}`;
}

type AccountState = {
  /** Active user (from the session store); the cache and refresh are scoped to it. */
  userId: string | null;
  me: MyAccount | null;
  status: AccountStatus;
  /** Code of the last failed refresh (null after a success). */
  lastError: ApiErrorCode | null;
  /** Date.now() of the last successful refresh in this app run. */
  lastFetchedAt: number | null;
  /**
   * Switches to `userId` and loads its cached account (awaited behind the splash so an
   * offline launch routes correctly). Does not call the network; call refresh() after.
   */
  setUser: (userId: string | null) => Promise<void>;
  /** Re-reads my_account(). Concurrent calls share one request. Never throws. */
  refresh: () => Promise<void>;
  /** Forgets the active user's account (memory and cache). Used on sign-out. */
  clear: () => Promise<void>;
};

async function readCache(userId: string): Promise<MyAccount | null> {
  try {
    const raw = await appStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { me?: unknown; legacy?: unknown };
    // Re-validate: the cache may come from an older app version.
    const me = parseMyAccount(parsed.me);
    if (me.userId !== userId) return null;
    return parsed.legacy === true ? { ...me, legacy: true } : me;
  } catch {
    return null;
  }
}

/** Inverse of parseMyAccount, so the cache is re-validated by the same parser on read. */
function toWire(me: MyAccount) {
  return {
    user_id: me.userId,
    account_type: me.accountType,
    roles: me.roles,
    self_child_id: me.selfChildId,
    child_accounts: me.childAccounts,
    child_account: me.childAccount && {
      child_id: me.childAccount.childId,
      guardian_id: me.childAccount.guardianId,
      username: me.childAccount.username,
      disabled: me.childAccount.disabled,
      sync_allowed: me.childAccount.syncAllowed,
      proof_allowed: me.childAccount.proofAllowed,
    },
    flags: { brushing_proof_video: me.flags.brushingProofVideo },
    capabilities: {
      create_child_accounts: me.capabilities.createChildAccounts,
      register_proofs: me.capabilities.registerProofs,
    },
    limits: {
      teen_min_age: me.limits.teenMinAge,
      teen_max_age: me.limits.teenMaxAge,
      max_child_accounts_per_guardian: me.limits.maxChildAccountsPerGuardian,
      streak_min_duration_s: me.limits.streakMinDurationS,
      request_max_per_child_per_day: me.limits.requestMaxPerChildPerDay,
      request_expiry_days: me.limits.requestExpiryDays,
      proof_max_bytes: me.limits.proofMaxBytes,
      proof_max_duration_s: me.limits.proofMaxDurationS,
      proof_max_per_child_per_day: me.limits.proofMaxPerChildPerDay,
      proof_retention_days: me.limits.proofRetentionDays,
    },
  };
}

async function writeCache(me: MyAccount) {
  try {
    await appStorage.setItem(cacheKey(me.userId), JSON.stringify({ me: toWire(me), legacy: me.legacy === true }));
  } catch {
    // A cache write failure only costs an offline cold start; never surface it.
  }
}

/**
 * A backend without my_account() (pre-ADR 017, PGRST202) only knows guardian accounts. This is
 * what the server confirms, not a client guess: every v2 feature stays off (legacy: true).
 */
export function legacyGuardianAccount(userId: string): MyAccount {
  return {
    userId,
    accountType: 'guardian',
    roles: ['guardian'],
    selfChildId: null,
    childAccounts: 0,
    childAccount: null,
    flags: { brushingProofVideo: false },
    capabilities: { createChildAccounts: false, registerProofs: false },
    limits: DEFAULT_LIMITS,
    legacy: true,
  };
}

let inFlight: Promise<void> | null = null;

export const useAccount = create<AccountState>((set, get) => ({
  userId: null,
  me: null,
  status: 'idle',
  lastError: null,
  lastFetchedAt: null,

  async setUser(userId) {
    if (get().userId === userId && (get().me || !userId)) return;
    inFlight = null;
    set({ userId, me: null, status: 'idle', lastError: null, lastFetchedAt: null });
    if (!userId) return;
    const cached = await readCache(userId);
    // The user may have changed while the cache was read.
    if (get().userId === userId && cached) set({ me: cached, status: 'ready' });
  },

  refresh() {
    if (inFlight) return inFlight;
    const userId = get().userId;
    if (!userId) return Promise.resolve();
    set({ status: get().me ? get().status : 'loading' });
    const run = (async () => {
      const res = await myAccount();
      if (get().userId !== userId) return; // signed out / switched meanwhile
      if (res.ok) {
        // A session for another user than the one we track must not be cached under its key.
        if (res.data.userId !== userId) {
          set({ status: get().me ? 'ready' : 'error', lastError: 'bad_response' });
          return;
        }
        set({ me: res.data, status: 'ready', lastError: null, lastFetchedAt: Date.now() });
        await writeCache(res.data);
        return;
      }
      if (res.code === 'not_deployed') {
        // 'not_deployed' also covers a 404 from a proxy / captive portal or a stale PostgREST
        // schema cache. Once the server confirmed a v2 account, it never becomes a legacy
        // guardian: that would route a child into the parent app (and cache it). Keep it and
        // treat the answer as a transient failure.
        const current = get().me;
        if (current && current.legacy !== true) {
          set({ status: 'ready', lastError: res.code });
          return;
        }
        const legacy = legacyGuardianAccount(userId);
        set({ me: legacy, status: 'ready', lastError: null, lastFetchedAt: Date.now() });
        await writeCache(legacy);
        return;
      }
      // Offline / server trouble: keep the cached account if there is one.
      set({ status: get().me ? 'ready' : 'error', lastError: res.code });
    })().finally(() => {
      if (inFlight === run) inFlight = null;
    });
    inFlight = run;
    return run;
  },

  async clear() {
    const userId = get().userId;
    inFlight = null;
    set({ userId: null, me: null, status: 'idle', lastError: null, lastFetchedAt: null });
    if (userId) {
      try {
        await appStorage.removeItem(cacheKey(userId));
      } catch {
        // Nothing else to do; the entry is re-validated against the user id on read.
      }
    }
  },
}));

// ---------------------------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------------------------

/** The signed-in account (null: guest, signed out, or not loaded yet). */
export function useMe(): MyAccount | null {
  return useAccount((s) => s.me);
}

export function useAccountType(): AccountType | null {
  return useAccount((s) => s.me?.accountType ?? null);
}

const NO_CAPABILITIES = { createChildAccounts: false, registerProofs: false } as const;

/** Capability flags; all false when unknown (guest, offline first launch, legacy backend). */
export function useCapabilities(): MyAccount['capabilities'] {
  return useAccount((s) => s.me?.capabilities ?? NO_CAPABILITIES);
}

/** Server limits, falling back to DEFAULT_LIMITS until my_account() was read once. */
export function useLimits(): AccountLimits {
  return useAccount((s) => s.me?.limits ?? DEFAULT_LIMITS);
}

/** Pure: should a foreground event trigger a refresh? */
export function shouldRefreshOnForeground(lastFetchedAt: number | null, now: number): boolean {
  return lastFetchedAt === null || now - lastFetchedAt >= FOREGROUND_REFRESH_MS;
}

/**
 * Mount once (root layout): refreshes my_account() when the app returns to the foreground,
 * at most every 5 minutes, while `active` (a user is signed in).
 */
export function useAccountForegroundRefresh(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const { lastFetchedAt, refresh } = useAccount.getState();
      if (shouldRefreshOnForeground(lastFetchedAt, Date.now())) void refresh();
    });
    return () => sub.remove();
  }, [active]);
}
