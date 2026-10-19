// Screening on account v2: request params -> requestId -> screening_recorded.request_id,
// payload mapping (level, red_flag, findings), referral_created recorded once behind the
// screening event, the teen subject, and the result-screen sync state.
import { useAccount } from '@/core/account/account-store';
import type { PhotoRequest, PhotoResult } from '@/core/api/screening-api';
import { setStorageBackendForTests, type KeyValueBackend } from '@/core/auth/secure-storage';
import { useSession } from '@/core/auth/session-store';
import { installSyncBridge, syncRefs } from '@/core/sync/bridge';
import { outbox } from '@/core/sync/outbox';
import { useLocalData } from '@/data/local-store';
import { DEFAULT_LIMITS, type ChildProfile, type MyAccount } from '@/domain/models';
import { evaluate, triageParams, triageRules, type Answer } from '@/domain/triage';
import type { Detection } from '@/ml/detector';
import type { QualityResult } from '@/ml/quality-gate';
import { redFlagQuestions } from '@/features/screening/pipeline';
import { ensureReferral } from '@/features/screening/referral-sync';
import { useScreeningSession } from '@/features/screening/session-store';
import { childLabels, resolveRequestTarget, teenSelfProfile } from '@/features/screening/subject';
import { screeningSyncState } from '@/features/screening/sync-state';

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('@/core/auth/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { refreshSession: jest.fn(), signOut: jest.fn(), getSession: jest.fn(), onAuthStateChange: jest.fn() },
  },
}));

// The server detector (POST /v1/screening/photo) answers with these findings; null = offline.
const mockDetections: { current: Detection[] | null } = { current: null };
jest.mock('@/core/config', () => ({ ...jest.requireActual('@/core/config'), isApiConfigured: true }));
jest.mock('@/core/api/screening-api', () => ({
  ...jest.requireActual('@/core/api/screening-api'),
  screenPhoto: (req: PhotoRequest) => mockScreenPhoto(req),
}));
async function mockScreenPhoto(req: PhotoRequest): Promise<PhotoResult> {
  const detections = mockDetections.current;
  if (!detections) return { kind: 'unavailable', reason: 'network' };
  const output = evaluate(
    triageRules,
    {
      detections: detections.map((d) => ({ class: d.class, confidence: d.confidence })),
      photo_status: 'assessed',
      symptoms: req.symptoms,
      age_months: req.ageMonths,
      pain: req.pain,
    },
    triageParams,
  );
  return {
    kind: 'ok',
    screening: { output, rulesStatus: 'draft', clinicallyValidated: false, photoStatus: 'assessed', detections, modelVersion: '1.0.0' },
  };
}

const GUARDIAN = '0b0b0b0b-0000-4000-8000-000000000001';
const TEEN = '0b0b0b0b-0000-4000-8000-000000000002';
const CHILD = 'c0c0c0c0-0000-4000-8000-000000000001';
const CHILD2 = 'c0c0c0c0-0000-4000-8000-000000000002';
const SELF = 'c0c0c0c0-0000-4000-8000-0000000000ff';
const REQUEST = '77777777-7777-4777-8777-777777777701';

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
const legacy = account({ capabilities: { createChildAccounts: false, registerProofs: false }, legacy: true });
const kid = (id = CHILD, nickname = 'Adik'): ChildProfile => ({ id, nickname, birthYear: 2018, birthMonth: 3, allergies: [] });
const allNo = (): Record<string, Answer> => Object.fromEntries(triageRules.questions.map((q) => [q.id, 'no']));
const pixels = { width: 4, height: 4, channels: 3 as const, data: new Uint8Array(48) };
const upload = { base64: 'AAAA', width: 4, height: 4 };
const passed: QualityResult = { passed: true, reasons: [], metrics: {} as QualityResult['metrics'], config_status: 'PLACEHOLDER' };

const l = () => useLocalData.getState();
const session = () => useScreeningSession.getState();
const queued = (ref: string) => outbox.findByRef(ref);
const payloadOf = (ref: string) => JSON.parse(queued(ref)[0].payloadJson) as Record<string, unknown>;

async function signIn(me: MyAccount) {
  useSession.setState({ status: 'signedIn', userId: me.userId, email: null });
  useAccount.setState({ userId: me.userId, me, status: 'ready', lastError: null });
  await Promise.all([l().setScope(me.userId), outbox.setScope(me.userId)]);
  l().applyAccount(me);
}

/** Guardian with one child and consents (a) + (b) on. */
async function guardianWithChild(me: MyAccount = guardian) {
  await signIn(me);
  l().upsertChild(kid());
  l().setConsent(CHILD, 'a', true);
  l().setConsent(CHILD, 'b', true);
}

