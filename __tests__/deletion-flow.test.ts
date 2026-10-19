// Guardian / teen data deletion: the request_deletion wrapper (src/core/account/api.ts) against
// SUPABASE_API.md §3.2, the local clean-up hooks (local store, outbox, proof uploads), and the
// flow in src/features/deletion/deletion-flow.ts (ACCOUNTS_AND_FLOWS.md §1, §9).
import { useAccount } from '@/core/account/account-store';
import { requestDeletion } from '@/core/account/api';
import { getRememberedParentEmail, rememberParentEmail } from '@/core/auth/auth-service';
import { appStorage, setStorageBackendForTests, type KeyValueBackend } from '@/core/auth/secure-storage';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { installSyncBridge, syncRefs } from '@/core/sync/bridge';
import { OUTBOX_STORAGE_PREFIX, outbox } from '@/core/sync/outbox';
import { LOCAL_STORAGE_PREFIX, useLocalData } from '@/data/local-store';
import { DEFAULT_LIMITS, type ChildProfile, type ChildSummary, type MyAccount } from '@/domain/models';
import type { ProofFiles } from '@/features/brushing/proof-files';
import { ProofUploadQueue, proofUploads, type EnqueueProofInput } from '@/features/brushing/proof-uploads';
import {
  canRequestDeletion,
  deletionErrorMessage,
  isDeletionPending,
  pendingElsewhere,
  requestAccountDeletion,
  requestChildDeletion,
  selfProfileId,
} from '@/features/deletion/deletion-flow';
import { useDeletionNotice } from '@/features/deletion/notice';

jest.mock('@/core/auth/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: {
      refreshSession: jest.fn(),
      signOut: jest.fn(async () => ({ error: null })),
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
    },
  },
}));

const mocked = jest.requireMock('@/core/auth/supabase') as {
  supabase: { rpc: jest.Mock; auth: { refreshSession: jest.Mock; signOut: jest.Mock } };
};
const rpc = mocked.supabase.rpc;

const GUARDIAN = '0b0b0b0b-0000-4000-8000-000000000001';
const TEEN = '0b0b0b0b-0000-4000-8000-000000000002';
const KID_USER = '0b0b0b0b-0000-4000-8000-000000000003';
const CHILD = 'c0c0c0c0-0000-4000-8000-000000000001';
const CHILD2 = 'c0c0c0c0-0000-4000-8000-000000000002';
const SELF = 'c0c0c0c0-0000-4000-8000-0000000000ff';
const REQUEST = 'd0d0d0d0-0000-4000-8000-000000000001';

type RpcAnswer = { data: unknown; error: unknown; status?: number };

function memoryBackend(): KeyValueBackend & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
  };
}

function account(over: Partial<MyAccount> = {}): MyAccount {
  return {
    userId: GUARDIAN,
    accountType: 'guardian',
    roles: ['guardian'],
    selfChildId: null,
    childAccounts: 1,
    childAccount: null,
    flags: { brushingProofVideo: true },
    capabilities: { createChildAccounts: true, registerProofs: false },
    limits: DEFAULT_LIMITS,
    ...over,
  };
}

const guardian = account();
const teen = account({ userId: TEEN, accountType: 'teen', selfChildId: SELF, childAccounts: 0, capabilities: { createChildAccounts: false, registerProofs: true } });
const kidAccount = account({
  userId: KID_USER,
  accountType: 'child',
  roles: ['child'],
  childAccounts: null,
  capabilities: { createChildAccounts: false, registerProofs: true },
  childAccount: { childId: CHILD, guardianId: GUARDIAN, username: 'si.adik', disabled: false, syncAllowed: true, proofAllowed: true },
});

const kid = (childId = CHILD, over: Partial<ChildProfile> = {}): ChildProfile => ({
  id: childId,
  nickname: 'Adik',
  birthYear: 2018,
  birthMonth: 3,
  allergies: ['sls'],
  ...over,
});

