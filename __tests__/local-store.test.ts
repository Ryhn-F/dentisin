// Local data store (src/data/local-store.ts): scope per account, persistence through the A/B
// slot, retention, record shapes, consents, server merge and account alignment. Nothing here is
// signed in, so the sync bridge queues nothing (see sync-bridge.test.ts for that).
import { setStorageBackendForTests, type KeyValueBackend } from '@/core/auth/secure-storage';
import {
  GUEST_SCOPE,
  SYNCED_BRUSHING_RETENTION_DAYS,
  applyRetention,
  childDisplayName,
  parseStoredData,
  useLocalData,
} from '@/data/local-store';
import { abSlot } from '@/data/persist';
import { DEFAULT_LIMITS, type ChildProfile, type ChildSummary, type MyAccount } from '@/domain/models';

jest.mock('@/core/auth/supabase', () => ({
  supabase: { rpc: jest.fn(), auth: { refreshSession: jest.fn(), signOut: jest.fn(), getSession: jest.fn(), onAuthStateChange: jest.fn() } },
}));

const UID = '0b0b0b0b-0000-4000-8000-000000000001';
const UID2 = '0b0b0b0b-0000-4000-8000-000000000002';
const CHILD = 'c0c0c0c0-0000-4000-8000-000000000001';
const CHILD2 = 'c0c0c0c0-0000-4000-8000-000000000002';
const DAY = 24 * 60 * 60 * 1000;

let store: Map<string, string>;
function memoryBackend(): KeyValueBackend {
  store = new Map();
  return {
    getItem: async (k) => store.get(k) ?? null,
    setItem: async (k, v) => void store.set(k, v),
    removeItem: async (k) => void store.delete(k),
  };
}

const kid = (id = CHILD, over: Partial<ChildProfile> = {}): ChildProfile => ({
  id,
  nickname: 'Adik',
  birthYear: 2018,
  birthMonth: 3,
  allergies: [],
  ...over,
});

function account(over: Partial<MyAccount>): MyAccount {
  return {
    userId: UID,
    accountType: 'guardian',
    roles: ['guardian'],
    selfChildId: null,
    childAccounts: 0,
    childAccount: null,
    flags: { brushingProofVideo: false },
    capabilities: { createChildAccounts: true, registerProofs: false },
    limits: DEFAULT_LIMITS,
    ...over,
  };
}

const l = () => useLocalData.getState();

beforeEach(async () => {
  await l().setScope(null);
  setStorageBackendForTests(memoryBackend());
});

afterAll(async () => {
  await l().setScope(null);
  setStorageBackendForTests(null);
});

describe('scope', () => {
  it('starts empty: no seed children or brushing', async () => {
    await l().setScope(UID);
    expect(l()).toMatchObject({ scope: UID, ready: true, kids: [], brushing: [], screenings: [], activeChildId: null });
  });

  it('keeps users and guest mode apart on one phone', async () => {
    await l().setScope(UID);
    l().upsertChild(kid(CHILD, { nickname: 'Kakak' }));
    l().addBrushing(CHILD, { durationS: 120 });

    await l().setScope(UID2);
    expect(l().kids).toEqual([]);
    l().upsertChild(kid(CHILD2, { nickname: 'Budi' }));

    await l().setScope(GUEST_SCOPE);
    expect(l().kids).toEqual([]);

    await l().setScope(UID);
    expect(l().kids.map((k) => k.nickname)).toEqual(['Kakak']);
    expect(l().brushing).toHaveLength(1);

    await l().setScope(UID2);
    expect(l().kids.map((k) => k.nickname)).toEqual(['Budi']);
    expect(l().brushing).toHaveLength(0);
  });

  it('is not ready while a scope loads, and keeps changes made meanwhile', async () => {
    await l().setScope(UID);
    l().upsertChild(kid(CHILD));
    await l().setScope(null);

    const loading = l().setScope(UID);
    expect(l().ready).toBe(false);
    l().upsertChild(kid(CHILD2, { nickname: 'Baru' }));
    await loading;
    expect(l().ready).toBe(true);
    expect(l().kids.map((k) => k.id).sort()).toEqual([CHILD, CHILD2]);
  });

  it('signed out (scope null) is memory only and empty', async () => {
    await l().setScope(UID);
    l().upsertChild(kid());
    await l().setScope(null);
    expect(l()).toMatchObject({ scope: null, ready: true, kids: [] });
  });

  it('deleteScopeData removes the stored copy', async () => {
    await l().setScope(UID);
    l().upsertChild(kid());
    await l().flushWrites();
    await l().deleteScopeData(UID);
    expect(l().kids).toEqual([]);
    await l().setScope(null);
    await l().setScope(UID);
    expect(l().kids).toEqual([]);
  });
});

