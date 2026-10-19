// Account model v2 API layer (src/core/account/api.ts) against the backend contract:
// ACCOUNTS_AND_FLOWS.md §2–4, §7, EDGE_FUNCTIONS_AND_HOOKS.md §1.5–1.6, SUPABASE_API.md §4.

import {
  ackScreeningRequest,
  brushingStreak,
  childAccounts,
  childHistory,
  childLogin,
  deviceTimeZone,
  ensureSelfProfile,
  listBrushingProofs,
  listChildren,
  listScreeningRequests,
  mapFunctionError,
  mapRpcError,
  myAccount,
  parseRetryAfter,
  proofSignedUrl,
} from '@/core/account/api';
import { useAccount } from '@/core/account/account-store';
import { signInChild } from '@/core/auth/auth-service';
import { setStorageBackendForTests, type KeyValueBackend } from '@/core/auth/secure-storage';
import { useSession } from '@/core/auth/session-store';

jest.mock('@/core/config', () => {
  const actual = jest.requireActual('@/core/config');
  return {
    ...actual,
    config: { ...actual.config, supabaseUrl: 'https://proj.supabase.co', supabaseAnonKey: 'anon-key' },
    isSupabaseConfigured: true,
  };
});

jest.mock('@/core/auth/supabase', () => {
  const createSignedUrl = jest.fn();
  return {
    supabase: {
      rpc: jest.fn(),
      auth: {
        getSession: jest.fn(),
        setSession: jest.fn(),
        signOut: jest.fn(async () => ({ error: null })),
        onAuthStateChange: jest.fn(),
      },
      storage: { from: jest.fn(() => ({ createSignedUrl })) },
    },
    mockCreateSignedUrl: createSignedUrl,
  };
});

const mocked = jest.requireMock('@/core/auth/supabase') as {
  supabase: { rpc: jest.Mock; auth: Record<string, jest.Mock>; storage: { from: jest.Mock } };
  mockCreateSignedUrl: jest.Mock;
};
const rpc = mocked.supabase.rpc;
const auth = mocked.supabase.auth;

const UID = '0b0b0b0b-0000-4000-8000-000000000001';
const GUARDIAN = '0b0b0b0b-0000-4000-8000-000000000002';
const CHILD = 'c0c0c0c0-0000-4000-8000-000000000001';
const PROOF = 'aaaaaaaa-0000-4000-8000-000000000001';
const BRUSH = 'bbbbbbbb-0000-4000-8000-000000000001';

const limits = {
  teen_min_age: 15,
  teen_max_age: 19,
  max_child_accounts_per_guardian: 6,
  streak_min_duration_s: 60,
  request_max_per_child_per_day: 5,
  request_expiry_days: 14,
  proof_max_bytes: 10485760,
  proof_max_duration_s: 180,
  proof_max_per_child_per_day: 3,
  proof_retention_days: 7,
};

function childAccountJson() {
  return {
    user_id: UID,
    account_type: 'child',
    roles: ['child'],
    self_child_id: null,
    child_accounts: null,
    child_account: {
      child_id: CHILD,
      guardian_id: GUARDIAN,
      username: 'si.budi',
      disabled: false,
      sync_allowed: true,
      proof_allowed: true,
    },
    flags: { brushing_proof_video: true },
    capabilities: { create_child_accounts: false, register_proofs: true },
    limits,
  };
}

function ok(data: unknown) {
  return { data, error: null, status: 200 };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

const fetchMock = jest.fn();

function memoryBackend(): KeyValueBackend {
  const data = new Map<string, string>();
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  setStorageBackendForTests(memoryBackend());
  useSession.setState({ status: 'signedOut', email: null, userId: null });
  useAccount.setState({ userId: null, me: null, status: 'idle', lastError: null, lastFetchedAt: null });
});

afterAll(() => setStorageBackendForTests(null));

