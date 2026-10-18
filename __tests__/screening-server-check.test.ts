// ADR 019: online re-check of a screening via POST /v1/screening/evaluate. Client contract
// (body, auth, status mapping, response validation), the decision rules (when to ask, which
// level wins, fail-safe) and the screening session wiring.
import { evaluateScreening, parseEvaluation, type EvaluateResult } from '@/core/api/screening-api';
import { useAccount } from '@/core/account/account-store';
import { setStorageBackendForTests, type KeyValueBackend } from '@/core/auth/secure-storage';
import { useSession } from '@/core/auth/session-store';
import { outbox } from '@/core/sync/outbox';
import { useLocalData } from '@/data/local-store';
import { DEFAULT_LIMITS, type MyAccount } from '@/domain/models';
import { triageRules, type Answer, type TriageInput, type TriageOutput } from '@/domain/triage';
import { redFlagQuestions } from '@/features/screening/pipeline';
import { applyServerResult, chooseOutput, shouldAskServer } from '@/features/screening/server-check';
import { useScreeningSession } from '@/features/screening/session-store';

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('@/core/auth/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { refreshSession: jest.fn(), signOut: jest.fn(), getSession: jest.fn(), onAuthStateChange: jest.fn() },
  },
}));
jest.mock('@/core/config', () => ({ ...jest.requireActual('@/core/config'), isApiConfigured: true }));

const mockEvaluate = jest.fn<Promise<EvaluateResult>, [TriageInput]>();
jest.mock('@/core/api/screening-api', () => {
  const actual = jest.requireActual('@/core/api/screening-api');
  return { ...actual, evaluateScreening: (input: TriageInput, deps?: unknown) => (deps ? actual.evaluateScreening(input, deps) : mockEvaluate(input)) };
});

const BASE = 'https://api.test';
const TOKEN = 'jwt-token';
const allNo = (): Record<string, Answer> => Object.fromEntries(triageRules.questions.map((q) => [q.id, 'no']));
const input = (over: Partial<TriageInput> = {}): TriageInput => ({
  detections: [],
  photo_status: 'not_taken',
  symptoms: allNo(),
  age_months: 96,
  pain: 0,
  ...over,
});

function serverBody(level = 'urgent', triageVersion = '0.2.0-draft') {
  return {
    triage: {
      level,
      reasons: [{ id: 'PAIN_HIGH', text: 'Perlu diperiksa dokter gigi segera.' }],
      lesions: [{ detection_index: 0, class: 'caries_primary', dentition: 'primary', confidence: 0.81, counted: true }],
      advice_ids: ['ADV_DENTIST_SOON', 'ADV_DISCLAIMER_NOT_DIAGNOSIS', 'ADV_REFERRAL_CTA'],
      referral_template_id: 'REF_URGENT',
    },
    rules_version: { triage: triageVersion, recommender: '0.1.0-draft' },
    rules_status: 'draft',
    clinically_validated: false,
    referral: { required: true, cta_id: 'ADV_REFERRAL_CTA' },
  };
}

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const deps = (fetchImpl: jest.Mock, over: Record<string, unknown> = {}) => ({
  baseUrl: BASE,
  getAccessToken: async () => TOKEN,
  fetchImpl: fetchImpl as unknown as typeof fetch,
  ...over,
});

