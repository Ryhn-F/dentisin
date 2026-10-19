// Sync bridge (src/core/sync/bridge.ts) + local store + outbox singleton: what is queued for
// whom (guest, guardian, teen, child account, legacy backend), consent (b) gating and backfill,
// dependencies, purge on withdrawal, results marking records synced, and the sync engine scopes.
import { useAccount } from '@/core/account/account-store';
import { setStorageBackendForTests, type KeyValueBackend } from '@/core/auth/secure-storage';
import { useSession } from '@/core/auth/session-store';
import {
  CHILD_RETRY_AFTER_MS,
  installSyncBridge,
  recordBrushingProof,
  recordConsent,
  recordScreeningRequest,
  reconcile,
  syncContext,
  syncRefs,
} from '@/core/sync/bridge';
import { scopesFor, startSyncEngine } from '@/core/sync/engine';
import { outbox } from '@/core/sync/outbox';
import { GUEST_SCOPE, useLocalData } from '@/data/local-store';
import { DEFAULT_LIMITS, type ChildProfile, type MyAccount, type ScreeningRecord } from '@/domain/models';

jest.mock('@/core/auth/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { refreshSession: jest.fn(), signOut: jest.fn(), getSession: jest.fn(), onAuthStateChange: jest.fn() },
  },
}));

type WireEvent = { event_id: string; type: string; payload: Record<string, unknown> };
const rpc = (jest.requireMock('@/core/auth/supabase') as { supabase: { rpc: jest.Mock } }).supabase.rpc;

const GUARDIAN = '0b0b0b0b-0000-4000-8000-000000000001';
const TEEN = '0b0b0b0b-0000-4000-8000-000000000002';
const KID_USER = '0b0b0b0b-0000-4000-8000-000000000003';
const CHILD = 'c0c0c0c0-0000-4000-8000-000000000001';
const CHILD2 = 'c0c0c0c0-0000-4000-8000-000000000002';
const SELF = 'c0c0c0c0-0000-4000-8000-0000000000ff';
const SCREENING = '55555555-5555-4555-8555-555555555501';
const PROOF = '99999999-9999-4999-8999-999999999901';

function memoryBackend(): KeyValueBackend {
  const store = new Map<string, string>();
  return {
    getItem: async (k) => store.get(k) ?? null,
    setItem: async (k, v) => void store.set(k, v),
    removeItem: async (k) => void store.delete(k),
  };
}

function account(over: Partial<MyAccount>): MyAccount {
  return {
    userId: GUARDIAN,
    accountType: 'guardian',
    roles: ['guardian'],
    selfChildId: null,
    childAccounts: 0,
    childAccount: null,
    flags: { brushingProofVideo: true },
    capabilities: { createChildAccounts: true, registerProofs: false },
    limits: DEFAULT_LIMITS,
    ...over,
  };
}

const guardian = account({});
const legacy = account({ capabilities: { createChildAccounts: false, registerProofs: false }, flags: { brushingProofVideo: false }, legacy: true });
const teen = account({ userId: TEEN, accountType: 'teen', selfChildId: SELF, capabilities: { createChildAccounts: false, registerProofs: true } });
const kidAccount = (over: Partial<NonNullable<MyAccount['childAccount']>> = {}) =>
  account({
    userId: KID_USER,
    accountType: 'child',
    roles: ['child'],
    childAccounts: null,
    capabilities: { createChildAccounts: false, registerProofs: true },
    childAccount: { childId: CHILD, guardianId: GUARDIAN, username: 'si.adik', disabled: false, syncAllowed: true, proofAllowed: true, ...over },
  });

const kid = (id = CHILD): ChildProfile => ({ id, nickname: 'Adik', birthYear: 2018, birthMonth: 3, allergies: ['sls'] });

