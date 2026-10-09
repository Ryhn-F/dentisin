import { setStorageBackendForTests, type KeyValueBackend } from '@/core/auth/secure-storage';
import { useSession } from '@/core/auth/session-store';
import { isSupabaseConfigured } from '@/core/config';

// Jest has no EXPO_PUBLIC_SUPABASE_* env, so the Supabase client is null and the
// store runs in pure offline mode — the path a first-time user without signal takes.
describe('session store (offline, no server configured)', () => {
  const map = new Map<string, string>();
  const backend: KeyValueBackend = {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
  };

  beforeAll(() => setStorageBackendForTests(backend));
  afterAll(() => setStorageBackendForTests(null));
  beforeEach(() => {
    map.clear();
    useSession.setState({ status: 'loading', email: null, userId: null, pendingEmail: null, recovering: false });
  });

  it('runs without server config', () => {
    expect(isSupabaseConfigured).toBe(false);
  });

  it('starts signed out on a fresh install', async () => {
    await useSession.getState().hydrate();
    expect(useSession.getState().status).toBe('signedOut');
  });

  it('remembers no-account mode across restarts', async () => {
    await useSession.getState().continueAsGuest();
    expect(useSession.getState().status).toBe('guest');

    useSession.setState({ status: 'loading' }); // simulate a cold start
    await useSession.getState().hydrate();
    expect(useSession.getState().status).toBe('guest');
  });

  it('leaving no-account mode goes to sign-in and clears the flag', async () => {
    await useSession.getState().continueAsGuest();
    await useSession.getState().leaveGuest();
    expect(useSession.getState().status).toBe('signedOut');

    useSession.setState({ status: 'loading' });
    await useSession.getState().hydrate();
    expect(useSession.getState().status).toBe('signedOut');
  });

  it('ignores a stored session when the build has no server configured', async () => {
    // The offline "expired token, keep the stored user" path needs a real client;
    // it is exercised on device in phase 3 verification, not here.
    map.set('dentisai.auth.n', '1');
    map.set('dentisai.auth.0', JSON.stringify({ user: { id: 'u-1', email: 'ortu@contoh.com' } }));
    await useSession.getState().hydrate();
    expect(useSession.getState().status).toBe('signedOut');
  });

  it('sign-out clears the stored session', async () => {
    map.set('dentisai.auth.n', '1');
    map.set('dentisai.auth.0', '{}');
    useSession.setState({ status: 'signedIn', email: 'ortu@contoh.com', userId: 'u-1' });
    await useSession.getState().signOut();
    expect(useSession.getState()).toMatchObject({ status: 'signedOut', email: null, userId: null });
    expect(map.size).toBe(0);
  });
});
