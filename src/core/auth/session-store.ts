import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { appRoles, type AppRole } from '@/domain/models';

import { appStorage } from './secure-storage';
import { supabase } from './supabase';

// 'guest' = no-account mode (PRD FR-01): everything works locally, nothing syncs.
export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'guest';

const GUEST_KEY = 'dentisai.guest';
const SESSION_KEY = 'dentisai.auth';
// Last known roles, so the profile shows the right badge offline.
const ROLES_KEY = 'dentisai.roles';

type SessionState = {
  status: AuthStatus;
  email: string | null;
  userId: string | null;
  /** Email waiting for confirmation; kept in memory only (never in a URL). */
  pendingEmail: string | null;
  /** True after a password-recovery link created a session. */
  recovering: boolean;
  /** From public.user_role (the signup trigger always grants 'guardian'). */
  roles: AppRole[];
  hydrate: () => Promise<void>;
  /** Re-reads the account's roles; keeps the last known ones when offline. */
  refreshRoles: () => Promise<void>;
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

function parseRoles(value: unknown): AppRole[] {
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is AppRole => typeof r === 'string' && (appRoles as readonly string[]).includes(r));
}

async function readStoredRoles(): Promise<AppRole[]> {
  try {
    const raw = await appStorage.getItem(ROLES_KEY);
    return raw ? parseRoles(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

let subscribed = false;

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  email: null,
  userId: null,
  pendingEmail: null,
  recovering: false,
  roles: [],

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
          set({ status: get().status === 'guest' ? 'guest' : 'signedOut', email: null, userId: null, roles: [] });
        }
      });
    }

    if (supabase) {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        set({ ...fromSession(data.session), roles: await readStoredRoles() });
        void get().refreshRoles();
        return;
      }
      const stored = await readStoredUser();
      if (stored) {
        set({ status: 'signedIn', ...stored, roles: await readStoredRoles() });
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
    // scope 'local' works offline; local data stays unless the user deletes it.
    if (supabase) await supabase.auth.signOut({ scope: 'local' });
    await appStorage.removeItem(SESSION_KEY);
    await appStorage.removeItem(ROLES_KEY);
    set({ status: 'signedOut', email: null, userId: null, recovering: false, roles: [] });
  },

  async refreshRoles() {
    if (!supabase || get().status !== 'signedIn') return;
    try {
      // RLS: an account reads only its own rows (user_role_select_own).
      const { data, error } = await supabase.from('user_role').select('role');
      if (error || !data) return;
      const roles = parseRoles(data.map((row: { role: unknown }) => row.role));
      set({ roles });
      await appStorage.setItem(ROLES_KEY, JSON.stringify(roles));
    } catch {
      // Offline: keep the last known roles.
    }
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