describe('persistence', () => {
  it('round-trips children, records, consents and the active child', async () => {
    await l().setScope(UID);
    l().upsertChild(kid(CHILD));
    l().upsertChild(kid(CHILD2, { nickname: 'Dua' }));
    l().setActiveChild(CHILD2);
    l().setConsent(CHILD, 'a', true);
    const brushing = l().addBrushing(CHILD, { durationS: 95, cameraMode: true, spiritScore: 80 });
    l().addScreening({
      id: 'scr-1',
      childId: CHILD,
      screenedAt: new Date().toISOString(),
      level: 'scheduled',
      redFlag: false,
      reasons: [{ id: 'CTX_PHOTO_NOT_ASSESSED', text: 't' }],
      adviceIds: [],
      referralTemplateId: 'r',
      rulesVersion: '0.2.0-draft',
      modelVersion: null,
      photoTaken: false,
      photoStatus: 'not_taken',
      findings: [],
      answers: {},
      pain: 0,
      ageMonths: 90,
      synced: false,
      requestId: null,
      referralId: null,
    });
    await l().setScope(null); // "restart": written out, memory cleared
    await l().setScope(UID);

    expect(l().kids.map((k) => k.id)).toEqual([CHILD, CHILD2]);
    expect(l().activeChildId).toBe(CHILD2);
    expect(l().consents[CHILD]).toEqual({ a: true, b: false, c: false, d: false });
    expect(l().brushing[0]).toEqual(brushing);
    expect(l().screenings[0]).toMatchObject({ id: 'scr-1', requestId: null, referralId: null });
    // Stored only under this user's keys.
    expect([...store.keys()].every((k) => k.startsWith(`dentisai.local.v1.${UID}.`))).toBe(true);
  });

  it('keeps the previous copy when a write is torn (A/B slot)', async () => {
    const slot = abSlot('test.slot');
    await slot.write('first');
    await slot.write('second');
    expect(await slot.read()).toBe('second');
    // Damage the current copy: the count key survives but a chunk is missing.
    store.delete('test.slot.b.0');
    expect(await slot.read()).toBe('first');
  });

  it('drops malformed stored records instead of failing', () => {
    const data = parseStoredData(
      JSON.stringify({ v: 1, kids: [{ id: 1 }, kid()], brushing: [{ id: 'x' }], consentRecords: { [CHILD]: { a: { value: 'yes' } } } }),
    );
    expect(data.kids).toEqual([kid()]);
    expect(data.brushing).toEqual([]);
    expect(data.consentRecords[CHILD]).toEqual({});
    expect(parseStoredData('not json').kids).toEqual([]);
  });
});

describe('retention', () => {
  it('keeps every unsynced record and trims synced brushing older than 120 days', () => {
    const now = Date.parse('2026-10-18T00:00:00Z');
    const old = new Date(now - (SYNCED_BRUSHING_RETENTION_DAYS + 1) * DAY).toISOString();
    const recent = new Date(now - 10 * DAY).toISOString();
    const base = { childId: CHILD, durationS: 120, spiritScore: null, slot: 'other' as const, cameraMode: false, proofId: null };
    const data = applyRetention(
      {
        ...parseStoredData('{"v":1}'),
        brushing: [
          { ...base, id: 'old-synced', startedAt: old, synced: true },
          { ...base, id: 'old-unsynced', startedAt: old, synced: false },
          { ...base, id: 'recent-synced', startedAt: recent, synced: true },
        ],
      },
      now,
    );
    expect(data.brushing.map((r) => r.id)).toEqual(['old-unsynced', 'recent-synced']);
  });
});

