import { DEFAULT_LIMITS, type MyAccount } from '@/domain/models';
import { cameraAvailability, type CameraAvailabilityInput } from '@/features/brushing/camera-availability';

const PARENT = 'AAAAAAAA-0000-4000-8000-000000000001';
const CHILD = 'bbbbbbbb-0000-4000-8000-000000000002';
const TEEN = 'cccccccc-0000-4000-8000-000000000003';
const SELF = 'dddddddd-0000-4000-8000-000000000004';

function account(over: Partial<MyAccount>): MyAccount {
  return {
    userId: TEEN,
    accountType: 'teen',
    roles: ['guardian'],
    selfChildId: SELF,
    childAccounts: 0,
    childAccount: null,
    flags: { brushingProofVideo: true },
    capabilities: { createChildAccounts: false, registerProofs: true },
    limits: DEFAULT_LIMITS,
    ...over,
  };
}

const childMe = (over: Partial<NonNullable<MyAccount['childAccount']>> = {}) =>
  account({
    userId: CHILD.replace('bbbb', 'eeee'),
    accountType: 'child',
    roles: ['child'],
    selfChildId: null,
    childAccounts: null,
    childAccount: { childId: CHILD, guardianId: PARENT, username: 'si.budi', disabled: false, syncAllowed: true, proofAllowed: true, ...over },
  });

function input(over: Partial<CameraAvailabilityInput> = {}): CameraAvailabilityInput {
  return {
    platform: 'android',
    sessionStatus: 'signedIn',
    userId: TEEN,
    me: account({}),
    kids: [{ id: SELF, isSelf: true }],
    consents: { [SELF]: { b: true, d: true } },
    syncBlocked: {},
    permission: { granted: true, canAskAgain: true },
    cameraFailed: false,
    ...over,
  };
}

const childInput = (over: Partial<CameraAvailabilityInput> = {}) => {
  const me = (over.me as MyAccount | undefined) ?? childMe();
  return input({ userId: me.userId, me, kids: [{ id: CHILD }], consents: {}, ...over });
};

describe('cameraAvailability', () => {
  it('child account with proof_allowed records for the parent (owner = guardian id, lower case)', () => {
    expect(cameraAvailability(childInput())).toEqual({
      available: true,
      childId: CHILD,
      ownerId: PARENT.toLowerCase(),
      audience: 'parent',
      needsPermission: false,
    });
  });

  it('teen with local consents (b) and (d) records for themself (owner = own user id)', () => {
    expect(cameraAvailability(input())).toEqual({
      available: true,
      childId: SELF,
      ownerId: TEEN,
      audience: 'self',
      needsPermission: false,
    });
  });

  it('teen falls back to the local self profile before my_account() knows it', () => {
    const res = cameraAvailability(input({ me: account({ selfChildId: null }) }));
    expect(res).toMatchObject({ available: true, childId: SELF });
  });

  it.each([
    ['web preview', { platform: 'web' }, 'unsupported_platform'],
    ['guest', { sessionStatus: 'guest' as const, userId: null }, 'not_signed_in'],
    ['signed out', { sessionStatus: 'signedOut' as const }, 'not_signed_in'],
    ['account not loaded', { me: null }, 'account_unknown'],
    ['account of another user', { userId: PARENT }, 'account_unknown'],
    ['legacy backend', { me: account({ legacy: true }) }, 'legacy_backend'],
    ['no capability', { me: account({ capabilities: { createChildAccounts: false, registerProofs: false } }) }, 'no_capability'],
    ['feature flag off', { me: account({ flags: { brushingProofVideo: false } }) }, 'no_capability'],
    ['teen without consent (d)', { consents: { [SELF]: { b: true, d: false } } }, 'no_consent'],
    ['teen without consent (b)', { consents: { [SELF]: { b: false, d: true } } }, 'no_consent'],
    ['teen without any consent record', { consents: {} }, 'no_consent'],
    ['teen without a self profile', { me: account({ selfChildId: null }), kids: [] }, 'no_self_profile'],
    ['teen self profile blocked (deletion pending)', { syncBlocked: { [SELF]: 'deletion_pending' } }, 'sync_off'],
    ['camera permission permanently denied', { permission: { granted: false, canAskAgain: false } }, 'permission_denied'],
    ['camera failed earlier', { cameraFailed: true }, 'camera_error'],
  ])('%s -> timer mode', (_name, over, reason) => {
    expect(cameraAvailability(input(over as Partial<CameraAvailabilityInput>))).toEqual({ available: false, reason });
  });

  it('guardians never record, even with every capability', () => {
    const me = account({
      userId: PARENT,
      accountType: 'guardian',
      selfChildId: null,
      capabilities: { createChildAccounts: true, registerProofs: true },
    });
    expect(cameraAvailability(input({ userId: PARENT, me }))).toEqual({ available: false, reason: 'guardian' });
  });

  it.each([
    // my_account(): register_proofs follows proof_allowed for child accounts.
    ['proof not allowed (parent has not granted d)', { ...childMe({ proofAllowed: false }), capabilities: { createChildAccounts: false, registerProofs: false } }, 'proof_not_allowed'],
    ['account disabled', childMe({ disabled: true }), 'proof_not_allowed'],
    ['feature flag off', { ...childMe({ proofAllowed: false }), flags: { brushingProofVideo: false } }, 'no_capability'],
    ['no capability', { ...childMe(), capabilities: { createChildAccounts: false, registerProofs: false } }, 'no_capability'],
    ['sync not allowed', childMe({ syncAllowed: false }), 'sync_off'],
  ])('child account: %s -> timer mode', (_name, me, reason) => {
    expect(cameraAvailability(childInput({ me }))).toEqual({ available: false, reason });
  });

  it('child account without child_account details is unknown', () => {
    const me = { ...childMe(), childAccount: null };
    expect(cameraAvailability(childInput({ me }))).toEqual({ available: false, reason: 'account_unknown' });
  });

  it('asks for the camera permission first when it is not granted yet (or not loaded)', () => {
    expect(cameraAvailability(input({ permission: { granted: false, canAskAgain: true } }))).toMatchObject({
      available: true,
      needsPermission: true,
    });
    expect(cameraAvailability(input({ permission: null }))).toMatchObject({ available: true, needsPermission: true });
  });

  it('records on iOS too', () => {
    expect(cameraAvailability(input({ platform: 'ios' }))).toMatchObject({ available: true });
  });
});