function screening(over: Partial<ScreeningRecord> = {}): ScreeningRecord {
  return {
    id: SCREENING,
    childId: CHILD,
    screenedAt: new Date().toISOString(),
    level: 'urgent',
    redFlag: false,
    reasons: [{ id: 'DET_CARIES_PRIMARY', text: 't' }],
    adviceIds: [],
    referralTemplateId: 'r',
    rulesVersion: '0.2.0-draft',
    modelVersion: null,
    photoTaken: false,
    photoStatus: 'not_taken',
    findings: [],
    answers: {},
    pain: 3,
    ageMonths: 90,
    synced: false,
    requestId: null,
    referralId: null,
    ...over,
  };
}

async function signIn(me: MyAccount) {
  useSession.setState({ status: 'signedIn', userId: me.userId, email: null });
  useAccount.setState({ userId: me.userId, me, status: 'ready', lastError: null });
  await Promise.all([useLocalData.getState().setScope(me.userId), outbox.setScope(me.userId)]);
  useLocalData.getState().applyAccount(me);
}

const l = () => useLocalData.getState();
const queued = (ref: string) => outbox.findByRef(ref);
const payloadOf = (ref: string) => JSON.parse(queued(ref)[0].payloadJson) as Record<string, unknown>;
const allTypes = () => [...outbox.refs()].sort();

function serverApplies(decide: (e: WireEvent) => { status: string; code?: string } = () => ({ status: 'applied' })) {
  rpc.mockImplementation(async (_fn: string, args: { batch: WireEvent[] }) => ({
    data: args.batch.map((e, i) => ({ index: i, event_id: e.event_id, ...decide(e) })),
    error: null,
    status: 200,
  }));
}

let uninstall: () => void = () => {};

beforeEach(async () => {
  // Fake timers keep the outbox's debounced auto-flush from firing; tests flush explicitly.
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
  await Promise.all([l().setScope(null), outbox.setScope(null)]);
  setStorageBackendForTests(memoryBackend());
  useSession.setState({ status: 'signedOut', userId: null, email: null });
  useAccount.setState({ userId: null, me: null, status: 'idle', lastError: null });
  rpc.mockReset();
  uninstall = installSyncBridge();
});

afterEach(() => {
  uninstall();
  jest.useRealTimers();
});

afterAll(async () => {
  await Promise.all([l().setScope(null), outbox.setScope(null)]);
  setStorageBackendForTests(null);
});

describe('no sync without an account', () => {
  it('guest mode queues nothing and keeps records local', async () => {
    useSession.setState({ status: 'guest', userId: null });
    await Promise.all([l().setScope(GUEST_SCOPE), outbox.setScope(null)]);
    l().upsertChild(kid());
    l().setConsent(CHILD, 'b', true);
    const r = l().addBrushing(CHILD, { durationS: 120 });
    expect(syncContext()).toBeNull();
    expect(outbox.pendingCount()).toBe(0);
    expect(l().brushing.find((b) => b.id === r.id)?.synced).toBe(false);
  });

  it('signed in but my_account() not loaded yet: nothing is queued until reconcile', async () => {
    await signIn(guardian);
    useAccount.setState({ me: null });
    l().upsertChild(kid());
    l().setConsent(CHILD, 'b', true);
    expect(outbox.pendingCount()).toBe(0);

    useAccount.setState({ me: guardian });
    expect(reconcile()).toBeGreaterThanOrEqual(2);
    expect(queued(syncRefs.consent(CHILD, 'b', 'grant'))).toHaveLength(1);
    expect(queued(syncRefs.child(CHILD))).toHaveLength(1);
  });
});