function summary(over: Partial<ChildSummary> = {}): ChildSummary {
  return {
    childId: CHILD,
    isSelf: false,
    birthYear: 2018,
    birthMonth: 3,
    consents: ['b'],
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

/** list_children() wire row. */
function wireRow(childId: string, over: Record<string, unknown> = {}) {
  return {
    child_id: childId,
    is_self: false,
    birth_year: 2018,
    birth_month: 3,
    consents: ['b'],
    has_child_account: false,
    child_account_disabled: null,
    username: null,
    last_screening_at: null,
    last_screening_level: null,
    last_brushing_at: null,
    open_requests: 0,
    unseen_requests: 0,
    unviewed_proofs: 0,
    deletion_pending: false,
    ...over,
  };
}

const okAnswer = (data: unknown): RpcAnswer => ({ data, error: null, status: 200 });
const errAnswer = (code: string, message: string, status: number): RpcAnswer => ({ data: null, error: { code, message }, status });

let handlers: Record<string, (args: Record<string, unknown>) => RpcAnswer>;

function routeRpc() {
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    const handle = handlers[fn];
    return handle ? handle(args ?? {}) : errAnswer('PGRST202', 'not found', 404);
  });
}

const calls = (fn: string) => rpc.mock.calls.filter(([name]) => name === fn).map(([, args]) => args as Record<string, unknown>);
const l = () => useLocalData.getState();

let storage: ReturnType<typeof memoryBackend>;
let uninstall: () => void = () => {};

async function signIn(me: MyAccount, email = 'ortu@contoh.com') {
  useSession.setState({ status: 'signedIn', userId: me.userId, email });
  useAccount.setState({ userId: me.userId, me, status: 'ready', lastError: null });
  await Promise.all([l().setScope(me.userId), outbox.setScope(me.userId)]);
  l().applyAccount(me);
}

/** Lets debounced writers (setTimeout under fake timers) and their async writes run. */
async function settleWrites() {
  for (let i = 0; i < 5; i += 1) {
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    await new Promise((r) => setImmediate(r));
  }
}

const keysFor = (prefix: string) => [...storage.map.keys()].filter((k) => k.startsWith(prefix));

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
  await Promise.all([l().setScope(null), outbox.setScope(null)]);
  storage = memoryBackend();
  setStorageBackendForTests(storage);
  useSession.setState({ status: 'signedOut', userId: null, email: null });
  useAccount.setState({ userId: null, me: null, status: 'idle', lastError: null });
  useDeletionNotice.getState().dismiss();
  rpc.mockReset();
  mocked.supabase.auth.refreshSession.mockReset().mockResolvedValue({ data: { session: null }, error: { message: 'no' } });
  mocked.supabase.auth.signOut.mockClear();
  handlers = {
    request_deletion: () => okAnswer(REQUEST.toUpperCase()),
    list_children: () => okAnswer([wireRow(CHILD)]),
    sync_events: (args) =>
      okAnswer((args.batch as { event_id: string }[]).map((e, index) => ({ index, event_id: e.event_id, status: 'applied' }))),
  };
  routeRpc();
  uninstall = installSyncBridge();
});