describe('my_account()', () => {
  it('parses snake_case JSON into the camelCase MyAccount', async () => {
    rpc.mockResolvedValue(ok(childAccountJson()));
    const res = await myAccount();
    expect(rpc).toHaveBeenCalledWith('my_account', undefined);
    expect(res).toEqual({
      ok: true,
      data: {
        userId: UID,
        accountType: 'child',
        roles: ['child'],
        selfChildId: null,
        childAccounts: null,
        childAccount: {
          childId: CHILD,
          guardianId: GUARDIAN,
          username: 'si.budi',
          disabled: false,
          syncAllowed: true,
          proofAllowed: true,
        },
        flags: { brushingProofVideo: true },
        capabilities: { createChildAccounts: false, registerProofs: true },
        limits: expect.objectContaining({ teenMinAge: 15, proofMaxBytes: 10485760, proofRetentionDays: 7 }),
      },
    });
  });

  it('drops roles the app does not know (ADR 018: kader / facility_viewer)', async () => {
    rpc.mockResolvedValue(ok({ ...childAccountJson(), roles: ['child', 'kader', 'facility_viewer', 'admin'] }));
    const res = await myAccount();
    expect(res.ok && res.data.roles).toEqual(['child', 'admin']);
  });

  it.each([
    ['unknown account type', { account_type: 'kader' }],
    ['missing limits key', { limits: { ...limits, proof_max_bytes: undefined } }],
    ['non-uuid user id', { user_id: 'u1' }],
    ['child account without child_account', { child_account: null }],
    ['capability not boolean', { capabilities: { create_child_accounts: 'yes', register_proofs: false } }],
  ])('rejects a malformed answer (%s) as bad_response', async (_name, patch) => {
    rpc.mockResolvedValue(ok({ ...childAccountJson(), ...patch }));
    await expect(myAccount()).resolves.toEqual({ ok: false, code: 'bad_response' });
  });
});

describe('RPC error mapping (ACCOUNTS_AND_FLOWS.md §7)', () => {
  it.each([
    [{ code: 'PGRST202', message: 'Could not find the function public.my_account' }, 404, 'not_deployed'],
    [{ code: '42883', message: 'function does not exist' }, 400, 'not_deployed'],
    [{ code: '28000', message: 'not_authenticated' }, 401, 'not_authenticated'],
    [{ code: '42501', message: 'forbidden' }, 403, 'forbidden'],
    [{ code: '22023', message: 'invalid_argument' }, 400, 'invalid_argument'],
    [{ code: '22023', message: 'age_out_of_range' }, 400, 'age_out_of_range'],
    [{ code: '22023', message: 'deletion_pending' }, 400, 'deletion_pending'],
    [{ code: '22023', message: 'invalid_kind' }, 400, 'invalid_kind'],
    [{ code: '22023', message: 'invalid_action' }, 400, 'invalid_action'],
    [{ code: '22023', message: 'invalid_timezone' }, 400, 'invalid_timezone'],
    [{ code: '22023', message: 'something_new' }, 400, 'invalid_argument'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 401, 'not_authenticated'],
    [{ code: '', message: 'TypeError: Network request failed' }, 0, 'network'],
    [{ code: 'XX000', message: 'boom' }, 500, 'unknown'],
  ])('%j (HTTP %i) -> %s', (error, status, code) => {
    expect(mapRpcError(error, status).code).toBe(code);
  });

  it('turns a thrown request into network', async () => {
    rpc.mockRejectedValueOnce(new Error('offline'));
    await expect(listChildren()).resolves.toEqual({ ok: false, code: 'network' });
  });
});