async function screen(opts: { requestId?: string | null; answers?: Record<string, Answer>; choice?: 'skip' | 'use' | 'red_flag' } = {}) {
  const child = l().kids.find((k) => k.id === CHILD) ?? null;
  session().start(child, undefined, { requestId: opts.requestId });
  const answers = opts.answers ?? allNo();
  for (const [qid, a] of Object.entries(answers)) session().setAnswer(qid, a);
  if (opts.choice !== 'red_flag') session().setPain(0);
  if (opts.choice === 'use') session().setCapture({ uri: 'mem://photo', width: 4, height: 4, pixels, upload }, passed);
  await session().finish(opts.choice ?? 'skip');
  const record = session().record;
  if (!record) throw new Error('screening not saved');
  return record;
}

let uninstall: () => void = () => {};

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
  await Promise.all([l().setScope(null), outbox.setScope(null)]);
  setStorageBackendForTests(memoryBackend());
  useSession.setState({ status: 'signedOut', userId: null, email: null });
  useAccount.setState({ userId: null, me: null, status: 'idle', lastError: null });
  session().reset();
  mockDetections.current = null;
  uninstall = installSyncBridge();
});

afterEach(() => {
  uninstall();
  jest.useRealTimers();
});

describe('request params', () => {
  const kids = [kid(), kid(CHILD2)];

  it('carries the request only for a known child with uuid params', () => {
    expect(resolveRequestTarget({ child: CHILD, request: REQUEST }, kids, [])).toEqual({ kind: 'ok', childId: CHILD, requestId: REQUEST });
    expect(resolveRequestTarget({ child: CHILD.toUpperCase(), request: [REQUEST.toUpperCase()] }, kids, [])).toEqual({
      kind: 'ok',
      childId: CHILD,
      requestId: REQUEST,
    });
    expect(resolveRequestTarget({}, kids, [])).toEqual({ kind: 'none' });
    expect(resolveRequestTarget({ child: CHILD, request: 'nope' }, kids, [])).toEqual({ kind: 'none' });
    expect(resolveRequestTarget({ child: 'c0c0c0c0-0000-4000-8000-0000000000ee', request: REQUEST }, kids, [])).toEqual({
      kind: 'missing_child',
    });
    expect(resolveRequestTarget({ child: CHILD, request: REQUEST }, kids, [{ requestId: REQUEST }])).toEqual({ kind: 'answered' });
  });

  it('labels children known only from the server with a fallback', () => {
    const labels = childLabels([kid(CHILD, ''), kid(CHILD2, 'Budi'), kid(SELF, '  ')], (n) => `Anak ${n}`);
    expect([...labels.values()]).toEqual(['Anak 1', 'Budi', 'Anak 2']);
  });

  it('start() keeps a uuid request id for a chosen child only', () => {
    session().start(kid(), undefined, { requestId: REQUEST.toUpperCase() });
    expect(session().requestId).toBe(REQUEST);
    session().start(kid(), undefined, { requestId: 'bad' });
    expect(session().requestId).toBeNull();
    session().start(null, undefined, { requestId: REQUEST });
    expect(session().requestId).toBeNull();
    session().start(kid());
    expect(session().requestId).toBeNull();
  });
});

describe('screening_recorded', () => {
  it('propagates the request id into the record and the payload', async () => {
    await guardianWithChild();
    const record = await screen({ requestId: REQUEST });
    expect(record).toMatchObject({ childId: CHILD, requestId: REQUEST, referralId: null, synced: false });
    expect(l().screenings[0].requestId).toBe(REQUEST);
    const payload = payloadOf(syncRefs.screening(record.id));
    expect(payload).toMatchObject({
      screening_id: record.id,
      child_id: CHILD,
      request_id: REQUEST,
      level: 'green',
      red_flag: false,
      findings: [],
      model_version: '0.0.0-none',
    });
  });

  it('omits request_id for an ordinary screening and on a legacy backend', async () => {
    await guardianWithChild();
    const plain = await screen();
    expect(payloadOf(syncRefs.screening(plain.id))).not.toHaveProperty('request_id');

    await Promise.all([l().setScope(null), outbox.setScope(null)]);
    await guardianWithChild(legacy);
    const old = await screen({ requestId: REQUEST });
    expect(old.requestId).toBe(REQUEST);
    expect(payloadOf(syncRefs.screening(old.id))).not.toHaveProperty('request_id');
  });

  it('maps a red flag to level red and red_flag true', async () => {
    await guardianWithChild();
    const answers = Object.fromEntries(redFlagQuestions.map((q) => [q.id, q.id === 'facial_swelling' ? 'yes' : 'no'] as const));
    const record = await screen({ answers, choice: 'red_flag' });
    expect(record.redFlag).toBe(true);
    expect(record.reasons.some((r) => r.id.startsWith('RF_'))).toBe(true);
    expect(payloadOf(syncRefs.screening(record.id))).toMatchObject({ level: 'red', red_flag: true });
  });

  it('sends findings as class, confidence and box only', async () => {
    await guardianWithChild();
    mockDetections.current = [{ class: 'caries_primary', confidence: 0.91, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 } }];
    const record = await screen({ choice: 'use' });
    const payload = payloadOf(syncRefs.screening(record.id));
    expect(payload.model_version).toBe('1.0.0');
    expect(payload.findings).toEqual([{ class: 'caries_primary', confidence: 0.91, box: [0.1, 0.2, 0.3, 0.25] }]);
    expect(JSON.stringify(payload)).not.toMatch(/uri|answers|reasons|nickname/);
  });

  it('saves locally without (b) but queues nothing', async () => {
    await signIn(guardian);
    l().upsertChild(kid());
    l().setConsent(CHILD, 'a', true);
    const record = await screen({ requestId: REQUEST });
    expect(l().screenings[0].id).toBe(record.id);
    expect(queued(syncRefs.screening(record.id))).toHaveLength(0);
  });
});