afterEach(() => {
  uninstall();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

afterAll(async () => {
  await Promise.all([l().setScope(null), outbox.setScope(null)]);
  setStorageBackendForTests(null);
});

// ---------------------------------------------------------------------------------------------
// API wrapper
// ---------------------------------------------------------------------------------------------

describe('requestDeletion (SUPABASE_API.md §3.2)', () => {
  it('child scope sends p_scope + lower-cased p_child_id and returns the request id (lower case)', async () => {
    const res = await requestDeletion({ scope: 'child', childId: CHILD.toUpperCase() });
    expect(res).toEqual({ ok: true, data: REQUEST });
    expect(rpc).toHaveBeenCalledWith('request_deletion', { p_scope: 'child', p_child_id: CHILD });
  });

  it('account scope sends no p_child_id', async () => {
    await requestDeletion({ scope: 'account' });
    expect(calls('request_deletion')).toEqual([{ p_scope: 'account' }]);
  });

  it('refuses a malformed child id or scope locally', async () => {
    expect(await requestDeletion({ scope: 'child', childId: 'nope' })).toEqual({ ok: false, code: 'invalid_argument' });
    expect(await requestDeletion({ scope: 'everything' } as never)).toEqual({ ok: false, code: 'invalid_argument' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    [errAnswer('42501', 'forbidden', 403), 'forbidden'],
    [errAnswer('22023', 'child_id_not_allowed_for_account_scope', 400), 'invalid_argument'],
    [errAnswer('28000', 'not_authenticated', 401), 'not_authenticated'],
    [errAnswer('22P02', 'invalid input value for enum deletion_scope', 400), 'unknown'],
    [errAnswer('PGRST202', 'Could not find the function', 404), 'not_deployed'],
    [okAnswer('not-a-uuid'), 'bad_response'],
    [okAnswer(null), 'bad_response'],
  ])('maps %j to %s', async (answer, code) => {
    handlers.request_deletion = () => answer;
    const res = await requestDeletion({ scope: 'child', childId: CHILD });
    expect(res).toMatchObject({ ok: false, code });
  });

  it('a thrown transport error is a network failure', async () => {
    rpc.mockRejectedValueOnce(new Error('Network request failed'));
    expect(await requestDeletion({ scope: 'account' })).toEqual({ ok: false, code: 'network' });
  });
});

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

describe('helpers', () => {
  it('only guardian and teen accounts may delete', () => {
    expect(canRequestDeletion(guardian)).toBe(true);
    expect(canRequestDeletion(teen)).toBe(true);
    expect(canRequestDeletion(kidAccount)).toBe(false);
    expect(canRequestDeletion(null)).toBe(false);
  });

  it('selfProfileId: my_account() first, the local self profile as fallback, teens only', () => {
    expect(selfProfileId(teen, [])).toBe(SELF);
    expect(selfProfileId({ ...teen, selfChildId: null }, [kid(CHILD), kid(CHILD2, { isSelf: true })])).toBe(CHILD2);
    expect(selfProfileId(guardian, [kid(CHILD, { isSelf: true })])).toBeNull();
  });

  it('pending = list_children says so, or a rejected event did', () => {
    expect(isDeletionPending(CHILD, summary({ deletionPending: true }), {})).toBe(true);
    expect(isDeletionPending(CHILD, null, { [CHILD]: 'deletion_pending' })).toBe(true);
    expect(isDeletionPending(CHILD, summary(), { [CHILD]: 'other' })).toBe(false);
    expect(pendingElsewhere([summary({ deletionPending: true }), summary({ childId: CHILD2, deletionPending: true })], [CHILD])).toBe(1);
  });

  it('error copy per code, with a generic fallback', () => {
    expect(deletionErrorMessage('network')).toBe(id.deletion.errors.network);
    expect(deletionErrorMessage('bad_response')).toBe(id.deletion.errors.generic);
  });
});

// ---------------------------------------------------------------------------------------------
// Local clean-up hooks
// ---------------------------------------------------------------------------------------------

describe('local store', () => {
  beforeEach(async () => {
    await signIn(guardian);
  });

  it('forgetChild removes the child and its records and leaves a deletion_pending marker', () => {
    l().upsertChild(kid(CHILD));
    l().upsertChild(kid(CHILD2, { nickname: 'Kakak' }));
    l().setActiveChild(CHILD);
    l().setConsent(CHILD, 'a', true);
    l().addBrushing(CHILD, { durationS: 120 });
    l().addBrushing(CHILD2, { durationS: 90 });
    l().forgetChild(CHILD);
    expect(l().kids.map((k) => k.id)).toEqual([CHILD2]);
    expect(l().activeChildId).toBe(CHILD2);
    expect(l().brushing.map((b) => b.childId)).toEqual([CHILD2]);
    expect(l().consentRecords[CHILD]).toBeUndefined();
    expect(l().consents[CHILD]).toBeUndefined();
    expect(l().unsyncedChildren).not.toContain(CHILD);
    expect(l().syncBlocked[CHILD]).toBe('deletion_pending');
  });

  it('list_children: a forgotten or deleting child is not merged back; finished deletions leave the phone', () => {
    l().upsertChild(kid(CHILD2, { nickname: 'Kakak' }));
    l().forgetChild(CHILD);
    l().mergeServerChildren([summary({ deletionPending: true }), summary({ childId: CHILD2, deletionPending: true })]);
    expect(l().kids.map((k) => k.id)).toEqual([CHILD2]); // CHILD not re-added; CHILD2 still known
    expect(l().syncBlocked[CHILD2]).toBe('deletion_pending');
    // An unknown child that is being deleted (e.g. from another phone) is not brought here.
    const OTHER = 'c0c0c0c0-0000-4000-8000-000000000003';
    l().mergeServerChildren([summary({ childId: OTHER, deletionPending: true }), summary({ childId: CHILD2, deletionPending: true })]);
    expect(l().kids.map((k) => k.id)).toEqual([CHILD2]);
    // The server finished CHILD2: no longer listed -> its local copy goes too.
    l().addBrushing(CHILD2, { durationS: 60 });
    l().mergeServerChildren([]);
    expect(l().kids).toEqual([]);
    expect(l().brushing).toEqual([]);
    expect(l().activeChildId).toBeNull();
  });

  it('deleteScopeData of the current scope removes the stored copy and writes nothing afterwards', async () => {
    l().upsertChild(kid());
    await l().flushWrites();
    expect(keysFor(LOCAL_STORAGE_PREFIX + GUARDIAN).length).toBeGreaterThan(0);
    await l().deleteScopeData(GUARDIAN);
    expect(l().kids).toEqual([]);
    l().upsertChild(kid(CHILD2)); // memory only from now on
    await l().setScope(null);
    await settleWrites();
    expect(keysFor(LOCAL_STORAGE_PREFIX + GUARDIAN)).toEqual([]);
  });
});

describe('outbox', () => {
  beforeEach(async () => {
    await signIn(guardian);
    l().upsertChild(kid(CHILD));
    l().upsertChild(kid(CHILD2));
    l().setConsent(CHILD, 'b', true);
    l().setConsent(CHILD2, 'b', true);
  });

  it('purgeChild drops every queued event of the child, consents included', () => {
    expect(outbox.findByRef(syncRefs.consent(CHILD, 'b', 'grant'))).toHaveLength(1);
    expect(outbox.purgeChild(CHILD)).toBeGreaterThanOrEqual(2);
    expect([...outbox.refs()].filter((r) => r.includes(CHILD))).toEqual([]);
    expect(outbox.findByRef(syncRefs.consent(CHILD2, 'b', 'grant'))).toHaveLength(1);
  });

  it('deleteScopeData of the current scope disables the queue and removes it from storage', async () => {
    await settleWrites();
    expect(keysFor(OUTBOX_STORAGE_PREFIX + GUARDIAN).length).toBeGreaterThan(0);
    await outbox.deleteScopeData(GUARDIAN);
    expect(outbox.scope).toBeNull();
    expect(outbox.pendingCount()).toBe(0);
    await settleWrites();
    expect(keysFor(OUTBOX_STORAGE_PREFIX + GUARDIAN)).toEqual([]);
  });

  it('a deletion_pending rejection stops the child and drops its queued consents too', async () => {
    handlers.sync_events = (args) =>
      okAnswer(
        (args.batch as { event_id: string; payload: { child_id: string } }[]).map((e, index) => ({
          index,
          event_id: e.event_id,
          ...(e.payload.child_id === CHILD ? { status: 'rejected', code: 'deletion_pending' } : { status: 'applied' }),
        })),
      );
    await outbox.flush();
    expect(l().syncBlocked[CHILD]).toBe('deletion_pending');
    expect([...outbox.refs()].filter((r) => r.includes(CHILD))).toEqual([]);
    expect(outbox.needsAttention()).toEqual([]);
  });
});

describe('proof uploads: deleteChildData', () => {
  const USER = TEEN;
  const PROOF_A = 'aaaaaaaa-0000-4000-8000-000000000001';
  const PROOF_B = 'aaaaaaaa-0000-4000-8000-000000000002';

  function fakeFiles(): ProofFiles & { files: Set<string> } {
    const files = new Set<string>();
    return {
      files,
      destination: (userId, name) => `file:///docs/${userId}/${name}`,
      size: (uri) => (files.has(uri) ? 10 : null),
      move: async (from, to) => {
        if (!files.delete(from)) return false;
        files.add(to);
        return true;
      },
      remove: (uri) => void files.delete(uri),
      list: (userId) => [...files].filter((f) => f.startsWith(`file:///docs/${userId}/`)),
      removeAll: (userId) => {
        for (const f of [...files]) if (f.startsWith(`file:///docs/${userId}/`)) files.delete(f);
      },
      upload: () => ({ promise: new Promise(() => {}), cancel: () => {} }),
    };
  }

  const input = (proofId: string, childId: string): EnqueueProofInput => ({
    userId: USER,
    proofId,
    eventId: proofId.replace('aaaaaaaa', 'eeeeeeee'),
    childId,
    ownerId: USER,
    audience: 'self',
    mime: 'video/mp4',
    sourceUri: `file:///cache/${proofId}.mp4`,
    sizeBytes: 10,
    durationS: 60,
  });

  it('removes only that child’s uploads and clips', async () => {
    const files = fakeFiles();
    files.files.add(`file:///cache/${PROOF_A}.mp4`);
    files.files.add(`file:///cache/${PROOF_B}.mp4`);
    const queue = new ProofUploadQueue({
      files,
      storage: memoryBackend(),
      outbox: { scope: USER, getEventState: () => 'pending', getEntry: () => null, subscribe: () => () => {}, whenReady: async () => {} },
      autoRun: false,
    });
    await queue.setScope(USER);
    await queue.enqueue(input(PROOF_A, SELF));
    await queue.enqueue(input(PROOF_B, CHILD));
    expect(queue.deleteChildData(SELF.toUpperCase())).toBe(1);
    expect(queue.items().map((i) => i.proofId)).toEqual([PROOF_B]);
    expect([...files.files]).toEqual([`file:///docs/${USER}/${PROOF_B}.mp4`]);
    expect(queue.deleteChildData(SELF)).toBe(0);
    queue.dispose();
  });
});

// ---------------------------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------------------------

describe('requestChildDeletion', () => {
  it('guardian: the server accepts -> the child, its records and its queued events leave this phone', async () => {
    await signIn(guardian);
    l().upsertChild(kid(CHILD));
    l().upsertChild(kid(CHILD2));
    l().setConsent(CHILD, 'b', true);
    l().addBrushing(CHILD, { durationS: 120 });
    const proofs = jest.spyOn(proofUploads, 'deleteChildData');
    const res = await requestChildDeletion(CHILD);
    expect(res).toEqual({ ok: true, requestId: REQUEST });
    expect(calls('request_deletion')).toEqual([{ p_scope: 'child', p_child_id: CHILD }]);
    expect(l().kids.map((k) => k.id)).toEqual([CHILD2]);
    expect(l().brushing).toEqual([]);
    expect(l().syncBlocked[CHILD]).toBe('deletion_pending');
    expect([...outbox.refs()].filter((r) => r.includes(CHILD))).toEqual([]);
    expect(proofs).toHaveBeenCalledWith(CHILD);
    // Nothing is queued for it any more.
    l().setConsent(CHILD, 'a', true);
    expect([...outbox.refs()].filter((r) => r.includes(CHILD))).toEqual([]);
  });

  it('a failed request changes nothing on this phone', async () => {
    await signIn(guardian);
    l().upsertChild(kid(CHILD));
    l().setConsent(CHILD, 'b', true);
    rpc.mockImplementation(async () => {
      throw new Error('Network request failed');
    });
    const res = await requestChildDeletion(CHILD);
    expect(res).toEqual({ ok: false, code: 'network' });
    expect(l().kids.map((k) => k.id)).toEqual([CHILD]);
    expect(l().syncBlocked[CHILD]).toBeUndefined();
    expect(outbox.findByRef(syncRefs.consent(CHILD, 'b', 'grant'))).toHaveLength(1);
  });

  it('a child the server never had (forbidden, not listed) is deleted on this phone only', async () => {
    await signIn(guardian);
    l().upsertChild(kid(CHILD2));
    handlers.request_deletion = () => errAnswer('42501', 'forbidden', 403);
    handlers.list_children = () => okAnswer([wireRow(CHILD)]);
    const res = await requestChildDeletion(CHILD2);
    expect(res).toEqual({ ok: true, requestId: null });
    expect(l().kids).toEqual([]);
  });

  it('forbidden for a child the server lists stays an error', async () => {
    await signIn(guardian);
    l().upsertChild(kid(CHILD));
    handlers.request_deletion = () => errAnswer('42501', 'forbidden', 403);
    expect(await requestChildDeletion(CHILD)).toEqual({ ok: false, code: 'forbidden', status: 403 });
    expect(l().kids.map((k) => k.id)).toEqual([CHILD]);
  });

  it('teen: only the self profile; an empty self profile stays (blocked) while the server works', async () => {
    await signIn(teen, 'remaja@contoh.com');
    l().ensureSelfProfile({ childId: SELF, birthYear: 2010, birthMonth: 5, nickname: 'Aku' });
    l().addBrushing(SELF, { durationS: 120 });
    expect(await requestChildDeletion(CHILD)).toEqual({ ok: false, code: 'forbidden' });
    expect(rpc).not.toHaveBeenCalled();
    const res = await requestChildDeletion(SELF);
    expect(res).toEqual({ ok: true, requestId: REQUEST });
    expect(l().kids).toEqual([{ id: SELF, nickname: '', birthYear: null, birthMonth: null, allergies: [], isSelf: true }]);
    expect(l().brushing).toEqual([]);
    expect(l().syncBlocked[SELF]).toBe('deletion_pending');
  });

  it('child accounts never call request_deletion', async () => {
    await signIn(kidAccount, '');
    expect(await requestChildDeletion(CHILD)).toEqual({ ok: false, code: 'forbidden' });
    expect(await requestAccountDeletion()).toEqual({ ok: false, code: 'forbidden' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('requestAccountDeletion', () => {
  it('the server accepts -> every store of the user leaves this phone, then sign-out with a notice', async () => {
    await signIn(guardian);
    await rememberParentEmail('Ortu@Contoh.com');
    l().upsertChild(kid(CHILD));
    l().setConsent(CHILD, 'b', true);
    await l().flushWrites();
    await settleWrites();
    useAccount.setState({ me: guardian });
    await appStorage.setItem(`dentisai.account.${GUARDIAN}`, '{}');
    const proofs = jest.spyOn(proofUploads, 'deleteScopeData').mockResolvedValue();

    const res = await requestAccountDeletion();
    expect(res).toEqual({ ok: true, data: REQUEST });
    expect(calls('request_deletion')).toEqual([{ p_scope: 'account' }]);
    expect(proofs).toHaveBeenCalledWith(GUARDIAN);
    expect(useSession.getState()).toMatchObject({ status: 'signedOut', userId: null });
    expect(mocked.supabase.auth.signOut).toHaveBeenCalled();
    expect(useDeletionNotice.getState().accountDeleted).toBe(true);
    expect(await getRememberedParentEmail()).toBeNull();

    await settleWrites();
    expect(keysFor(LOCAL_STORAGE_PREFIX + GUARDIAN)).toEqual([]);
    expect(keysFor(OUTBOX_STORAGE_PREFIX + GUARDIAN)).toEqual([]);
    expect(keysFor(`dentisai.account.${GUARDIAN}`)).toEqual([]);
    expect(outbox.scope).toBeNull();
  });

  it('another remembered parent email is kept', async () => {
    await signIn(guardian);
    await rememberParentEmail('lain@contoh.com');
    jest.spyOn(proofUploads, 'deleteScopeData').mockResolvedValue();
    await requestAccountDeletion();
    expect(await getRememberedParentEmail()).toBe('lain@contoh.com');
  });

  it('a failed request keeps the account, the data and the session', async () => {
    await signIn(teen, 'remaja@contoh.com');
    l().ensureSelfProfile({ childId: SELF, birthYear: 2010, birthMonth: 5, nickname: 'Aku' });
    handlers.request_deletion = () => errAnswer('28000', 'not_authenticated', 401);
    const proofs = jest.spyOn(proofUploads, 'deleteScopeData');
    const res = await requestAccountDeletion();
    expect(res).toMatchObject({ ok: false, code: 'not_authenticated' });
    // The session was refreshed once before giving up.
    expect(mocked.supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(proofs).not.toHaveBeenCalled();
    expect(useSession.getState().status).toBe('signedIn');
    expect(l().kids.map((k) => k.id)).toEqual([SELF]);
    expect(useDeletionNotice.getState().accountDeleted).toBe(false);
  });
});