describe('typed RPC wrappers', () => {
  it('ensure_self_profile sends p_* args and returns the server id (lower case)', async () => {
    rpc.mockResolvedValue(ok(CHILD.toUpperCase()));
    const res = await ensureSelfProfile(CHILD, 2010, null);
    expect(rpc).toHaveBeenCalledWith('ensure_self_profile', { p_child_id: CHILD, p_birth_year: 2010, p_birth_month: null });
    expect(res).toEqual({ ok: true, data: CHILD });
    await expect(ensureSelfProfile('not-a-uuid', 2010, 5)).resolves.toEqual({ ok: false, code: 'invalid_argument' });
  });

  it('list_children rows', async () => {
    rpc.mockResolvedValue(
      ok([
        {
          child_id: CHILD,
          is_self: false,
          birth_year: 2016,
          birth_month: 7,
          consents: ['a', 'b', 'd', 'z'],
          has_child_account: true,
          child_account_disabled: false,
          username: 'si.budi',
          last_screening_at: '2026-10-11T03:12:45+00:00',
          last_screening_level: 'orange',
          last_brushing_at: null,
          open_requests: 1,
          unseen_requests: 1,
          unviewed_proofs: 2,
          deletion_pending: false,
        },
      ]),
    );
    const res = await listChildren();
    expect(res.ok && res.data[0]).toMatchObject({
      childId: CHILD,
      consents: ['a', 'b', 'd'],
      lastScreeningLevel: 'orange',
      unviewedProofs: 2,
      childAccountDisabled: false,
    });
  });

  it('child_history: pagination args, every kind parsed, unknown kinds skipped', async () => {
    rpc.mockResolvedValue(
      ok({
        items: [
          {
            kind: 'screening',
            id: 'dddddddd-0000-4000-8000-000000000001',
            occurred_at: '2026-10-12T00:00:00Z',
            data: { level: 'yellow', red_flag: false, model_version: '0.1.0', rules_version: '0.2.0', findings_count: 2, request_id: null },
          },
          {
            kind: 'brushing',
            id: BRUSH,
            occurred_at: '2026-10-11T12:00:00Z',
            data: { duration_s: 120, spirit_score: null, slot: 'evening', camera_mode: true, counts_for_streak: true, has_proof: true },
          },
          {
            kind: 'referral',
            id: 'eeeeeeee-0000-4000-8000-000000000001',
            occurred_at: '2026-10-11T11:00:00Z',
            data: { level: 'orange', reason_codes: ['det_caries_primary'], facility_code: null, screening_id: null },
          },
          {
            kind: 'screening_request',
            id: 'ffffffff-0000-4000-8000-000000000001',
            occurred_at: '2026-10-11T10:00:00Z',
            data: {
              reason_code: 'toothache',
              pain_level: 6,
              status: 'expired',
              seen_at: null,
              responded_at: null,
              screening_id: null,
              expires_at: '2026-10-25T10:00:00Z',
            },
          },
          {
            kind: 'brushing_proof',
            id: PROOF,
            occurred_at: '2026-10-11T09:00:00Z',
            data: {
              brushing_event_id: BRUSH,
              status: 'uploaded',
              mime: 'video/mp4',
              size_bytes: 3400000,
              duration_s: 120,
              viewed_at: null,
              expires_at: '2026-10-18T09:00:00Z',
            },
          },
          { kind: 'something_new', id: PROOF, occurred_at: '2026-10-11T08:00:00Z', data: {} },
        ],
        next_before: '2026-10-11T09:00:00Z',
      }),
    );
    const res = await childHistory({ childId: CHILD, before: '2026-10-13T00:00:00Z', kinds: ['screening', 'brushing'] });
    expect(rpc).toHaveBeenCalledWith('child_history', {
      p_child: CHILD,
      p_before: '2026-10-13T00:00:00Z',
      p_limit: 30,
      p_kinds: ['screening', 'brushing'],
      p_from: null,
    });
    if (!res.ok) throw new Error(res.code);
    expect(res.data.items.map((i) => i.kind)).toEqual([
      'screening',
      'brushing',
      'referral',
      'screening_request',
      'brushing_proof',
    ]);
    expect(res.data.nextBefore).toBe('2026-10-11T09:00:00Z');
    const brushing = res.data.items[1];
    expect(brushing.kind === 'brushing' && brushing.data).toEqual({
      durationS: 120,
      spiritScore: null,
      slot: 'evening',
      cameraMode: true,
      countsForStreak: true,
      hasProof: true,
    });
  });

  it('brushing_streak uses the device zone by default', async () => {
    rpc.mockResolvedValue(
      ok({
        current: 3,
        longest: 5,
        last_day: '2026-10-18',
        today_done: true,
        week: [{ date: '2026-10-12', done: false, brushings: 0 }],
        min_duration_s: 60,
        tz: 'Asia/Jakarta',
      }),
    );
    const res = await brushingStreak(CHILD);
    expect(rpc).toHaveBeenCalledWith('brushing_streak', { p_child: CHILD, p_tz: deviceTimeZone() });
    expect(res.ok && res.data).toMatchObject({ current: 3, todayDone: true, lastDay: '2026-10-18' });
  });

  it('screening requests: list filters and ack', async () => {
    rpc.mockResolvedValueOnce(ok([]));
    await listScreeningRequests({ statuses: ['pending', 'seen'] });
    expect(rpc).toHaveBeenLastCalledWith('list_screening_requests', { p_child: null, p_status: ['pending', 'seen'], p_limit: 30 });
    rpc.mockResolvedValueOnce(ok({ id: PROOF, status: 'seen', seen_at: '2026-10-18T01:00:00Z', responded_at: null }));
    const res = await ackScreeningRequest(PROOF, 'seen');
    expect(rpc).toHaveBeenLastCalledWith('ack_screening_request', { p_id: PROOF, p_action: 'seen' });
    expect(res).toEqual({ ok: true, data: { id: PROOF, status: 'seen', seenAt: '2026-10-18T01:00:00Z', respondedAt: null } });
  });

  it('list_brushing_proofs rows', async () => {
    rpc.mockResolvedValue(
      ok([
        {
          id: PROOF,
          child_id: CHILD,
          brushing_event_id: BRUSH,
          object_path: `${GUARDIAN}/${CHILD}/${PROOF}.mp4`,
          mime: 'video/mp4',
          size_bytes: 3400000,
          duration_s: 120,
          status: 'uploaded',
          uploaded_at: '2026-10-17T00:00:00Z',
          expires_at: '2026-10-24T00:00:00Z',
          viewed_at: null,
          object_present: false,
        },
      ]),
    );
    const res = await listBrushingProofs({ childId: CHILD, limit: 20 });
    expect(rpc).toHaveBeenCalledWith('list_brushing_proofs', { p_child: CHILD, p_before: null, p_limit: 20 });
    expect(res.ok && res.data[0]).toMatchObject({ objectPresent: false, mime: 'video/mp4' });
  });

  it('a missing v2 RPC is not_deployed (old backend)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 });
    await expect(listChildren()).resolves.toEqual({ ok: false, code: 'not_deployed', status: 404 });
  });
});