describe('guardian', () => {
  beforeEach(async () => {
    await signIn(guardian);
    l().upsertChild(kid());
  });

  it('sends nothing for a child without consent (b); other grants wait for (b)', () => {
    l().setConsent(CHILD, 'a', true);
    l().addBrushing(CHILD, { durationS: 120 });
    l().addScreening(screening());
    expect(outbox.pendingCount()).toBe(0);
  });

  it('a (b) grant creates the profile first and backfills consents, profile and records behind it', () => {
    l().setConsent(CHILD, 'a', true);
    const early = l().addBrushing(CHILD, { durationS: 120 });
    l().addScreening(screening());
    l().setConsent(CHILD, 'b', true);

    const grant = queued(syncRefs.consent(CHILD, 'b', 'grant'));
    expect(grant).toHaveLength(1);
    expect(JSON.parse(grant[0].payloadJson)).toMatchObject({ consent_type: 'b', action: 'grant', text_version: 'consent-b-v0.2-draft-id', method: 'in_app' });
    const grantId = grant[0].eventId;
    for (const ref of [syncRefs.consent(CHILD, 'a', 'grant'), syncRefs.child(CHILD), syncRefs.brushing(early.id), syncRefs.screening(SCREENING)]) {
      expect(queued(ref)).toHaveLength(1);
      expect(queued(ref)[0].dependsOn).toEqual([grantId]);
    }
    expect(payloadOf(syncRefs.child(CHILD))).toEqual({ child_id: CHILD, birth_year: 2018, birth_month: 3, allergies: ['sls'] });
    // The (b) grant is first in the queue (FIFO).
    expect(outbox.needsAttention()).toEqual([]);
  });

  it('new data after (b) is queued right away; a referral depends on its screening', () => {
    l().setConsent(CHILD, 'b', true);
    l().addScreening(screening());
    const referral = l().addReferral({ screeningId: SCREENING, facilityCode: 'PKM-3201-01' })!;
    const screeningEvent = queued(syncRefs.screening(SCREENING))[0];
    const referralEvent = queued(syncRefs.referral(referral.id))[0];
    expect(referralEvent.dependsOn).toEqual(expect.arrayContaining([screeningEvent.eventId]));
    expect(JSON.parse(referralEvent.payloadJson)).toMatchObject({ screening_id: SCREENING, level: 'orange', reason_codes: ['det_caries_primary'] });
    expect(JSON.parse(screeningEvent.payloadJson)).toMatchObject({ model_version: '0.0.0-none', level: 'orange' });
  });

  it('marks records and consents synced when their events are applied', async () => {
    l().setConsent(CHILD, 'b', true);
    const r = l().addBrushing(CHILD, { durationS: 120 });
    serverApplies();
    await outbox.flush();
    expect(outbox.pendingCount()).toBe(0);
    expect(l().brushing.find((b) => b.id === r.id)?.synced).toBe(true);
    expect(l().consentRecords[CHILD].b?.synced).toBe(true);
    expect(l().unsyncedChildren).toEqual([]);
    // Nothing left to reconcile.
    expect(reconcile()).toBe(0);
  });

  it('entity_conflict means "already on the server": synced and discarded', async () => {
    l().setConsent(CHILD, 'b', true);
    const r = l().addBrushing(CHILD, { durationS: 120 });
    serverApplies((e) => (e.type === 'brushing_recorded' ? { status: 'rejected', code: 'entity_conflict' } : { status: 'applied' }));
    await outbox.flush();
    expect(l().brushing.find((b) => b.id === r.id)?.synced).toBe(true);
    expect(outbox.needsAttention()).toEqual([]);
  });

  it('a (b) withdrawal is always sent and purges the child\'s queued data events', () => {
    l().setConsent(CHILD, 'b', true);
    l().addBrushing(CHILD, { durationS: 120 });
    l().setConsent(CHILD, 'b', false);
    expect(queued(syncRefs.consent(CHILD, 'b', 'withdraw'))).toHaveLength(1);
    expect(queued(syncRefs.consent(CHILD, 'b', 'grant'))).toHaveLength(1); // consent events stay
    expect(allTypes().filter((r) => r.startsWith('brushing:') || r.startsWith('child:'))).toEqual([]);
    // New data is not queued while (b) is off; it is backfilled on the next grant.
    const later = l().addBrushing(CHILD, { durationS: 90 });
    expect(queued(syncRefs.brushing(later.id))).toEqual([]);
    l().setConsent(CHILD, 'b', true);
    expect(queued(syncRefs.brushing(later.id))).toHaveLength(1);
  });

  it('withdrawals of other consents go out even while (b) is off', () => {
    l().setConsent(CHILD, 'd', true); // waits for (b)
    expect(queued(syncRefs.consent(CHILD, 'd', 'grant'))).toEqual([]);
    l().setConsent(CHILD, 'd', false);
    expect(queued(syncRefs.consent(CHILD, 'd', 'withdraw'))).toHaveLength(1);
  });

  it('never sends proofs or screening requests', () => {
    l().setConsent(CHILD, 'b', true);
    l().setConsent(CHILD, 'd', true);
    const r = l().addBrushing(CHILD, { durationS: 120 });
    expect(recordBrushingProof({ proofId: PROOF, childId: CHILD, brushingRecordId: r.id, sizeBytes: 1000, durationS: 60, mime: 'video/mp4' })).toBeNull();
    expect(recordScreeningRequest({ childId: CHILD, reasonCode: 'toothache', painLevel: 5 })).toBeNull();
  });

  it('includes request_id when a screening answers a request', () => {
    l().setConsent(CHILD, 'b', true);
    l().addScreening(screening({ requestId: PROOF }));
    expect(payloadOf(syncRefs.screening(SCREENING)).request_id).toBe(PROOF);
  });

  it('deletion_pending stops sync for that child', async () => {
    l().setConsent(CHILD, 'b', true);
    serverApplies((e) => (e.type === 'child_upserted' ? { status: 'rejected', code: 'deletion_pending' } : { status: 'applied' }));
    await outbox.flush();
    expect(l().syncBlocked[CHILD]).toBe('deletion_pending');
    l().addBrushing(CHILD, { durationS: 120 });
    expect(allTypes().filter((r) => r.startsWith('brushing:'))).toEqual([]);
  });

  it('a new (b) grant gives refused and held data events a fresh start (new event ids)', async () => {
    l().setConsent(CHILD, 'b', true);
    serverApplies((e) =>
      e.type === 'consent_changed' ? { status: 'rejected', code: 'schema_invalid' } : { status: 'rejected', code: 'consent_required' },
    );
    await outbox.flush();
    const refused = queued(syncRefs.child(CHILD))[0];
    expect(refused).toMatchObject({ state: 'rejected', code: 'consent_required' });
    // Data recorded while the (b) grant stands rejected starts held behind it.
    const r = l().addBrushing(CHILD, { durationS: 120 });
    expect(queued(syncRefs.brushing(r.id))[0]).toMatchObject({ state: 'held', code: 'dependency_rejected' });

    l().setConsent(CHILD, 'b', false);
    l().setConsent(CHILD, 'b', true);
    const child = queued(syncRefs.child(CHILD));
    expect(child).toHaveLength(1);
    expect(child[0].eventId).not.toBe(refused.eventId);
    expect(child[0].state).toBe('pending');
    expect(queued(syncRefs.brushing(r.id))).toEqual([expect.objectContaining({ state: 'pending' })]);
  });
});