describe('referral_created', () => {
  it('is recorded once per screening, behind the screening event', async () => {
    await guardianWithChild();
    // A white spot keeps the level above routine, so a referral exists.
    const record = await screen({ answers: { ...allNo(), white_spot: 'yes' } });
    const first = ensureReferral(record.id);
    const second = ensureReferral(record.id);
    expect(first).not.toBeNull();
    expect(second?.id).toBe(first?.id);
    expect(l().referrals).toHaveLength(1);
    expect(l().screenings[0].referralId).toBe(first?.id);
    expect(session().record?.referralId).toBe(first?.id);

    const entries = queued(syncRefs.referral(first!.id));
    expect(entries).toHaveLength(1);
    const screeningEvent = queued(syncRefs.screening(record.id))[0].eventId;
    expect(entries[0].dependsOn).toContain(screeningEvent);
    const payload = JSON.parse(entries[0].payloadJson) as Record<string, unknown>;
    expect(payload).toMatchObject({ referral_id: first!.id, child_id: CHILD, screening_id: record.id, level: 'yellow' });
    expect(payload.reason_codes).toEqual(record.reasons.map((r) => r.id.toLowerCase()));
    expect(payload.facility_code ?? null).toBeNull();
  });

  it('is not recorded for routine or unknown screenings', async () => {
    await guardianWithChild();
    const record = await screen();
    useLocalData.setState({ screenings: l().screenings.map((r) => (r.id === record.id ? { ...r, level: 'routine' } : r)) });
    expect(ensureReferral(record.id)).toBeNull();
    expect(ensureReferral('55555555-5555-4555-8555-555555555599')).toBeNull();
    expect(l().referrals).toHaveLength(0);
  });
});

describe('teen subject', () => {
  it('is the self profile, from self_child_id first, then the local flag', () => {
    const kids = [kid(CHILD), { ...kid(SELF, 'Aku'), isSelf: true }];
    expect(teenSelfProfile(kids, { selfChildId: SELF })?.id).toBe(SELF);
    expect(teenSelfProfile(kids, null)?.id).toBe(SELF);
    expect(teenSelfProfile([kid(CHILD)], { selfChildId: SELF })).toBeNull();
  });

  it('a teen screening of the self profile is queued for that profile', async () => {
    const teen = account({ userId: TEEN, accountType: 'teen', selfChildId: SELF, capabilities: { createChildAccounts: false, registerProofs: true } });
    await signIn(teen);
    l().ensureSelfProfile({ childId: SELF, birthYear: 2010, birthMonth: 5 });
    l().setConsent(SELF, 'a', true);
    l().setConsent(SELF, 'b', true);
    const self = teenSelfProfile(l().kids, teen);
    expect(self?.id).toBe(SELF);
    session().start(self);
    for (const [qid, a] of Object.entries(allNo())) session().setAnswer(qid, a);
    session().setPain(0);
    await session().finish('skip');
    const record = session().record!;
    expect(record.childId).toBe(SELF);
    expect(payloadOf(syncRefs.screening(record.id)).child_id).toBe(SELF);
  });
});

describe('sync line', () => {
  const base = { session: 'signedIn' as const, synced: false, consentB: true, blocked: false, eventState: null };

  it('follows the account, consent (b) and the outbox state', () => {
    expect(screeningSyncState({ ...base, session: 'guest' })).toBe('guest');
    expect(screeningSyncState({ ...base, session: 'signedOut' })).toBeNull();
    expect(screeningSyncState({ ...base, consentB: false })).toBe('local_only');
    expect(screeningSyncState({ ...base, eventState: 'pending' })).toBe('pending');
    expect(screeningSyncState({ ...base, eventState: 'inflight' })).toBe('pending');
    expect(screeningSyncState({ ...base, eventState: 'applied' })).toBe('synced');
    expect(screeningSyncState({ ...base, synced: true, consentB: false })).toBe('synced');
    expect(screeningSyncState({ ...base, eventState: 'rejected' })).toBe('attention');
    expect(screeningSyncState({ ...base, eventState: 'held' })).toBe('attention');
    expect(screeningSyncState({ ...base, blocked: true })).toBe('blocked');
  });
});
