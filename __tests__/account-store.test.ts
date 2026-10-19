// Account store (src/core/account/account-store.ts): my_account() cache per user, the
// not_deployed (legacy backend) fallback, offline behaviour, selectors, sign-out integration.

import {
  FOREGROUND_REFRESH_MS,
  legacyGuardianAccount,
  shouldRefreshOnForeground,
  useAccount,
} from '@/core/account/account-store';
import { setStorageBackendForTests, type KeyValueBackend } from '@/core/auth/secure-storage';
import { useSession } from '@/core/auth/session-store';
import { DEFAULT_LIMITS } from '@/domain/models';

jest.mock('@/core/auth/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { signOut: jest.fn(async () => ({ error: null })), getSession: jest.fn(), onAuthStateChange: jest.fn() },
  },
}));

const rpc = (jest.requireMock('@/core/auth/supabase') as { supabase: { rpc: jest.Mock } }).supabase.rpc;

const UID = '0b0b0b0b-0000-4000-8000-000000000001';
const OTHER = '0b0b0b0b-0000-4000-8000-000000000009';
const SELF = 'c0c0c0c0-0000-4000-8000-000000000001';

function teenJson(userId = UID) {
  return {
    user_id: userId,
    account_type: 'teen',
    roles: ['guardian'],
    self_child_id: SELF,
    child_accounts: 0,
    child_account: null,
    flags: { brushing_proof_video: true },
    capabilities: { create_child_accounts: false, register_proofs: true },
    limits: {
      teen_min_age: 15,
      teen_max_age: 19,
      max_child_accounts_per_guardian: 6,
      streak_min_duration_s: 90,
      request_max_per_child_per_day: 5,
      request_expiry_days: 14,
      proof_max_bytes: 5000000,
      proof_max_duration_s: 120,
      proof_max_per_child_per_day: 3,
      proof_retention_days: 7,
    },
  };
}

let store: Map<string, string>;
function memoryBackend(): KeyValueBackend {
  store = new Map();
  return {
    getItem: async (k) => store.get(k) ?? null,
    setItem: async (k, v) => void store.set(k, v),
    removeItem: async (k) => void store.delete(k),
  };
}