describe('records', () => {
  beforeEach(async () => {
    await l().setScope(UID);
  });

  it('addBrushing returns the new record with integer duration and defaults', () => {
    const before = Date.now();
    const r = l().addBrushing(CHILD, { durationS: 119.6 });
    expect(r).toMatchObject({ childId: CHILD, durationS: 120, spiritScore: null, cameraMode: false, synced: false, proofId: null });
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    // Started when the session began (now - duration).
    expect(Date.parse(r.startedAt)).toBeLessThanOrEqual(before - 119_000);
    expect(['morning', 'evening', 'other']).toContain(r.slot);
    expect(l().brushing[0]).toBe(r);

    const withProof = l().addBrushing(CHILD, { durationS: 60, startedAt: '2026-10-18T00:00:00.000Z', slot: 'morning', cameraMode: true, proofId: 'p1' });
    expect(withProof).toMatchObject({ startedAt: '2026-10-18T00:00:00.000Z', slot: 'morning', cameraMode: true, proofId: 'p1' });
  });

  it('attachProof links one proof per session', () => {
    const r = l().addBrushing(CHILD, { durationS: 60 });
    l().attachProof(r.id, 'p1');
    l().attachProof(r.id, 'p2');
    expect(l().brushing.find((b) => b.id === r.id)?.proofId).toBe('p1');
  });

  it('consents start off for a new child and keep value, text version and time', () => {
    l().upsertChild(kid());
    expect(l().consents[CHILD]).toEqual({ a: false, b: false, c: false, d: false });
    l().setConsent(CHILD, 'b', true, { at: '2026-10-18T01:00:00.000Z' });
    expect(l().consentRecords[CHILD].b).toEqual({
      value: true,
      textVersion: 'consent-b-v0.2-draft-id',
      at: '2026-10-18T01:00:00.000Z',
      synced: false,
    });
    l().setConsent(CHILD, 'b', false);
    expect(l().consentRecords[CHILD].b).toMatchObject({ value: false, textVersion: 'consent-b-v0.2-draft-id', synced: false });
    expect(l().consents[CHILD].b).toBe(false);
  });

  it('a teen self profile uses the teen consent texts', () => {
    l().ensureSelfProfile({ childId: CHILD, birthYear: 2010, birthMonth: 5 });
    expect(l().kids[0]).toMatchObject({ id: CHILD, isSelf: true, nickname: '' });
    expect(l().activeChildId).toBe(CHILD);
    l().setConsent(CHILD, 'd', true);
    expect(l().consentRecords[CHILD].d?.textVersion).toBe('consent-d-teen-v0.2-draft-id');
  });

  it('marks children unsynced only when server fields change', () => {
    l().upsertChild(kid());
    l().markChildSynced(CHILD);
    l().setNickname(CHILD, 'Nama baru');
    l().upsertChild({ ...l().kids[0], nickname: 'Lagi' });
    expect(l().unsyncedChildren).toEqual([]);
    l().upsertChild({ ...l().kids[0], allergies: ['sls'] });
    expect(l().unsyncedChildren).toEqual([CHILD]);
  });

  it('addReferral makes one referral per screening from its reasons', () => {
    l().addScreening({
      id: 'scr-2',
      childId: CHILD,
      screenedAt: new Date().toISOString(),
      level: 'urgent',
      redFlag: false,
      reasons: [{ id: 'DET_CARIES_PRIMARY', text: 't' }],
      adviceIds: [],
      referralTemplateId: 'r',
      rulesVersion: '0.2.0-draft',
      modelVersion: null,
      photoTaken: true,
      photoStatus: 'assessed',
      findings: [],
      answers: {},
      pain: 3,
      ageMonths: 90,
      synced: false,
      requestId: null,
      referralId: null,
    });
    const ref = l().addReferral({ screeningId: 'scr-2', facilityCode: 'PKM-3201-01' });
    expect(ref).toMatchObject({ childId: CHILD, screeningId: 'scr-2', level: 'urgent', reasonCodes: ['DET_CARIES_PRIMARY'], synced: false });
    expect(l().screenings[0].referralId).toBe(ref?.id);
    expect(l().addReferral({ screeningId: 'scr-2' })?.id).toBe(ref?.id);
    expect(l().addReferral({ screeningId: 'missing' })).toBeNull();
  });
});

