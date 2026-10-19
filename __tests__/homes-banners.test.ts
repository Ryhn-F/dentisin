import { id } from '@/core/i18n/id';
import { DEFAULT_LIMITS, type BrushingStreak, type ChildSummary, type MyAccount, type ScreeningRequest } from '@/domain/models';
import { bannerKey, deriveHomeBanners, homeChildren, joinNames, labelOf, unviewedProofsOf } from '@/features/home/banners';
import { mergeStreaks, weekDots } from '@/features/home/streak';
import { hasOpenSwelling, isOpenRequest, kidAccountView, kidRequestRow } from '@/features/kid/kid-home-logic';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const UNKNOWN = '44444444-4444-4444-8444-444444444444';

function row(childId: string, over: Partial<ChildSummary> = {}): ChildSummary {
  return {
    childId,
    isSelf: false,
    birthYear: 2016,
    birthMonth: null,
    consents: ['a', 'b'],
    hasChildAccount: false,
    childAccountDisabled: null,
    username: null,
    lastScreeningAt: null,
    lastScreeningLevel: null,
    lastBrushingAt: null,
    openRequests: 0,
    unseenRequests: 0,
    unviewedProofs: 0,
    deletionPending: false,
    ...over,
  };
}

const kids = [
  { id: A, nickname: 'Budi' },
  { id: B, nickname: '' },
  { id: C, nickname: '   ' },
];

describe('homeChildren / labels', () => {
  it('uses the nickname, else numbers unnamed children "Anak 1", "Anak 2"', () => {
    expect(homeChildren(kids)).toEqual([
      { id: A, label: 'Budi', named: true },
      { id: B, label: id.homeV2.fallbackName(1), named: false },
      { id: C, label: id.homeV2.fallbackName(2), named: false },
    ]);
    expect(id.homeV2.fallbackName(1)).toBe('Anak 1');
  });

  it('labels a child unknown on this device "Anak"', () => {
    expect(labelOf(homeChildren(kids), UNKNOWN)).toBe(id.homeV2.fallbackNameUnknown);
  });

  it('joins names the Indonesian way', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Budi'])).toBe('Budi');
    expect(joinNames(['Budi', 'Sari'])).toBe('Budi dan Sari');
    expect(joinNames(['Budi', 'Sari', 'Ani'])).toBe('Budi, Sari dan Ani');
  });
});

describe('deriveHomeBanners', () => {
  const children = homeChildren(kids);

  it('guardian: requests (named), proofs per child, deletion, unnamed, in that order', () => {
    const rows = [
      row(A, { unseenRequests: 2, unviewedProofs: 1 }),
      row(B, { unseenRequests: 1, deletionPending: true }),
      row(UNKNOWN, { unviewedProofs: 3 }),
    ];
    const banners = deriveHomeBanners({ accountType: 'guardian', rows, children });
    expect(banners).toEqual([
      { kind: 'requests', childIds: [A, B], names: 'Budi dan Anak 1' },
      { kind: 'proofs', childId: A, count: 1, name: 'Budi' },
      { kind: 'proofs', childId: UNKNOWN, count: 3, name: 'Anak' },
      { kind: 'deletion', childIds: [B], names: 'Anak 1', self: false },
      { kind: 'unnamed', count: 2 },
    ]);
    expect(banners.map(bannerKey)).toEqual(['requests', `proofs:${A}`, `proofs:${UNKNOWN}`, 'deletion', 'unnamed']);
  });

  it('guardian with nothing new and all children named: no banners', () => {
    const named = homeChildren([{ id: A, nickname: 'Budi' }]);
    expect(deriveHomeBanners({ accountType: 'guardian', rows: [row(A)], children: named })).toEqual([]);
  });

  it('legacy/unknown account type behaves like a guardian (local unnamed hint only)', () => {
    expect(deriveHomeBanners({ accountType: null, rows: [], children })).toEqual([{ kind: 'unnamed', count: 2 }]);
  });

  it('teen: no request, proof or unnamed banners; deletion speaks about the own profile', () => {
    const self = row(A, { isSelf: true, unseenRequests: 1, unviewedProofs: 2, deletionPending: true });
    expect(deriveHomeBanners({ accountType: 'teen', rows: [self], children })).toEqual([
      { kind: 'deletion', childIds: [A], names: 'Budi', self: true },
    ]);
  });

  it('child account: never any banner', () => {
    expect(deriveHomeBanners({ accountType: 'child', rows: [row(A, { unseenRequests: 1 })], children })).toEqual([]);
  });

  it('counts unviewed proofs of one child (teen badge)', () => {
    const rows = [row(A, { unviewedProofs: 4 }), row(B)];
    expect(unviewedProofsOf(rows, A)).toBe(4);
    expect(unviewedProofsOf(rows, B)).toBe(0);
    expect(unviewedProofsOf(rows, UNKNOWN)).toBe(0);
    expect(unviewedProofsOf(rows, null)).toBe(0);
  });
});