describe('proof signed URL (bucket brushing_proofs, 300 s)', () => {
  const path = `${GUARDIAN}/${CHILD}/${PROOF}.mp4`;

  it('asks Storage for a 300 s URL', async () => {
    mocked.mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://proj.supabase.co/storage/v1/sign/x' }, error: null });
    await expect(proofSignedUrl(path)).resolves.toEqual({ ok: true, data: 'https://proj.supabase.co/storage/v1/sign/x' });
    expect(mocked.supabase.storage.from).toHaveBeenCalledWith('brushing_proofs');
    expect(mocked.mockCreateSignedUrl).toHaveBeenCalledWith(path, 300);
  });

  it('refuses a path that is not <owner>/<child>/<proof>.mp4|.mov', async () => {
    await expect(proofSignedUrl('../etc/passwd')).resolves.toEqual({ ok: false, code: 'invalid_argument' });
    expect(mocked.mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it('maps Storage errors', async () => {
    mocked.mockCreateSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'Object not found', statusCode: '404' } });
    await expect(proofSignedUrl(path)).resolves.toEqual({ ok: false, code: 'not_found' });
    mocked.mockCreateSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'Bucket not found', statusCode: '404' } });
    await expect(proofSignedUrl(path)).resolves.toEqual({ ok: false, code: 'not_deployed' });
  });
});