describe('dismissed rejections (given up)', () => {
  beforeEach(async () => {
    await signIn(guardian);
    l().upsertChild(kid());
    l().setConsent(CHILD, 'b', true);
  });

  it('are not queued again by reconcile (no loop on every account refresh)', async () => {
    const r = l().addBrushing(CHILD, { durationS: 120 });
    serverApplies((e) => (e.type === 'brushing_recorded' ? { status: 'rejected', code: 'schema_invalid' } : { status: 'applied' }));
    await outbox.flush();
    const refused = queued(syncRefs.brushing(r.id))[0];
    expect(refused).toMatchObject({ state: 'rejected', code: 'schema_invalid' });

    expect(outbox.dismiss(refused.eventId, { giveUp: true })).toBe(true);
    useAccount.setState({ me: { ...guardian } }); // a foreground refresh sets a new object
    expect(reconcile()).toBe(0);
    expect(reconcile()).toBe(0);
    expect(queued(syncRefs.brushing(r.id))).toEqual([]);
    expect(outbox.needsAttention()).toEqual([]);
    // Still given up after the queue is reloaded.
    await outbox.setScope(null);
    await outbox.setScope(GUARDIAN);
    expect(reconcile()).toBe(0);
    expect(l().brushing.find((b) => b.id === r.id)?.synced).toBe(false);
  });

  it('get a fresh chance when the record changes or a new (b) grant fixes the cause', async () => {
    l().addBrushing(CHILD, { durationS: 120 });
    serverApplies((e) =>
      e.type === 'child_upserted' || e.type === 'brushing_recorded' ? { status: 'rejected', code: 'consent_required' } : { status: 'applied' },
    );
    await outbox.flush();
    const refusedChild = queued(syncRefs.child(CHILD))[0];
    const brushingRef = [...outbox.refs()].find((ref) => ref.startsWith('brushing:'))!;
    const refusedBrushing = queued(brushingRef)[0];
    outbox.dismiss(refusedChild.eventId, { giveUp: true });
    outbox.dismiss(refusedBrushing.eventId, { giveUp: true });
    expect(reconcile()).toBe(0);

    // A real edit of the profile is a new change: queued again with a new event id.
    l().upsertChild({ ...kid(), allergies: [] });
    const child = queued(syncRefs.child(CHILD));
    expect(child).toEqual([expect.objectContaining({ state: 'pending' })]);
    expect(child[0].eventId).not.toBe(refusedChild.eventId);
    expect(queued(brushingRef)).toEqual([]);

    // A new (b) grant fixes consent_required.
    l().setConsent(CHILD, 'b', false);
    l().setConsent(CHILD, 'b', true);
    const brushing = queued(brushingRef);
    expect(brushing).toHaveLength(1);
    expect(brushing[0].eventId).not.toBe(refusedBrushing.eventId);
  });
});

