import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { useAccount } from '@/core/account/account-store';

import { appStorage } from './secure-storage';
import { supabase } from './supabase';

// 'guest' = no-account mode (PRD FR-01): everything works locally, nothing syncs.
export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'guest';

const GUEST_KEY = 'dentisai.guest';
const SESSION_KEY = 'dentisai.auth';
// Pre-v2 cache of user_role rows. Roles now come from my_account() (account store); the old
// key is only removed on sign-out.
const LEGACY_ROLES_KEY = 'dentisai.roles';

type SessionState = {
  status: AuthStatus;
  email: string | null;
  userId: string | null;
  /** Email waiting for confirmation; kept in memory only (never in a URL). */
  pendingEmail: string | null;
  /** True after a password-recovery link created a session. */
  recovering: boolean;
  hydrate: () => Promise<void>;
  continueAsGuest: () => Promise<void>;
  leaveGuest: () => Promise<void>;
  signOut: () => Promise<void>;
  setPendingEmail: (email: string | null) => void;
  setRecovering: (value: boolean) => void;
};

function fromSession(session: Session) {
  return { status: 'signedIn' as const, email: session.user.email ?? null, userId: session.user.id };
}

// Offline-first: an expired access token must not lock a parent out of local data.
// If a session is stored but cannot be refreshed right now (no signal), keep the
// user signed in locally; sync will refresh it later.
async function readStoredUser(): Promise<{ email: string | null; userId: string } | null> {
  try {
    const raw = await appStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: { id?: unknown; email?: unknown } };
    if (typeof parsed.user?.id !== 'string') return null;
    return { userId: parsed.user.id, email: typeof parsed.user.email === 'string' ? parsed.user.email : null };
  } catch {
    return null;
  }
}

/**
 * Points the account store at `userId`, restoring its cached my_account() (offline routing),
 * then refreshes it in the background. Roles, account type and capabilities live there.
 */
async function activateAccount(userId: string) {
  await useAccount.getState().setUser(userId);
  void useAccount.getState().refresh();
}

let subscribed = false;

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  email: null,
  userId: null,
  pendingEmail: null,
  recovering: false,

  async hydrate() {
    const guest = (await appStorage.getItem(GUEST_KEY)) === '1';

    if (supabase && !subscribed) {
      subscribed = true;
      // Only set state here: calling other supabase.auth methods inside this
      // callback can deadlock (Supabase guidance).
      supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') set({ recovering: true });
        if (session) {
          set(fromSession(session));
        } else if (event === 'SIGNED_OUT') {
          // Also when the server ends the session (e.g. a disabled child account's refresh
          // token is refused): forget the account so routing returns to the entry screens.
          set({ status: get().status === 'guest' ? 'guest' : 'signedOut', email: null, userId: null });
          void useAccount.getState().clear();
        }
      });
    }

    if (supabase) {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        await activateAccount(data.session.user.id);
        set(fromSession(data.session));
        return;
      }
      const stored = await readStoredUser();
      if (stored) {
        // Offline with an expired token: route from the cached account; refresh() fails
        // quietly and is retried on the next foreground.
        await activateAccount(stored.userId);
        set({ status: 'signedIn', ...stored });
        return;
      }
    }
    set({ status: guest ? 'guest' : 'signedOut', email: null, userId: null });
  },

  async continueAsGuest() {
    await appStorage.setItem(GUEST_KEY, '1');
    set({ status: 'guest', email: null, userId: null });
  },

  // From no-account mode to the login screens. Local data stays on the device.
  async leaveGuest() {
    await appStorage.removeItem(GUEST_KEY);
    set({ status: 'signedOut' });
  },

  async signOut() {
    // scope 'local' works offline; local data stays unless the user deletes it. This also
    // ends a child-login session: it is an ordinary Supabase session in the same storage.
    if (supabase) {
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // The stored session is removed below either way.
      }
    }
    await appStorage.removeItem(SESSION_KEY);
    await appStorage.removeItem(LEGACY_ROLES_KEY);
    await useAccount.getState().clear();
    set({ status: 'signedOut', email: null, userId: null, recovering: false });
  },

  setPendingEmail(email) {
    set({ pendingEmail: email });
  },

  setRecovering(value) {
    set({ recovering: value });
  },
}));

/** Called after a successful sign-in: a guest who signs in is no longer a guest. */
export async function clearGuestFlag() {
  await appStorage.removeItem(GUEST_KEY);
}