function streak(over: Partial<BrushingStreak> & { doneDates?: string[] } = {}): BrushingStreak {
  const dates = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
  const done = new Set(over.doneDates ?? []);
  const { doneDates: _ignored, ...rest } = over;
  return {
    current: 0,
    longest: 0,
    lastDay: null,
    todayDone: false,
    week: dates.map((date) => ({ date, done: done.has(date), brushings: done.has(date) ? 1 : 0 })),
    minDurationS: 60,
    tz: 'Asia/Jakarta',
    ...rest,
  };
}

describe('mergeStreaks', () => {
  it('uses the local streak when there is no server value', () => {
    const local = streak({ current: 2, todayDone: true });
    expect(mergeStreaks(null, local)).toBe(local);
  });

  it('keeps the server value when it already counts today or nothing was brushed locally today', () => {
    const server = streak({ current: 5, todayDone: true, doneDates: ['2026-10-18'] });
    expect(mergeStreaks(server, streak({ current: 1, todayDone: true }))).toBe(server);
    const serverNotYet = streak({ current: 3, lastDay: '2026-10-17' });
    expect(mergeStreaks(serverNotYet, streak())).toBe(serverNotYet);
  });

  it('adds today on top of the server run when today was brushed here but not synced yet', () => {
    const server = streak({ current: 3, longest: 3, lastDay: '2026-10-17', doneDates: ['2026-10-15', '2026-10-16', '2026-10-17'] });
    const local = streak({ current: 1, longest: 1, lastDay: '2026-10-18', todayDone: true, doneDates: ['2026-10-18'] });
    const merged = mergeStreaks(server, local);
    expect(merged.current).toBe(4);
    expect(merged.longest).toBe(4);
    expect(merged.todayDone).toBe(true);
    expect(merged.lastDay).toBe('2026-10-18');
    expect(merged.week.filter((d) => d.done).map((d) => d.date)).toEqual(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  });

  it('a broken server run restarts at 1 with today', () => {
    const merged = mergeStreaks(streak({ current: 0, longest: 6 }), streak({ current: 1, todayDone: true, lastDay: '2026-10-18', doneDates: ['2026-10-18'] }));
    expect(merged.current).toBe(1);
    expect(merged.longest).toBe(6);
  });
});

describe('weekDots', () => {
  it('maps dates to Monday-based weekdays and marks the last day as today', () => {
    const dots = weekDots(streak({ doneDates: ['2026-10-18'] }));
    // 2026-10-12 is a Monday, 2026-10-18 a Sunday.
    expect(dots.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(dots.filter((d) => d.isToday).map((d) => d.date)).toEqual(['2026-10-18']);
    expect(dots[6].done).toBe(true);
    expect(dots[0].done).toBe(false);
  });
});

function account(over: Partial<MyAccount> = {}): MyAccount {
  return {
    userId: A,
    accountType: 'child',
    roles: ['child'],
    selfChildId: null,
    childAccounts: null,
    childAccount: { childId: B, guardianId: C, username: 'si.budi', disabled: false, syncAllowed: true, proofAllowed: false },
    flags: { brushingProofVideo: true },
    capabilities: { createChildAccounts: false, registerProofs: false },
    limits: DEFAULT_LIMITS,
    ...over,
  };
}

function request(over: Partial<ScreeningRequest> = {}): ScreeningRequest {
  return {
    id: UNKNOWN,
    childId: B,
    reasonCode: 'toothache',
    painLevel: 4,
    status: 'pending',
    createdAt: '2026-10-18T01:00:00Z',
    seenAt: null,
    respondedAt: null,
    screeningId: null,
    expiresAt: '2026-11-01T01:00:00Z',
    ...over,
  };
}

describe('kid home logic', () => {
  it('reads the child account from my_account()', () => {
    expect(kidAccountView(account())).toEqual({ childId: B, username: 'si.budi', proofAllowed: false, syncAllowed: true });
    expect(kidAccountView(account({ accountType: 'guardian' }))).toBeNull();
    expect(kidAccountView(null)).toBeNull();
    const off = account({ childAccount: { childId: B, guardianId: C, username: 'x', disabled: true, syncAllowed: false, proofAllowed: false } });
    expect(kidAccountView(off)?.syncAllowed).toBe(false);
  });

  it('flags an open swelling request (red flag stays local)', () => {
    expect(isOpenRequest({ status: 'seen' })).toBe(true);
    expect(isOpenRequest({ status: 'done' })).toBe(false);
    expect(hasOpenSwelling([request({ reasonCode: 'swelling' })])).toBe(true);
    expect(hasOpenSwelling([request({ reasonCode: 'swelling', status: 'done' })])).toBe(false);
    expect(hasOpenSwelling([request()])).toBe(false);
  });

  it('a request row shows reason and status only', () => {
    const r = kidRequestRow(request({ status: 'done', screeningId: C }));
    expect(r.title).toBe(id.kid.requests.reasons.toothache);
    expect(r.subtitle.startsWith(id.kid.requests.statuses.done)).toBe(true);
    expect(r.label).toContain(id.kid.requests.reasons.toothache);
    expect(JSON.stringify(r)).not.toContain(C);
  });
});