describe('legacy backend (pre-ADR 017)', () => {
  it('sends no consent (d) and no request_id', async () => {
    await signIn(legacy);
    l().upsertChild(kid());
    l().setConsent(CHILD, 'b', true);
    l().setConsent(CHILD, 'd', true);
    expect(queued(syncRefs.consent(CHILD, 'd', 'grant'))).toEqual([]);
    l().addScreening(screening({ requestId: PROOF }));
    expect(payloadOf(syncRefs.screening(SCREENING))).not.toHaveProperty('request_id');
  });
});

describe('teen', () => {
  beforeEach(async () => {
    await signIn(teen);
  });

  it('syncs only the self profile, with the teen consent texts', () => {
    expect(l().kids[0]).toMatchObject({ id: SELF, isSelf: true });
    l().setConsent(SELF, 'b', true);
    expect(payloadOf(syncRefs.consent(SELF, 'b', 'grant')).text_version).toBe('consent-b-teen-v0.1-draft-id');
    l().upsertChild(kid(CHILD2));
    l().setConsent(CHILD2, 'b', true);
    expect(queued(syncRefs.consent(CHILD2, 'b', 'grant'))).toEqual([]);
    expect(recordConsent(CHILD2, 'b', 'grant', 'x')).toBeNull();
  });

  it('registers a proof only with (b) + (d), after the brushing event', () => {
    l().setConsent(SELF, 'b', true);
    const r = l().addBrushing(SELF, { durationS: 120, cameraMode: true });
    const input = { proofId: PROOF, childId: SELF, brushingRecordId: r.id, sizeBytes: 3_000_000, durationS: 120, mime: 'video/mp4' as const };
    expect(recordBrushingProof(input)).toBeNull(); // no (d) yet

    l().setConsent(SELF, 'd', true);
    const id = recordBrushingProof(input);
    expect(id).not.toBeNull();
    const proof = queued(syncRefs.proof(PROOF))[0];
    const brushingEvent = queued(syncRefs.brushing(r.id))[0];
    const dGrant = queued(syncRefs.consent(SELF, 'd', 'grant'))[0];
    expect(proof.dependsOn).toEqual(expect.arrayContaining([brushingEvent.eventId, dGrant.eventId]));
    expect(JSON.parse(proof.payloadJson)).toEqual({
      proof_id: PROOF,
      child_id: SELF,
      brushing_event_id: r.id,
      size_bytes: 3_000_000,
      duration_s: 120,
      mime: 'video/mp4',
    });
    expect(l().brushing.find((b) => b.id === r.id)?.proofId).toBe(PROOF);
    // Same proof again: the queued event, not a second one.
    expect(recordBrushingProof(input)).toBe(id);
    expect(recordScreeningRequest({ childId: SELF, reasonCode: 'toothache', painLevel: 5 })).toBeNull();
  });

  it('refuses a clip over the server limits', () => {
    l().setConsent(SELF, 'b', true);
    l().setConsent(SELF, 'd', true);
    const r = l().addBrushing(SELF, { durationS: 120 });
    expect(
      recordBrushingProof({ proofId: PROOF, childId: SELF, brushingRecordId: r.id, sizeBytes: DEFAULT_LIMITS.proofMaxBytes + 1, durationS: 60, mime: 'video/mp4' }),
    ).toBeNull();
  });
});