function reset() {
  useAccount.setState({ userId: null, me: null, status: 'idle', lastError: null, lastFetchedAt: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  setStorageBackendForTests(memoryBackend());
  reset();
});

afterAll(() => setStorageBackendForTests(null));

describe('account store', () => {
  it('stores the server account and caches it per user id', async () => {
    rpc.mockResolvedValue({ data: teenJson(), error: null, status: 200 });
    await useAccount.getState().setUser(UID);
    await useAccount.getState().refresh();
    const s = useAccount.getState();
    expect(s).toMatchObject({ status: 'ready', lastError: null });
    expect(s.me?.accountType).toBe('teen');
    expect(s.me?.limits.streakMinDurationS).toBe(90);
    expect(s.lastFetchedAt).not.toBeNull();
    expect([...store.keys()].some((k) => k.includes(UID))).toBe(true);
  });

  it('an offline cold start routes from the cache (no network call needed)', async () => {
    rpc.mockResolvedValue({ data: teenJson(), error: null, status: 200 });
    await useAccount.getState().setUser(UID);
    await useAccount.getState().refresh();
    reset(); // simulate an app restart: memory gone, secure storage kept
    await useAccount.getState().setUser(UID);
    expect(useAccount.getState().me?.selfChildId).toBe(SELF);
    expect(useAccount.getState().status).toBe('ready');
  });

  it('does not show one user the cached account of another', async () => {
    rpc.mockResolvedValue({ data: teenJson(), error: null, status: 200 });
    await useAccount.getState().setUser(UID);
    await useAccount.getState().refresh();
    await useAccount.getState().setUser(OTHER);
    expect(useAccount.getState().me).toBeNull();
  });

  it('refuses an answer for a different user than the active one', async () => {
    rpc.mockResolvedValue({ data: teenJson(OTHER), error: null, status: 200 });
    await useAccount.getState().setUser(UID);
    await useAccount.getState().refresh();
    expect(useAccount.getState()).toMatchObject({ me: null, status: 'error', lastError: 'bad_response' });
  });

  it('not_deployed (PGRST202, pre-v2 backend) -> legacy guardian with everything off', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 });
    await useAccount.getState().setUser(UID);
    await useAccount.getState().refresh();
    const me = useAccount.getState().me;
    expect(useAccount.getState().status).toBe('ready');
    expect(me).toEqual(legacyGuardianAccount(UID));
    expect(me).toMatchObject({
      accountType: 'guardian',
      legacy: true,
      flags: { brushingProofVideo: false },
      capabilities: { createChildAccounts: false, registerProofs: false },
      limits: DEFAULT_LIMITS,
    });
    // The legacy marker survives the cache.
    reset();
    await useAccount.getState().setUser(UID);
    expect(useAccount.getState().me?.legacy).toBe(true);
  });

  it('a later not_deployed (proxy 404, stale schema cache) never turns a cached v2 child account into a guardian', async () => {
    const childJson = {
      ...teenJson(),
      account_type: 'child',
      roles: ['child'],
      self_child_id: null,
      child_accounts: null,
      child_account: {
        child_id: SELF,
        guardian_id: OTHER,
        username: 'si.budi',
        disabled: false,
        sync_allowed: true,
        proof_allowed: false,
      },
      capabilities: { create_child_accounts: false, register_proofs: false },
    };
    rpc.mockResolvedValue({ data: childJson, error: null, status: 200 });
    await useAccount.getState().setUser(UID);
    await useAccount.getState().refresh();
    expect(useAccount.getState().me?.accountType).toBe('child');

    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 });
    await useAccount.getState().refresh();
    expect(useAccount.getState()).toMatchObject({ status: 'ready', lastError: 'not_deployed' });
    expect(useAccount.getState().me?.accountType).toBe('child');
    expect(useAccount.getState().me?.legacy).toBeUndefined();
    // The cache still holds the child account after a cold start.
    reset();
    await useAccount.getState().setUser(UID);
    expect(useAccount.getState().me).toMatchObject({ accountType: 'child', childAccount: { childId: SELF } });
  });

  it('a cached legacy guardian stays legacy on not_deployed', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 });
    await useAccount.getState().setUser(UID);
    await useAccount.getState().refresh();
    await useAccount.getState().refresh();
    expect(useAccount.getState().me).toEqual(legacyGuardianAccount(UID));
    expect(useAccount.getState().lastError).toBeNull();
  });

  it('an error with nothing cached is status error (the account gate shows retry)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '', message: 'Network request failed' }, status: 0 });
    await useAccount.getState().setUser(UID);
    await useAccount.getState().refresh();
    expect(useAccount.getState()).toMatchObject({ me: null, status: 'error', lastError: 'network' });
  });

  it('shares one request between concurrent refreshes', async () => {
    rpc.mockResolvedValue({ data: teenJson(), error: null, status: 200 });
    await useAccount.getState().setUser(UID);
    await Promise.all([useAccount.getState().refresh(), useAccount.getState().refresh()]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('refresh without a user does nothing', async () => {
    await useAccount.getState().refresh();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sign-out clears the account and its cache', async () => {
    rpc.mockResolvedValue({ data: teenJson(), error: null, status: 200 });
    useSession.setState({ status: 'signedIn', userId: UID, email: 'remaja@contoh.com' });
    await useAccount.getState().setUser(UID);
    await useAccount.getState().refresh();
    await useSession.getState().signOut();
    expect(useAccount.getState()).toMatchObject({ userId: null, me: null, status: 'idle' });
    expect([...store.keys()].some((k) => k.includes(UID))).toBe(false);
    expect(useSession.getState().status).toBe('signedOut');
  });

  it('foreground refresh at most every 5 minutes', () => {
    expect(FOREGROUND_REFRESH_MS).toBe(300_000);
    expect(shouldRefreshOnForeground(null, 1000)).toBe(true);
    expect(shouldRefreshOnForeground(0, FOREGROUND_REFRESH_MS - 1)).toBe(false);
    expect(shouldRefreshOnForeground(0, FOREGROUND_REFRESH_MS)).toBe(true);
  });
});