describe('child-accounts Edge Function', () => {
  beforeEach(() => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'guardian-jwt', user: { id: UID } } } });
  });

  it('create: POST with the guardian JWT, anon apikey and a normalised username', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { child_id: CHILD, username: 'si.budi', created: true }));
    const res = await childAccounts.create({ childId: CHILD, username: '  Si.Budi ', password: 'Gigi1234' });
    expect(res).toEqual({ ok: true, data: { childId: CHILD, username: 'si.budi' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/functions/v1/child-accounts');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer guardian-jwt' });
    expect(JSON.parse(init.body)).toEqual({ action: 'create', child_id: CHILD, username: 'si.budi', password: 'Gigi1234' });
  });

  it('checks username and password locally before any request', async () => {
    await expect(childAccounts.create({ childId: CHILD, username: 'admin', password: 'Gigi1234' })).resolves.toEqual({
      ok: false,
      code: 'invalid_username',
    });
    await expect(childAccounts.create({ childId: CHILD, username: 'si.budi', password: 'gigi1234' })).resolves.toEqual({
      ok: false,
      code: 'weak_password',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [409, { error: 'username_taken' }, 'username_taken'],
    [409, { error: 'child_account_limit' }, 'child_account_limit'],
    [409, { error: 'child_already_has_account' }, 'child_already_has_account'],
    [404, { error: 'child_not_found' }, 'child_not_found'],
    [404, { code: 'NOT_FOUND', message: 'Requested function was not found' }, 'not_deployed'],
    [403, { error: 'forbidden' }, 'forbidden'],
    [401, { error: 'unauthorized' }, 'unauthorized'],
    [401, { msg: 'Invalid JWT' }, 'unauthorized'],
    [422, { error: 'weak_password' }, 'weak_password'],
    [500, { error: 'internal' }, 'internal'],
  ])('HTTP %i %j -> %s', async (status, body, code) => {
    fetchMock.mockResolvedValue(jsonResponse(status, body));
    const res = await childAccounts.resetPassword({ childId: CHILD, password: 'Gigi1234' });
    expect(res).toMatchObject({ ok: false, code, status });
  });

  it('set_disabled and delete', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, disabled: true }));
    await expect(childAccounts.setDisabled({ childId: CHILD, disabled: true })).resolves.toEqual({
      ok: true,
      data: { disabled: true },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await expect(childAccounts.remove({ childId: CHILD })).resolves.toEqual({ ok: true, data: true });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: 'delete', child_id: CHILD });
  });

  it('without a session it does not call the function', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await expect(childAccounts.remove({ childId: CHILD })).resolves.toEqual({ ok: false, code: 'not_authenticated' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a network failure is network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await expect(childAccounts.remove({ childId: CHILD })).resolves.toEqual({ ok: false, code: 'network' });
  });
});