describe('evaluateScreening (client)', () => {
  it('posts exactly the engine input with the user JWT, never a box', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, serverBody()));
    const withBox = input({
      photo_status: 'assessed',
      detections: [{ class: 'caries_primary', confidence: 0.81, box: [1, 2, 3, 4] } as never],
    });
    const result = await evaluateScreening(withBox, deps(fetchImpl));
    expect(result.kind).toBe('ok');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE}/v1/screening/evaluate`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual(['age_months', 'detections', 'pain', 'photo_status', 'symptoms']);
    expect(body.detections).toEqual([{ class: 'caries_primary', confidence: 0.81 }]);
  });

  it('maps a 200 into a triage output with the server rules version', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, serverBody('urgent', '0.3.0-draft')));
    const result = await evaluateScreening(input(), deps(fetchImpl));
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.evaluation.output.level).toBe('urgent');
    expect(result.evaluation.output.rules_version).toBe('0.3.0-draft');
    expect(result.evaluation.clinicallyValidated).toBe(false);
  });

  it('does not call the network without a base URL or a session', async () => {
    const fetchImpl = jest.fn();
    expect(await evaluateScreening(input(), deps(fetchImpl, { baseUrl: null }))).toEqual({ kind: 'unavailable', reason: 'not_configured' });
    expect(await evaluateScreening(input(), deps(fetchImpl, { getAccessToken: async () => null }))).toEqual({
      kind: 'unavailable',
      reason: 'no_session',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [404, 'not_enabled', { error: { code: 'not_found' } }],
    [401, 'unauthorized', { error: { code: 'token_expired' } }],
    [403, 'forbidden', { error: { code: 'forbidden' } }],
    [429, 'rate_limited', { error: { code: 'rate_limited' } }],
    [503, 'server', { error: { code: 'rules_unavailable', fail_safe: { action: 'show_referral_screen' } } }],
    [500, 'server', null],
    [422, 'bad_response', { error: { code: 'validation_error' } }],
  ])('HTTP %i -> unavailable %s (device result stands)', async (status, reason, body) => {
    const result = await evaluateScreening(input(), deps(jest.fn().mockResolvedValue(response(status, body))));
    expect(result).toEqual({ kind: 'unavailable', reason });
  });

  it('follows the fail-safe of an engine rejection (422)', async () => {
    const body = { error: { code: 'SYMPTOMS_INVALID', engine: 'triage', fail_safe: { action: 'show_referral_screen' } } };
    const result = await evaluateScreening(input(), deps(jest.fn().mockResolvedValue(response(422, body))));
    expect(result).toEqual({ kind: 'fail_safe', code: 'SYMPTOMS_INVALID' });
  });

  it('treats a network error or a timeout as unavailable', async () => {
    expect(await evaluateScreening(input(), deps(jest.fn().mockRejectedValue(new TypeError('Network request failed'))))).toEqual({
      kind: 'unavailable',
      reason: 'network',
    });
    const hang = jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    expect(await evaluateScreening(input(), deps(hang, { timeoutMs: 10 }))).toEqual({ kind: 'unavailable', reason: 'network' });
  });

  it('rejects malformed 200 bodies instead of guessing a level', () => {
    expect(parseEvaluation(serverBody('purple'))).toBeNull();
    expect(parseEvaluation({ ...serverBody(), clinically_validated: 'no' })).toBeNull();
    const noReasons = serverBody();
    (noReasons.triage as Record<string, unknown>).reasons = [{ id: 'X' }];
    expect(parseEvaluation(noReasons)).toBeNull();
    expect(parseEvaluation(null)).toBeNull();
  });
});

describe('decision rules', () => {
  const base = { apiConfigured: true, signedIn: true, isChildAccount: false, consentB: true, redFlagShortCircuit: false, localLevel: 'routine' };

  it('asks only a signed-in parent/teen with consent (b) and a result that could still rise', () => {
    expect(shouldAskServer(base)).toBe(true);
    expect(shouldAskServer({ ...base, apiConfigured: false })).toBe(false);
    expect(shouldAskServer({ ...base, signedIn: false })).toBe(false);
    expect(shouldAskServer({ ...base, isChildAccount: true })).toBe(false);
    expect(shouldAskServer({ ...base, consentB: false })).toBe(false);
    expect(shouldAskServer({ ...base, redFlagShortCircuit: true })).toBe(false);
    expect(shouldAskServer({ ...base, localLevel: 'emergency' })).toBe(false);
    expect(shouldAskServer({ ...base, localLevel: 'urgent' })).toBe(true);
  });

  const local = (level: string): TriageOutput => ({
    level,
    reasons: [{ id: 'LOCAL', text: 'lokal' }],
    lesions: [],
    advice_ids: [],
    referral_template_id: 'REF_LOCAL',
    rules_version: '0.2.0-draft',
  });
  const server = (level: string) => parseEvaluation(serverBody(level))!;

  it('shows the more urgent level; a re-check never lowers it', () => {
    expect(chooseOutput(local('scheduled'), server('urgent'))).toMatchObject({ source: 'server', output: { level: 'urgent' } });
    expect(chooseOutput(local('urgent'), server('routine'))).toMatchObject({ source: 'device', output: { level: 'urgent' } });
    expect(chooseOutput(local('urgent'), server('urgent'))).toMatchObject({ source: 'server' });
  });

  it('keeps the device result when the server is unavailable and fails safe on rejection', () => {
    expect(applyServerResult(local('routine'), { kind: 'unavailable', reason: 'network' })).toEqual({
      kind: 'result',
      output: local('routine'),
      source: 'device',
    });
    expect(applyServerResult(local('routine'), { kind: 'fail_safe', code: 'SYMPTOMS_INVALID' })).toEqual({
      kind: 'fail_safe',
      code: 'server_SYMPTOMS_INVALID',
    });
  });
});

describe('screening session wiring', () => {
  const GUARDIAN = '0b0b0b0b-0000-4000-8000-000000000001';
  const CHILD = 'c0c0c0c0-0000-4000-8000-000000000001';
  const me: MyAccount = {
    userId: GUARDIAN,
    accountType: 'guardian',
    roles: ['guardian'],
    selfChildId: null,
    childAccounts: 0,
    childAccount: null,
    flags: { brushingProofVideo: false },
    capabilities: { createChildAccounts: true, registerProofs: false },
    limits: DEFAULT_LIMITS,
  };
  const l = () => useLocalData.getState();
  const session = () => useScreeningSession.getState();

  function memoryBackend(): KeyValueBackend {
    const store = new Map<string, string>();
    return {
      getItem: async (k) => store.get(k) ?? null,
      setItem: async (k, v) => void store.set(k, v),
      removeItem: async (k) => void store.delete(k),
    };
  }

  async function guardianWithChild(consentB = true) {
    useSession.setState({ status: 'signedIn', userId: GUARDIAN, email: null });
    useAccount.setState({ userId: GUARDIAN, me, status: 'ready', lastError: null });
    await Promise.all([l().setScope(GUARDIAN), outbox.setScope(GUARDIAN)]);
    l().applyAccount(me);
    l().upsertChild({ id: CHILD, nickname: 'Adik', birthYear: 2018, birthMonth: 3, allergies: [] });
    l().setConsent(CHILD, 'a', true);
    if (consentB) l().setConsent(CHILD, 'b', true);
  }

  async function screen(answers: Record<string, Answer> = allNo(), choice: 'skip' | 'red_flag' = 'skip') {
    session().start(l().kids.find((k) => k.id === CHILD) ?? null);
    for (const [qid, a] of Object.entries(answers)) session().setAnswer(qid, a);
    if (choice !== 'red_flag') session().setPain(0);
    return session().finish(choice);
  }

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    await Promise.all([l().setScope(null), outbox.setScope(null)]);
    setStorageBackendForTests(memoryBackend());
    session().reset();
    mockEvaluate.mockReset();
  });

  afterEach(() => jest.useRealTimers());

  it('uses a higher server level, saves it and its rules version', async () => {
    await guardianWithChild();
    mockEvaluate.mockResolvedValue({ kind: 'ok', evaluation: parseEvaluation(serverBody('urgent', '0.3.0-draft'))! });
    await screen();
    expect(mockEvaluate).toHaveBeenCalledTimes(1);
    expect(session().triageSource).toBe('server');
    expect(session().record).toMatchObject({ level: 'urgent', rulesVersion: '0.3.0-draft', triageSource: 'server' });
  });

  it('keeps the device result when the server is unavailable', async () => {
    await guardianWithChild();
    mockEvaluate.mockResolvedValue({ kind: 'unavailable', reason: 'network' });
    const outcome = await screen();
    expect(outcome.kind).toBe('result');
    expect(session().triageSource).toBe('device');
    expect(session().record?.triageSource).toBe('device');
  });

  it('shows the safe referral screen (no level, nothing saved) on a server rejection', async () => {
    await guardianWithChild();
    mockEvaluate.mockResolvedValue({ kind: 'fail_safe', code: 'SYMPTOMS_INVALID' });
    const outcome = await screen();
    expect(outcome).toEqual({ kind: 'error', code: 'server_SYMPTOMS_INVALID' });
    expect(session().record).toBeNull();
  });

  it('never asks without consent (b), nor for a red flag', async () => {
    await guardianWithChild(false);
    await screen();
    expect(mockEvaluate).not.toHaveBeenCalled();

    session().reset();
    l().setConsent(CHILD, 'b', true);
    await screen({ ...allNo(), [redFlagQuestions[0].id]: 'yes' }, 'red_flag');
    expect(mockEvaluate).not.toHaveBeenCalled();
    expect(session().record?.level).toBe('emergency');
  });
});