describe('child account', () => {
  it('sends brushing, requests and proofs for its own child only, without consents', async () => {
    await signIn(kidAccount());
    expect(l().kids).toEqual([expect.objectContaining({ id: CHILD, nickname: 'si.adik' })]);
    const r = l().addBrushing(CHILD, { durationS: 120 });
    const brushingEvent = queued(syncRefs.brushing(r.id))[0];
    expect(brushingEvent.dependsOn).toBeUndefined();

    const request = recordScreeningRequest({ childId: CHILD, reasonCode: 'swelling', painLevel: 8 });
    expect(request).not.toBeNull();
    expect(outbox.getEntry(request!)?.type).toBe('screening_requested');
    expect(recordScreeningRequest({ childId: CHILD2, reasonCode: 'toothache', painLevel: null })).toBeNull();

    const proof = recordBrushingProof({ proofId: PROOF, childId: CHILD, brushingRecordId: r.id, sizeBytes: 1000, durationS: 30, mime: 'video/quicktime' });
    expect(outbox.getEntry(proof!)?.dependsOn).toEqual([brushingEvent.eventId]);

    // No consents, no profile, no screenings from a child account.
    l().setConsent(CHILD, 'b', true);
    l().addScreening(screening());
    expect(queued(syncRefs.consent(CHILD, 'b', 'grant'))).toEqual([]);
    expect(queued(syncRefs.screening(SCREENING))).toEqual([]);
  });

  it('queues nothing while sync is not allowed, then reconciles when it is', async () => {
    await signIn(kidAccount({ syncAllowed: false, proofAllowed: false }));
    const r = l().addBrushing(CHILD, { durationS: 120 });
    expect(outbox.pendingCount()).toBe(0);
    expect(recordScreeningRequest({ childId: CHILD, reasonCode: 'toothache', painLevel: 2 })).toBeNull();

    useAccount.setState({ me: kidAccount() });
    expect(reconcile()).toBe(1);
    expect(queued(syncRefs.brushing(r.id))).toHaveLength(1);
  });

  it('a consent_required rejection is sent again (new event id) as soon as a later event is applied', async () => {
    await signIn(kidAccount());
    expect(reconcile()).toBe(0); // remembers the account flags
    const r1 = l().addBrushing(CHILD, { durationS: 120 });
    serverApplies(() => ({ status: 'rejected', code: 'consent_required' })); // parent withdrew (b)
    await outbox.flush();
    const refused = queued(syncRefs.brushing(r1.id))[0];
    expect(refused).toMatchObject({ state: 'rejected', code: 'consent_required' });
    // A new account object (foreground refresh) right away does not resend it yet.
    useAccount.setState({ me: kidAccount() });
    expect(reconcile()).toBe(0);
    expect(queued(syncRefs.brushing(r1.id))[0].eventId).toBe(refused.eventId);

    // The parent granted (b) again: the next brushing is applied, and r1 follows in the same flush.
    serverApplies();
    const r2 = l().addBrushing(CHILD, { durationS: 120 });
    await outbox.flush();
    expect(l().brushing.find((b) => b.id === r2.id)?.synced).toBe(true);
    expect(l().brushing.find((b) => b.id === r1.id)?.synced).toBe(true);
    expect(outbox.needsAttention()).toEqual([]);
    const sentIds = rpc.mock.calls.flatMap((c) => (c[1] as { batch: WireEvent[] }).batch.map((e) => e.event_id));
    expect(sentIds.filter((id) => id === refused.eventId)).toHaveLength(1);
    expect(sentIds).toHaveLength(3);
  });

  it('forbidden / consent_required are retried when the parent re-enables the account, or after a while', async () => {
    await signIn(kidAccount());
    expect(reconcile()).toBe(0); // remembers the account flags
    const r = l().addBrushing(CHILD, { durationS: 120 });
    serverApplies(() => ({ status: 'rejected', code: 'forbidden' }));
    await outbox.flush();
    const first = queued(syncRefs.brushing(r.id))[0];
    expect(first.state).toBe('rejected');

    useAccount.setState({ me: kidAccount({ disabled: true, syncAllowed: false, proofAllowed: false }) });
    expect(reconcile()).toBe(0);
    expect(queued(syncRefs.brushing(r.id))[0].eventId).toBe(first.eventId);

    useAccount.setState({ me: kidAccount() });
    expect(reconcile()).toBe(1);
    const second = queued(syncRefs.brushing(r.id));
    expect(second).toEqual([expect.objectContaining({ state: 'pending' })]);
    expect(second[0].eventId).not.toBe(first.eventId);

    // Consent still withdrawn: rejected again, then retried only after CHILD_RETRY_AFTER_MS.
    serverApplies(() => ({ status: 'rejected', code: 'consent_required' }));
    await outbox.flush();
    useAccount.setState({ me: kidAccount() });
    expect(reconcile()).toBe(0);
    // (+1 min: the outbox stamps createdAt with the real clock, captured before fake timers.)
    jest.setSystemTime(Date.now() + CHILD_RETRY_AFTER_MS + 60_000);
    useAccount.setState({ me: kidAccount() });
    expect(reconcile()).toBe(1);
    const third = queued(syncRefs.brushing(r.id));
    expect(third).toEqual([expect.objectContaining({ state: 'pending' })]);
    expect(third[0].eventId).not.toBe(second[0].eventId);
  });

  it('needs proof_allowed (capabilities.registerProofs) for proofs', async () => {
    const me = kidAccount({ proofAllowed: false });
    await signIn({ ...me, capabilities: { createChildAccounts: false, registerProofs: false } });
    const r = l().addBrushing(CHILD, { durationS: 120 });
    expect(recordBrushingProof({ proofId: PROOF, childId: CHILD, brushingRecordId: r.id, sizeBytes: 1000, durationS: 30, mime: 'video/mp4' })).toBeNull();
  });
});