describe('child-login Edge Function', () => {
  const input = { parentEmail: ' Ortu@Contoh.com ', username: 'Si.Budi', password: 'Gigi1234', captchaToken: 'tok' };
  const session = {
    access_token: 'child-access',
    refresh_token: 'child-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 1790000000,
    user: { id: UID },
    child: { username: 'si.budi' },
  };

  it('posts with the anon key and returns the session', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, session));
    const res = await childLogin(input);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/functions/v1/child-login');
    expect(init.headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer anon-key' });
    expect(JSON.parse(init.body)).toEqual({
      parent_email: 'ortu@contoh.com',
      username: 'si.budi',
      password: 'Gigi1234',
      captcha_token: 'tok',
    });
    expect(res).toEqual({
      ok: true,
      data: { accessToken: 'child-access', refreshToken: 'child-refresh', expiresAt: 1790000000, userId: UID, username: 'si.budi' },
    });
  });

  it('omits captcha_token when there is none', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, session));
    await childLogin({ ...input, captchaToken: null });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('captcha_token');
  });

  it.each([
    [401, { error: 'invalid_credentials' }, {}, { code: 'invalid_credentials', status: 401 }],
    [429, { error: 'too_many_attempts' }, { 'Retry-After': '900' }, { code: 'too_many_attempts', status: 429, retryAfterS: 900 }],
    [429, { error: 'too_many_attempts' }, {}, { code: 'too_many_attempts', status: 429 }],
    [400, { error: 'invalid_body' }, {}, { code: 'invalid_body', status: 400 }],
    [502, { error: 'upstream_unavailable' }, {}, { code: 'upstream_unavailable', status: 502 }],
    [503, undefined, {}, { code: 'upstream_unavailable', status: 503 }],
    [500, { error: 'internal' }, {}, { code: 'internal', status: 500 }],
    [404, { message: 'Requested function was not found' }, {}, { code: 'not_deployed', status: 404 }],
  ])('HTTP %i %j %j', async (status, body, headers, expected) => {
    fetchMock.mockResolvedValue(jsonResponse(status, body, headers));
    await expect(childLogin(input)).resolves.toEqual({ ok: false, ...expected });
  });

  it('refuses malformed input locally (no attempt spent)', async () => {
    await expect(childLogin({ ...input, username: 'x' })).resolves.toEqual({ ok: false, code: 'invalid_body' });
    await expect(childLogin({ ...input, parentEmail: 'bukan-email' })).resolves.toEqual({ ok: false, code: 'invalid_body' });
    await expect(childLogin({ ...input, password: '' })).resolves.toEqual({ ok: false, code: 'invalid_body' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a 200 without tokens is bad_response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ...session, access_token: undefined }));
    await expect(childLogin(input)).resolves.toEqual({ ok: false, code: 'bad_response' });
  });

  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('120')).toBe(120);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
    const now = Date.parse('2026-10-18T00:00:00Z');
    expect(parseRetryAfter('Sun, 18 Oct 2026 00:01:00 GMT', now)).toBe(60);
    expect(mapFunctionError(429, { error: 'too_many_attempts' }, ' 30 ')).toEqual({
      ok: false,
      code: 'too_many_attempts',
      status: 429,
      retryAfterS: 30,
    });
  });
});

describe('signInChild (auth service)', () => {
  const input = { parentEmail: 'ortu@contoh.com', username: 'si.budi', password: 'Gigi1234', captchaToken: 'tok' };
  const session = {
    access_token: 'child-access',
    refresh_token: 'child-refresh',
    expires_at: 1790000000,
    user: { id: UID },
    child: { username: 'si.budi' },
  };

  beforeEach(() => {
    auth.setSession.mockResolvedValue({ data: {}, error: null });
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'child-access', user: { id: UID } } } });
  });

  it('sets the session, reads my_account() and requires a child account', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, session));
    rpc.mockResolvedValue(ok(childAccountJson()));
    const res = await signInChild(input);
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'child-access', refresh_token: 'child-refresh' });
    expect(res).toMatchObject({ ok: true, account: { accountType: 'child' } });
    expect(useAccount.getState().me?.childAccount?.guardianId).toBe(GUARDIAN);
  });

  it('signs a non-child account out again (not_child)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, session));
    rpc.mockResolvedValue(
      ok({ ...childAccountJson(), account_type: 'guardian', roles: ['guardian'], child_account: null, child_accounts: 0 }),
    );
    await expect(signInChild(input)).resolves.toEqual({ ok: false, code: 'not_child' });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(useAccount.getState().me).toBeNull();
  });

  it('passes Retry-After through on 429 without touching the session', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: 'too_many_attempts' }, { 'Retry-After': '600' }));
    await expect(signInChild(input)).resolves.toEqual({ ok: false, code: 'too_many_attempts', retryAfterS: 600 });
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it('reports a refused session as session_failed', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, session));
    auth.setSession.mockResolvedValue({ data: {}, error: { message: 'Invalid Refresh Token' } });
    await expect(signInChild(input)).resolves.toEqual({ ok: false, code: 'session_failed' });
  });
});
