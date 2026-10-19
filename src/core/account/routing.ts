import type { AuthStatus } from '@/core/auth/session-store';
import type { MyAccount } from '@/domain/models';

import type { AccountStatus } from './account-store';

/**
 * Where the app belongs for the current session and account:
 * - entry       signed out (welcome / login / register / child login)
 * - guest       no-account mode (local only)
 * - guardian    parent home (tabs)
 * - teen        teen home (same tabs, own profile, no "add child")
 * - teenSetup   teen without a self profile yet (ensure_self_profile not run)
 * - child       child-account home (/kid)
 * - accountGate signed in, but my_account() is not known yet (first load or it failed and
 *               nothing is cached): a screen with loading / retry / sign out
 */
export type HomeRoute = 'entry' | 'guest' | 'guardian' | 'teen' | 'teenSetup' | 'child' | 'accountGate';

/** Pure routing decision (unit-tested). `loading` session -> 'entry' (the splash covers it). */
export function resolveHome(
  sessionStatus: AuthStatus,
  me: MyAccount | null,
  // Without a known account every status leads to the gate; the gate itself shows loading
  // ('idle' | 'loading') or retry + sign out ('error') from this same value.
  accountStatus: AccountStatus,
): HomeRoute {
  if (sessionStatus === 'guest') return 'guest';
  if (sessionStatus !== 'signedIn') return 'entry';
  if (!me) {
    void accountStatus;
    return 'accountGate';
  }
  switch (me.accountType) {
    case 'child':
      return 'child';
    case 'teen':
      return me.selfChildId ? 'teen' : 'teenSetup';
    case 'guardian':
      return 'guardian';
  }
}

/** Path each home route starts at (used by src/app/index.tsx and the account gate). */
export const homePath = {
  entry: '/welcome',
  guest: '/home',
  guardian: '/home',
  teen: '/home',
  teenSetup: '/onboarding/teen-setup',
  child: '/kid',
  accountGate: '/account-gate',
} as const satisfies Record<HomeRoute, string>;