describe('sync engine scopes', () => {
  it('maps session states to local and outbox scopes', () => {
    expect(scopesFor('signedIn', GUARDIAN)).toEqual({ local: GUARDIAN, outbox: GUARDIAN });
    expect(scopesFor('guest', null)).toEqual({ local: GUEST_SCOPE, outbox: null });
    expect(scopesFor('signedOut', null)).toEqual({ local: null, outbox: null });
    expect(scopesFor('loading', null)).toEqual({ local: null, outbox: null });
  });

  it('follows the session: guest, then a signed-in user, then sign-out', async () => {
    const stop = startSyncEngine();
    try {
      useSession.setState({ status: 'guest', userId: null });
      expect(l().scope).toBe(GUEST_SCOPE);
      expect(outbox.scope).toBeNull();

      useAccount.setState({ userId: GUARDIAN, me: guardian, status: 'ready' });
      useSession.setState({ status: 'signedIn', userId: GUARDIAN });
      expect(l().scope).toBe(GUARDIAN);
      expect(outbox.scope).toBe(GUARDIAN);
      await Promise.all([outbox.whenReady(), l().setScope(GUARDIAN)]);

      useSession.setState({ status: 'signedOut', userId: null });
      expect(l().scope).toBeNull();
      expect(outbox.scope).toBeNull();
    } finally {
      stop();
    }
  });
});
