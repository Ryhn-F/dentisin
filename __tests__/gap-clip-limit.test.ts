import { DEFAULT_LIMITS, type MyAccount } from '@/domain/models';
import { cameraAvailability, type CameraAvailabilityInput } from '@/features/brushing/camera-availability';
import { proofCountsToday } from '@/features/brushing/proof-quota';

const PARENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const CHILD = 'bbbbbbbb-0000-4000-8000-000000000002';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000009';
const TEEN = 'cccccccc-0000-4000-8000-000000000003';
const SELF = 'dddddddd-0000-4000-8000-000000000004';

// 2026-10-18 07:00 WIB (00:00Z). The WIB day runs 2026-10-17T17:00Z .. 2026-10-18T16:59:59Z.
const NOW = new Date('2026-10-18T00:00:00Z');

type Uploads = Parameters<typeof proofCountsToday>[1];

const rec = (childId: string, startedAt: string, proofId: string | null) => ({ childId, startedAt, proofId });
const up = (
  childId: string,
  proofId: string,
  createdAt: string,
  over: { state?: 'waiting' | 'uploading' | 'retrying' | 'done' | 'failed'; failure?: string | null } = {},
) => ({ childId, proofId, createdAt: Date.parse(createdAt), state: 'done', failure: null, ...over }) as unknown as Uploads[number];

describe('proofCountsToday', () => {
  it('counts brushing records with a proof that started today in Asia/Jakarta', () => {
    const counts = proofCountsToday(
      [
        rec(CHILD, '2026-10-17T17:00:00Z', 'p1'), // 00:00 WIB today
        rec(CHILD, '2026-10-17T16:59:59Z', 'p2'), // 23:59:59 WIB yesterday
        rec(CHILD, '2026-10-18T10:00:00Z', 'p3'),
        rec(CHILD, '2026-10-18T10:00:00Z', null), // timer-only session
        rec(OTHER, '2026-10-18T02:00:00Z', 'p4'),
      ],
      [],
      NOW,
    );
    expect(counts).toEqual({ [CHILD]: 2, [OTHER]: 1 });
  });

  it('counts a clip once when both the record and the upload queue know it', () => {
    const counts = proofCountsToday(
      [rec(CHILD, '2026-10-18T01:00:00Z', 'P1')],
      [up(CHILD, 'p1', '2026-10-18T01:02:00Z', { state: 'uploading' })],
      NOW,
    );
    expect(counts).toEqual({ [CHILD]: 1 });
  });

  it('counts a queued clip whose record is gone, ignores yesterday uploads', () => {
    const counts = proofCountsToday([], [up(CHILD, 'p1', '2026-10-18T01:00:00Z'), up(CHILD, 'p2', '2026-10-17T10:00:00Z')], NOW);
    expect(counts).toEqual({ [CHILD]: 1 });
  });

  it.each([
    'limit_exceeded',
    'consent_required',
    'feature_disabled',
    'forbidden',
    'deletion_pending',
    'schema_invalid',
    'dependency_rejected',
    'not_registered',
  ])('a clip whose event the server rejected (%s) does not count, even through its record', (failure) => {
    const counts = proofCountsToday(
      [rec(CHILD, '2026-10-18T01:00:00Z', 'p1')],
      [up(CHILD, 'p1', '2026-10-18T01:00:00Z', { state: 'failed', failure })],
      NOW,
    );
    expect(counts).toEqual({});
  });

  it.each(['upload_refused', 'file_missing', 'expired', 'other'])('an applied event whose file failed (%s) still counts', (failure) => {
    const counts = proofCountsToday([], [up(CHILD, 'p1', '2026-10-18T01:00:00Z', { state: 'failed', failure })], NOW);
    expect(counts).toEqual({ [CHILD]: 1 });
  });

  it('ignores invalid dates', () => {
    expect(proofCountsToday([rec(CHILD, 'not a date', 'p1')], [], NOW)).toEqual({});
  });
});

function teen(over: Partial<MyAccount> = {}): MyAccount {
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

function input(over: Partial<CameraAvailabilityInput> = {}): CameraAvailabilityInput {
  return {
    platform: 'android',
    sessionStatus: 'signedIn',
    userId: TEEN,
    me: teen(),
    kids: [{ id: SELF, isSelf: true }],
    consents: { [SELF]: { b: true, d: true } },
    syncBlocked: {},
    permission: { granted: true, canAskAgain: true },
    cameraFailed: false,
    ...over,
  };
}

describe('cameraAvailability: daily clip limit', () => {
  it('stays available below the limit', () => {
    expect(cameraAvailability(input({ proofsToday: { [SELF]: 2 } }))).toMatchObject({ available: true });
  });

  it('is available when no count is given', () => {
    expect(cameraAvailability(input())).toMatchObject({ available: true });
  });

  it('falls back to the timer at the default limit (3)', () => {
    expect(cameraAvailability(input({ proofsToday: { [SELF]: 3 } }))).toEqual({ available: false, reason: 'daily_limit', limit: 3 });
  });

  it('counts only the target child', () => {
    expect(cameraAvailability(input({ proofsToday: { [OTHER]: 9, [SELF]: 1 } }))).toMatchObject({ available: true });
  });

  it('uses the server limit from my_account()', () => {
    const me = teen({ limits: { ...DEFAULT_LIMITS, proofMaxPerChildPerDay: 1 } });
    expect(cameraAvailability(input({ me, proofsToday: { [SELF]: 1 } }))).toEqual({ available: false, reason: 'daily_limit', limit: 1 });
    expect(cameraAvailability(input({ me, proofsToday: { [SELF]: 0 } }))).toMatchObject({ available: true });
  });

  it('child account: counts against the child id', () => {
    const me: MyAccount = teen({
      userId: 'eeeeeeee-0000-4000-8000-000000000005',
      accountType: 'child',
      roles: ['child'],
      selfChildId: null,
      childAccounts: null,
      childAccount: { childId: CHILD, guardianId: PARENT, username: 'si.budi', disabled: false, syncAllowed: true, proofAllowed: true },
    });
    const base = { me, userId: me.userId, kids: [{ id: CHILD }], consents: {} };
    expect(cameraAvailability(input({ ...base, proofsToday: { [CHILD]: 3 } }))).toMatchObject({ available: false, reason: 'daily_limit' });
    expect(cameraAvailability(input({ ...base, proofsToday: { [CHILD]: 2 } }))).toMatchObject({ available: true, childId: CHILD });
  });

  it('other reasons win over the limit (consent first)', () => {
    expect(cameraAvailability(input({ consents: {}, proofsToday: { [SELF]: 5 } }))).toEqual({ available: false, reason: 'no_consent' });
  });
});