describe('server children and account alignment', () => {
  beforeEach(async () => {
    await l().setScope(UID);
  });

  const row = (over: Partial<ChildSummary>): ChildSummary => ({
    childId: CHILD2,
    isSelf: false,
    birthYear: 2016,
    birthMonth: null,
    consents: ['a', 'b'],
    hasChildAccount: true,
    childAccountDisabled: false,
    username: 'si.budi',
    lastScreeningAt: null,
    lastScreeningLevel: null,
    lastBrushingAt: null,
    openRequests: 0,
    unseenRequests: 0,
    unviewedProofs: 0,
    deletionPending: false,
    ...over,
  });

  it('adds unknown server children with an empty nickname and their server consents', () => {
    l().upsertChild(kid(CHILD, { nickname: 'Lokal' }));
    l().mergeServerChildren([row({}), row({ childId: CHILD, birthYear: 2000 })]);
    expect(l().kids).toHaveLength(2);
    expect(l().kids[0]).toMatchObject({ id: CHILD, nickname: 'Lokal', birthYear: 2018 }); // local wins
    expect(l().kids[1]).toMatchObject({ id: CHILD2, nickname: '', birthYear: 2016 });
    expect(childDisplayName(l().kids[1])).toBeNull();
    expect(childDisplayName(l().kids[0])).toBe('Lokal');
    expect(l().consents[CHILD2]).toEqual({ a: true, b: true, c: false, d: false });
    expect(l().consentRecords[CHILD2].b?.synced).toBe(true);
    // Never deletes local children.
    l().mergeServerChildren([]);
    expect(l().kids).toHaveLength(2);
  });

  it('blocks sync for a child with a pending deletion', () => {
    l().mergeServerChildren([row({ deletionPending: true })]);
    expect(l().syncBlocked[CHILD2]).toBe('deletion_pending');
  });

  it('a child account has exactly one child: itself, named by its username', () => {
    l().upsertChild(kid(CHILD2));
    l().applyAccount(
      account({
        accountType: 'child',
        roles: ['child'],
        childAccount: { childId: CHILD, guardianId: UID2, username: 'si.adik', disabled: false, syncAllowed: true, proofAllowed: true },
      }),
    );
    expect(l().kids).toEqual([{ id: CHILD, nickname: 'si.adik', birthYear: null, birthMonth: null, allergies: [] }]);
    expect(l().activeChildId).toBe(CHILD);
  });

  it('a teen account gets its self profile', () => {
    l().applyAccount(account({ accountType: 'teen', selfChildId: CHILD, capabilities: { createChildAccounts: false, registerProofs: true } }));
    expect(l().kids).toEqual([{ id: CHILD, nickname: '', birthYear: null, birthMonth: null, allergies: [], isSelf: true }]);
    expect(l().activeChildId).toBe(CHILD);
  });

  it('a known self profile (new phone / reinstall) adopts the server consents it has no record of', () => {
    const teen = account({ accountType: 'teen', selfChildId: CHILD, capabilities: { createChildAccounts: false, registerProofs: true } });
    l().applyAccount(teen);
    expect(l().consents[CHILD]).toEqual({ a: false, b: false, c: false, d: false });
    l().mergeServerChildren([row({ childId: CHILD, isSelf: true, consents: ['a', 'b', 'd'] })]);
    expect(l().consents[CHILD]).toEqual({ a: true, b: true, c: false, d: true });
    expect(l().consentRecords[CHILD].b).toMatchObject({ value: true, synced: true, textVersion: null });
    expect(l().consentRecords[CHILD].d?.synced).toBe(true);
  });

  it('a local consent record (even an unsynced withdrawal) wins over the server list', () => {
    l().upsertChild(kid(CHILD));
    l().setConsent(CHILD, 'b', true);
    l().setConsent(CHILD, 'b', false);
    l().mergeServerChildren([row({ childId: CHILD, consents: ['a', 'b'] })]);
    expect(l().consentRecords[CHILD].b).toMatchObject({ value: false, synced: false });
    expect(l().consentRecords[CHILD].a).toMatchObject({ value: true, synced: true });
  });

  it('applyAccount and mergeServerChildren wait while the scope loads (stored data is never replaced)', async () => {
    l().upsertChild(kid(CHILD, { nickname: 'Diri', birthYear: 2010, birthMonth: 4, allergies: ['sls'], isSelf: true }));
    l().upsertChild(kid(CHILD2, { nickname: 'Adik' }));
    l().setConsent(CHILD2, 'b', true);
    l().setConsent(CHILD2, 'b', false);
    await l().setScope(null);

    const loading = l().setScope(UID);
    expect(l().ready).toBe(false);
    // Network answers that beat the chunked storage read.
    l().applyAccount(account({ accountType: 'teen', selfChildId: CHILD, capabilities: { createChildAccounts: false, registerProofs: true } }));
    l().mergeServerChildren([row({ childId: CHILD2, consents: ['a', 'b'] })]);
    expect(l().kids).toEqual([]);
    await loading;

    expect(l().kids.find((k) => k.id === CHILD)).toMatchObject({ nickname: 'Diri', birthYear: 2010, birthMonth: 4, allergies: ['sls'] });
    expect(l().kids.find((k) => k.id === CHILD2)).toMatchObject({ nickname: 'Adik' });
    expect(l().consentRecords[CHILD2].b).toMatchObject({ value: false, synced: false });
    // Once ready, both run normally.
    l().mergeServerChildren([row({ childId: CHILD2, consents: ['a', 'b'] })]);
    expect(l().consentRecords[CHILD2].a?.synced).toBe(true);
    expect(l().kids.find((k) => k.id === CHILD2)?.nickname).toBe('Adik');
  });

  it('ignores an account of another user', () => {
    l().applyAccount(account({ userId: UID2, accountType: 'teen', selfChildId: CHILD }));
    expect(l().kids).toEqual([]);
  });
});
