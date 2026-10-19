// resolveHome (src/core/account/routing.ts) + account model constants (src/domain/models.ts).

import { homePath, resolveHome, type HomeRoute } from '@/core/account/routing';
import type { AccountStatus } from '@/core/account/account-store';
import type { AuthStatus } from '@/core/auth/session-store';
import {
  CONSENT_TEXT_VERSION_RE,
  DEFAULT_LIMITS,
  consentTextVersions,
  fromServerLevel,
  toServerLevel,
  type AppLevel,
  type MyAccount,
  type ServerLevel,
} from '@/domain/models';

const SELF = 'c0c0c0c0-0000-4000-8000-000000000001';

function account(accountType: MyAccount['accountType'], selfChildId: string | null = null): MyAccount {
  return {
    userId: '0b0b0b0b-0000-4000-8000-000000000001',
    accountType,
    roles: accountType === 'child' ? ['child'] : ['guardian'],
    selfChildId,
    childAccounts: accountType === 'child' ? null : 0,
    childAccount:
      accountType === 'child'
        ? {
            childId: SELF,
            guardianId: '0b0b0b0b-0000-4000-8000-000000000002',
            username: 'si.budi',
            disabled: false,
            syncAllowed: true,
            proofAllowed: false,
          }
        : null,
    flags: { brushingProofVideo: false },
    capabilities: { createChildAccounts: accountType === 'guardian', registerProofs: false },
    limits: DEFAULT_LIMITS,
  };
}

describe('resolveHome', () => {
  const cases: [string, AuthStatus, MyAccount | null, AccountStatus, HomeRoute][] = [
    ['loading session', 'loading', null, 'idle', 'entry'],
    ['signed out', 'signedOut', null, 'idle', 'entry'],
    ['signed out ignores a stale account', 'signedOut', account('guardian'), 'ready', 'entry'],
    ['guest', 'guest', null, 'idle', 'guest'],
    ['guardian', 'signedIn', account('guardian'), 'ready', 'guardian'],
    ['guardian from cache while offline', 'signedIn', account('guardian'), 'error', 'guardian'],
    ['legacy backend guardian', 'signedIn', { ...account('guardian'), legacy: true }, 'ready', 'guardian'],
    ['teen with self profile', 'signedIn', account('teen', SELF), 'ready', 'teen'],
    ['teen without self profile', 'signedIn', account('teen'), 'ready', 'teenSetup'],
    ['child account', 'signedIn', account('child'), 'ready', 'child'],
    ['signed in, account loading', 'signedIn', null, 'loading', 'accountGate'],
    ['signed in, account not read yet', 'signedIn', null, 'idle', 'accountGate'],
    ['signed in, refresh failed, nothing cached', 'signedIn', null, 'error', 'accountGate'],
  ];

  it.each(cases)('%s -> %s', (_name, session, me, accountStatus, expected) => {
    expect(resolveHome(session, me, accountStatus)).toBe(expected);
  });

  it('every home has a start path', () => {
    expect(homePath).toEqual({
      entry: '/welcome',
      guest: '/home',
      guardian: '/home',
      teen: '/home',
      teenSetup: '/onboarding/teen-setup',
      child: '/kid',
      accountGate: '/account-gate',
    });
  });
});

describe('level mapping app <-> server (SYNC_EVENTS.md §3.3)', () => {
  const pairs: [AppLevel, ServerLevel][] = [
    ['emergency', 'red'],
    ['urgent', 'orange'],
    ['scheduled', 'yellow'],
    ['routine', 'green'],
  ];
  it.each(pairs)('%s <-> %s', (app, server) => {
    expect(toServerLevel(app)).toBe(server);
    expect(fromServerLevel(server)).toBe(app);
  });
});

describe('consent text versions (CONSENT_TEXT_DRAFT.md)', () => {
  it('uses the current draft ids', () => {
    expect(consentTextVersions).toEqual({
      guardian: {
        a: 'consent-a-v0.1-draft-id',
        b: 'consent-b-v0.2-draft-id',
        c: 'consent-c-v0.1-draft-id',
        d: 'consent-d-v0.1-draft-id',
      },
      teen: {
        a: 'consent-a-teen-v0.1-draft-id',
        b: 'consent-b-teen-v0.1-draft-id',
        c: 'consent-c-teen-v0.1-draft-id',
        d: 'consent-d-teen-v0.2-draft-id',
      },
    });
  });

  it('every id passes the server text_version check', () => {
    const ids = [...Object.values(consentTextVersions.guardian), ...Object.values(consentTextVersions.teen)];
    for (const v of ids) expect(v).toMatch(CONSENT_TEXT_VERSION_RE);
  });
});

describe('DEFAULT_LIMITS (ACCOUNTS_AND_FLOWS.md §3, ADR 018)', () => {
  it('matches the documented defaults', () => {
    expect(DEFAULT_LIMITS).toEqual({
      teenMinAge: 15,
      teenMaxAge: 19,
      maxChildAccountsPerGuardian: 6,
      streakMinDurationS: 60,
      requestMaxPerChildPerDay: 5,
      requestExpiryDays: 14,
      proofMaxBytes: 10485760,
      proofMaxDurationS: 180,
      proofMaxPerChildPerDay: 3,
      proofRetentionDays: 7,
    });
  });
});
