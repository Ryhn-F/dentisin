// sync_events outbox state machine (src/core/sync/outbox.ts) with a mocked supabase.rpc and an
// in-memory storage backend: results, retries, backoff, auth refresh, pauses, dependencies,
// FIFO, batching, persistence, purge and scope switches (SYNC_EVENTS.md §2, §4–§6).
import { setStorageBackendForTests, type KeyValueBackend } from '@/core/auth/secure-storage';
import {
  buildBrushingProofRegistered,
  buildBrushingRecorded,
  buildConsentChanged,
  buildScreeningRecorded,
  type BuiltEvent,
} from '@/core/sync/events';
import { BACKOFF_BASE_MS, Outbox, UNAVAILABLE_RETRY_MS, backoffDelay, type OutboxNotice } from '@/core/sync/outbox';
import { newUuid } from '@/core/util/uuid';

jest.mock('@/core/auth/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { refreshSession: jest.fn(), signOut: jest.fn(), getSession: jest.fn(), onAuthStateChange: jest.fn() },
  },
}));

type WireEvent = { event_id: string; type: string; payload: unknown };
const mocked = jest.requireMock('@/core/auth/supabase') as {
  supabase: { rpc: jest.Mock; auth: { refreshSession: jest.Mock } };
};
const rpc = mocked.supabase.rpc;
const refreshSession = mocked.supabase.auth.refreshSession;

const UID = '0b0b0b0b-0000-4000-8000-000000000001';
const UID2 = '0b0b0b0b-0000-4000-8000-000000000002';
const CHILD_A = 'c0c0c0c0-0000-4000-8000-00000000000a';
const CHILD_B = 'c0c0c0c0-0000-4000-8000-00000000000b';

let store: Map<string, string>;
function memoryBackend(): KeyValueBackend {
  store = new Map();
  return {
    getItem: async (k) => store.get(k) ?? null,
    setItem: async (k, v) => void store.set(k, v),
    removeItem: async (k) => void store.delete(k),
  };
}

let clock = Date.parse('2026-10-18T05:00:00Z');
let currentUser: string | null = UID;

function makeOutbox(over: Partial<ConstructorParameters<typeof Outbox>[0]> = {}) {
  return new Outbox({ autoFlush: false, now: () => clock, random: () => 0.5, currentUserId: () => currentUser, ...over });
}

function brushing(childId = CHILD_A, id = newUuid()): BuiltEvent {
  return buildBrushingRecorded(
    { id, childId, startedAt: new Date(clock - 3600_000).toISOString(), durationS: 120, spiritScore: null, slot: 'other', cameraMode: false },
    { now: clock },
  );
}

function grant(childId = CHILD_A): BuiltEvent {
  return buildConsentChanged({ childId, consentType: 'b', action: 'grant', textVersion: 'consent-b-v0.2-draft-id' }, { now: clock });
}

function screening(childId = CHILD_A): BuiltEvent {
  return buildScreeningRecorded(
    {
      id: newUuid(),
      childId,
      screenedAt: new Date(clock).toISOString(),
      modelVersion: null,
      rulesVersion: '0.2.0-draft',
      level: 'routine',
      redFlag: false,
      findings: [],
      requestId: null,
    },
    { now: clock },
  );
}

/** Server stub: every event applied unless `decide` says otherwise. */
function serverAnswers(decide: (e: WireEvent, i: number) => { status: string; code?: string } = () => ({ status: 'applied' })) {
  rpc.mockImplementation(async (_fn: string, args: { batch: WireEvent[] }) => ({
    data: args.batch.map((e, i) => ({ index: i, event_id: e.event_id, ...decide(e, i) })),
    error: null,
    status: 200,
  }));
}

function sentBatches(): WireEvent[][] {
  return rpc.mock.calls.map((c) => (c[1] as { batch: WireEvent[] }).batch);
}

beforeEach(() => {
  setStorageBackendForTests(memoryBackend());
  rpc.mockReset();
  refreshSession.mockReset();
  clock = Date.parse('2026-10-18T05:00:00Z');
  currentUser = UID;
});

afterAll(() => setStorageBackendForTests(null));

describe('results', () => {
  it('applied: sends the exact payload text, removes the entry and remembers it', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    const notices: OutboxNotice[] = [];
    box.subscribe((n) => notices.push(n));
    const a = brushing();
    const b = brushing(CHILD_B);
    expect(box.enqueue([{ ...a, ref: 'brushing:a' }, b])).toEqual([a.eventId, b.eventId]);
    serverAnswers();

    const res = await box.flush();
    expect(res).toMatchObject({ sent: 2, applied: 2, rejected: 0, stopped: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('sync_events');
    const [batch] = sentBatches();
    expect(batch.map((e) => e.event_id)).toEqual([a.eventId, b.eventId]);
    expect(Object.keys(batch[0]).sort()).toEqual(['event_id', 'payload', 'type']);
    expect(JSON.stringify(batch[0].payload)).toBe(a.payloadJson);
    expect(box.getEventState(a.eventId)).toBe('applied');
    expect(box.pendingCount()).toBe(0);
    expect(box.getStatus()).toMatchObject({ pending: 0, rejected: 0, lastSuccessAt: clock });
    expect(notices).toContainEqual(expect.objectContaining({ kind: 'entry', eventId: a.eventId, ref: 'brushing:a', state: 'applied' }));
    await expect(box.waitForEvent(a.eventId, 10)).resolves.toEqual({ state: 'applied' });
  });

  it('rejected: terminal with its code, listed as needing attention, never resent', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    const a = brushing();
    box.enqueue(a);
    serverAnswers(() => ({ status: 'rejected', code: 'consent_required' }));
    expect(await box.flush()).toMatchObject({ rejected: 1 });
    expect(box.getEventState(a.eventId)).toBe('rejected');
    expect(box.needsAttention()).toEqual([expect.objectContaining({ eventId: a.eventId, state: 'rejected', code: 'consent_required' })]);
    expect(box.getStatus().rejected).toBe(1);
    await expect(box.waitForEvent(a.eventId, 10)).resolves.toEqual({ state: 'rejected', code: 'consent_required' });

    await box.flush();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(box.dismiss(a.eventId)).toBe(true);
    expect(box.needsAttention()).toEqual([]);
  });

  it('dismiss with giveUp remembers the ref (persisted per user) until it is forgotten', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    const a = brushing();
    const b = brushing();
    box.enqueue([{ ...a, ref: 'brushing:a' }, { ...b, ref: 'brushing:b' }]);
    serverAnswers(() => ({ status: 'rejected', code: 'schema_invalid' }));
    await box.flush();

    expect(box.dismiss(a.eventId, { giveUp: true })).toBe(true);
    expect(box.dismiss(b.eventId)).toBe(true); // a plain dismiss gives nothing up
    expect(box.isGivenUp('brushing:a')).toBe(true);
    expect(box.isGivenUp('brushing:b')).toBe(false);
    expect(box.givenUp()).toEqual([{ ref: 'brushing:a', childId: CHILD_A, code: 'schema_invalid', at: clock }]);

    // Survives a restart of the same user's queue; another user does not see it.
    await box.setScope(UID2);
    expect(box.isGivenUp('brushing:a')).toBe(false);
    const reloaded = makeOutbox();
    await reloaded.setScope(UID);
    expect(reloaded.isGivenUp('brushing:a')).toBe(true);

    expect(reloaded.forgetGivenUp((g) => g.ref === 'brushing:a')).toBe(1);
    expect(reloaded.isGivenUp('brushing:a')).toBe(false);
    await reloaded.deleteScopeData(UID);
  });

  it('internal_error: retried with the same event id and payload after a backoff', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    const a = brushing();
    box.enqueue(a);
    serverAnswers(() => ({ status: 'rejected', code: 'internal_error' }));
    expect(await box.flush()).toMatchObject({ retried: 1, rejected: 0 });
    expect(box.getEntry(a.eventId)).toMatchObject({ state: 'pending', attempts: 1, nextAttemptAt: clock + BACKOFF_BASE_MS });

    await box.flush(); // not due yet
    expect(rpc).toHaveBeenCalledTimes(1);

    clock += BACKOFF_BASE_MS;
    serverAnswers();
    expect(await box.flush()).toMatchObject({ applied: 1 });
    const [first, second] = sentBatches();
    expect(second[0].event_id).toBe(first[0].event_id);
    expect(JSON.stringify(second[0].payload)).toBe(JSON.stringify(first[0].payload));
  });

  it('a malformed answer (wrong length) is a server failure: nothing is confirmed', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    box.enqueue([brushing(), brushing()]);
    rpc.mockResolvedValue({ data: [{ index: 0, status: 'applied' }], error: null, status: 200 });
    expect(await box.flush()).toMatchObject({ stopped: 'server', applied: 0 });
    expect(box.pendingCount()).toBe(2);
    expect(box.getStatus().backoffReason).toBe('server');
  });
});

describe('call-level failures', () => {
  it('network: exponential backoff (30 s, 1 min), entries stay pending; foreground retries now', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    const a = brushing();
    box.enqueue(a);
    rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 });

    expect(await box.flush()).toMatchObject({ stopped: 'network' });
    expect(box.getEntry(a.eventId)).toMatchObject({ state: 'pending', attempts: 1 });
    expect(box.getStatus()).toMatchObject({ backoffReason: 'network', nextAttemptAt: clock + 30_000 });

    expect(await box.flush()).toMatchObject({ stopped: 'network', sent: 0 }); // still backing off
    expect(rpc).toHaveBeenCalledTimes(1);

    clock += 30_000;
    await box.flush();
    expect(box.getStatus().nextAttemptAt).toBe(clock + 60_000);

    serverAnswers();
    expect(await box.flush({ ignoreBackoff: true })).toMatchObject({ applied: 1 });
    expect(box.getStatus()).toMatchObject({ backoffReason: null, pending: 0 });
  });

  it('a thrown transport error (timeout) counts as network', async () => {
    const box = makeOutbox({ transport: async () => Promise.reject(new Error('timeout')) });
    await box.setScope(UID);
    box.enqueue(brushing());
    expect(await box.flush()).toMatchObject({ stopped: 'network' });
  });

  it('backoff grows to a 1 h cap with jitter', () => {
    expect([1, 2, 3, 4, 5].map((n) => backoffDelay(n, () => 0.5))).toEqual([30_000, 60_000, 120_000, 240_000, 480_000]);
    expect(backoffDelay(30, () => 0.5)).toBe(3_600_000);
    expect(backoffDelay(30, () => 1)).toBe(3_600_000);
    expect(backoffDelay(1, () => 0)).toBe(22_500);
    expect(backoffDelay(1, () => 1)).toBe(37_500);
  });

  it('429 honours Retry-After and is not skipped by a foreground retry', async () => {
    const transport = jest.fn(async () => ({ data: null, error: { message: 'Too Many Requests' }, status: 429, retryAfterS: 600 }));
    const box = makeOutbox({ transport });
    await box.setScope(UID);
    box.enqueue(brushing());
    expect(await box.flush()).toMatchObject({ stopped: 'rate_limited' });
    expect(box.getStatus()).toMatchObject({ backoffReason: 'rate_limited', nextAttemptAt: clock + 600_000 });
    expect(await box.flush({ ignoreBackoff: true })).toMatchObject({ stopped: 'rate_limited', sent: 0 });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('401: refreshes the session once, then retries the same batch', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    const a = brushing();
    box.enqueue(a);
    serverAnswers();
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST303', message: 'JWT expired' }, status: 401 });
    refreshSession.mockResolvedValue({ data: { session: { user: { id: UID } } }, error: null });

    expect(await box.flush()).toMatchObject({ applied: 1, stopped: null });
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(sentBatches().map((b) => b[0].event_id)).toEqual([a.eventId, a.eventId]);
  });

  it('401 with a failing refresh pauses (auth_required) and keeps the queue', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    box.enqueue(brushing());
    rpc.mockResolvedValue({ data: null, error: { code: '28000', message: 'not_authenticated' }, status: 401 });
    refreshSession.mockResolvedValue({ data: { session: null }, error: { name: 'AuthApiError', status: 400, message: 'Invalid Refresh Token' } });

    expect(await box.flush()).toMatchObject({ stopped: 'auth_required' });
    expect(box.getStatus()).toMatchObject({ pauseReason: 'auth_required', pending: 1 });
    expect(await box.flush()).toMatchObject({ stopped: 'auth_required', sent: 0 });
    expect(rpc).toHaveBeenCalledTimes(1);

    // Foreground: try again (the user may have signed in again meanwhile).
    serverAnswers();
    expect(await box.flush({ ignoreBackoff: true })).toMatchObject({ applied: 1 });
  });

  it('401 with no signal for the refresh backs off as network', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    box.enqueue(brushing());
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST301', message: 'JWT' }, status: 401 });
    refreshSession.mockResolvedValue({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 0, message: 'fetch' } });
    expect(await box.flush()).toMatchObject({ stopped: 'network' });
  });

  it('PGRST202 (sync_events not deployed) pauses as unavailable and retries later', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    box.enqueue(brushing());
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 });
    expect(await box.flush()).toMatchObject({ stopped: 'unavailable' });
    expect(box.getStatus()).toMatchObject({ pauseReason: 'unavailable', nextAttemptAt: clock + UNAVAILABLE_RETRY_MS });
    expect(await box.flush({ ignoreBackoff: true })).toMatchObject({ stopped: 'unavailable', sent: 0 });

    clock += UNAVAILABLE_RETRY_MS;
    serverAnswers();
    expect(await box.flush()).toMatchObject({ applied: 1 });
    expect(box.getStatus().pauseReason).toBeNull();
  });

  it('22023 batch_size_out_of_range halves the batch until the server accepts it', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    const events = Array.from({ length: 30 }, (_, i) => brushing(i % 2 ? CHILD_A : CHILD_B));
    box.enqueue(events);
    rpc.mockImplementation(async (_fn: string, args: { batch: WireEvent[] }) =>
      args.batch.length > 10
        ? { data: null, error: { code: '22023', message: 'batch_size_out_of_range' }, status: 400 }
        : { data: args.batch.map((e, i) => ({ index: i, event_id: e.event_id, status: 'applied' })), error: null, status: 200 },
    );
    expect(await box.flush()).toMatchObject({ applied: 30, stopped: null });
    expect(sentBatches().map((b) => b.length)).toEqual([30, 15, 7, 7, 7, 7, 2]);
  });
});

describe('batches, ordering and dependencies', () => {
  it('splits into batches of at most 50 events', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    box.enqueue(Array.from({ length: 120 }, (_, i) => brushing(i % 2 ? CHILD_A : CHILD_B)));
    serverAnswers();
    expect(await box.flush()).toMatchObject({ applied: 120 });
    expect(sentBatches().map((b) => b.length)).toEqual([50, 50, 20]);
  });

  it('sends a dependent in the same batch right after its dependency', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    const consent = grant();
    const data = brushing();
    box.enqueue([consent, { ...data, dependsOn: [consent.eventId] }]);
    serverAnswers();
    await box.flush();
    expect(sentBatches()).toHaveLength(1);
    expect(sentBatches()[0].map((e) => e.event_id)).toEqual([consent.eventId, data.eventId]);
  });

  it('holds a dependent until its dependency is applied in an earlier batch', async () => {
    const box = makeOutbox({ maxBatch: 1 });
    await box.setScope(UID);
    const consent = grant();
    const data = brushing();
    box.enqueue([consent, { ...data, dependsOn: [consent.eventId] }]);
    // First answer: internal_error for the consent -> the dependent must wait.
    rpc.mockResolvedValueOnce({ data: [{ index: 0, event_id: consent.eventId, status: 'rejected', code: 'internal_error' }], error: null, status: 200 });
    await box.flush();
    expect(sentBatches().flat().map((e) => e.event_id)).toEqual([consent.eventId]);
    expect(box.getEventState(data.eventId)).toBe('pending');

    clock += BACKOFF_BASE_MS;
    serverAnswers();
    await box.flush();
    expect(sentBatches().map((b) => b.map((e) => e.event_id))).toEqual([[consent.eventId], [consent.eventId], [data.eventId]]);
  });

  it('a rejected dependency holds its dependents (transitively) with dependency_rejected', async () => {
    const box = makeOutbox({ maxBatch: 1 });
    await box.setScope(UID);
    const consent = grant();
    const brush = brushing();
    const proof = buildBrushingProofRegistered(
      { proofId: newUuid(), childId: CHILD_A, brushingEventId: newUuid(), sizeBytes: 1000, durationS: 30, mime: 'video/mp4' },
      { now: clock },
    );
    box.enqueue([consent, { ...brush, dependsOn: [consent.eventId] }, { ...proof, dependsOn: [brush.eventId] }]);
    const waiting = box.waitForEvent(proof.eventId, 1000);
    serverAnswers(() => ({ status: 'rejected', code: 'deletion_pending' }));
    await box.flush();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(box.getEntry(brush.eventId)).toMatchObject({ state: 'held', code: 'dependency_rejected' });
    expect(box.getEntry(proof.eventId)).toMatchObject({ state: 'held', code: 'dependency_rejected' });
    await expect(waiting).resolves.toEqual({ state: 'held', code: 'dependency_rejected' });
    expect(box.getStatus()).toMatchObject({ rejected: 1, held: 2, pending: 0 });

    // A new event that depends on the rejected one starts held.
    const late = brushing();
    box.enqueue({ ...late, dependsOn: [consent.eventId] });
    expect(box.getEventState(late.eventId)).toBe('held');
  });

  it('entity_conflict does not hold dependents (the entity exists on the server)', async () => {
    const box = makeOutbox({ maxBatch: 1 });
    await box.setScope(UID);
    const brush = brushing();
    const next = screening();
    box.enqueue([brush, { ...next, dependsOn: [brush.eventId] }]);
    serverAnswers((e) => (e.event_id === brush.eventId ? { status: 'rejected', code: 'entity_conflict' } : { status: 'applied' }));
    await box.flush();
    expect(box.getEventState(next.eventId)).toBe('applied');
  });

  it('keeps FIFO per child: a waiting event holds back later events of the same child only', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    const a1 = brushing(CHILD_A);
    const a2 = brushing(CHILD_A);
    const b1 = brushing(CHILD_B);
    box.enqueue([a1, a2, b1]);
    serverAnswers((e) => (e.event_id === a1.eventId ? { status: 'rejected', code: 'internal_error' } : { status: 'applied' }));
    await box.flush(); // a1 internal_error; a2 and b1 applied in the same batch
    rpc.mockClear();

    const a3 = brushing(CHILD_A);
    const b2 = brushing(CHILD_B);
    box.enqueue([a3, b2]);
    serverAnswers();
    await box.flush();
    expect(sentBatches()[0].map((e) => e.event_id)).toEqual([b2.eventId]); // a3 waits behind a1
    expect(box.getEventState(a3.eventId)).toBe('pending');
  });

  it('single-flight: concurrent flushes share one call', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    box.enqueue(brushing());
    let release: (v: unknown) => void = () => {};
    rpc.mockImplementation(
      (_fn: string, args: { batch: WireEvent[] }) =>
        new Promise((resolve) => {
          release = () =>
            resolve({ data: args.batch.map((e, i) => ({ index: i, event_id: e.event_id, status: 'applied' })), error: null, status: 200 });
        }),
    );
    const first = box.flush();
    const second = box.flush();
    expect(second).toBe(first);
    await new Promise((r) => setTimeout(r, 0));
    expect(box.getStatus().syncing).toBe(true);
    release(null);
    await Promise.all([first, second]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(box.getStatus().syncing).toBe(false);
  });

  it('only sends with the session of the queue owner', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    box.enqueue(brushing());
    currentUser = UID2;
    expect(await box.flush()).toMatchObject({ stopped: 'scope_changed', sent: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('persistence, purge and scope', () => {
  it('round-trips the queue through storage; in-flight events come back as pending', async () => {
    const a = brushing();
    const r = brushing(CHILD_B);
    let calls = 0;
    // First call: internal_error for `a`, forbidden for `r`. Second call never answers, so `a`
    // is in flight when the app "dies".
    const box = makeOutbox({
      transport: (batch) => {
        calls += 1;
        if (calls > 1) return new Promise(() => {});
        return Promise.resolve({
          data: batch.map((e) => ({
            event_id: e.event_id,
            status: 'rejected',
            code: e.event_id === r.eventId ? 'forbidden' : 'internal_error',
          })),
          error: null,
          status: 200,
        });
      },
    });
    await box.setScope(UID);
    box.enqueue([{ ...a, ref: 'brushing:x', dependsOn: [] }, r]);
    await box.flush();
    clock += BACKOFF_BASE_MS;
    void box.flush();
    await new Promise((res) => setTimeout(res, 0));
    expect(box.getEventState(a.eventId)).toBe('inflight');
    await box.setScope(null); // writes the queue out

    const restored = makeOutbox();
    await restored.setScope(UID);
    expect(restored.getEntry(a.eventId)).toMatchObject({
      payloadJson: a.payloadJson,
      state: 'pending',
      attempts: 2,
      ref: 'brushing:x',
      type: 'brushing_recorded',
      childId: CHILD_A,
    });
    expect(restored.getEntry(r.eventId)).toMatchObject({ state: 'rejected', code: 'forbidden' });
    // Nothing readable is stored in the clear by this layer beyond the queue itself.
    expect([...store.keys()].every((k) => k.startsWith('dentisai.outbox.v1.'))).toBe(true);
  });

  it('remembers recently applied events across restarts', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    const a = brushing();
    box.enqueue(a);
    serverAnswers();
    await box.flush();
    await box.setScope(null);
    const restored = makeOutbox();
    await restored.setScope(UID);
    expect(restored.getEventState(a.eventId)).toBe('applied');
    expect(restored.enqueue(a)).toEqual([a.eventId]); // not queued twice
    expect(restored.pendingCount()).toBe(0);
  });

  it('ignores corrupt stored data', async () => {
    store.set('dentisai.outbox.v1.' + UID + '.cur.n', '1');
    store.set('dentisai.outbox.v1.' + UID + '.cur.0', 'a');
    store.set('dentisai.outbox.v1.' + UID + '.a.n', '1');
    store.set('dentisai.outbox.v1.' + UID + '.a.0', '{"v":1,"entries":[{"eventId":"x"}],"applied":"no"}');
    const box = makeOutbox();
    await box.setScope(UID);
    expect(box.getStatus()).toMatchObject({ ready: true, pending: 0 });
  });

  it('purgeChildData drops that child\'s data events and keeps consent events', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    const notices: OutboxNotice[] = [];
    box.subscribe((n) => notices.push(n));
    const consent = grant(CHILD_A);
    const a1 = brushing(CHILD_A);
    const a2 = screening(CHILD_A);
    const b1 = brushing(CHILD_B);
    box.enqueue([consent, a1, a2, b1]);
    expect(box.purgeChildData(CHILD_A)).toBe(2);
    expect(box.getEventState(consent.eventId)).toBe('pending');
    expect(box.getEventState(a1.eventId)).toBeNull();
    expect(box.getEventState(a2.eventId)).toBeNull();
    expect(box.getEventState(b1.eventId)).toBe('pending');
    expect(notices.filter((n) => n.kind === 'entry' && n.state === 'dropped')).toHaveLength(2);
    await expect(box.waitForEvent(a1.eventId, 10)).resolves.toEqual({ state: 'unknown' });
  });

  it('switching scope keeps each user\'s queue separate; no scope = disabled', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    const mine = brushing();
    box.enqueue(mine);

    await box.setScope(UID2);
    expect(box.getEventState(mine.eventId)).toBeNull();
    const theirs = brushing(CHILD_B);
    box.enqueue(theirs);

    await box.setScope(UID);
    expect(box.getEventState(mine.eventId)).toBe('pending');
    expect(box.getEventState(theirs.eventId)).toBeNull();

    await box.setScope(null);
    expect(box.enqueue(brushing())).toEqual([]);
    expect(await box.flush()).toMatchObject({ stopped: 'disabled' });
    expect(box.getStatus()).toMatchObject({ scope: null, pending: 0 });
  });

  it('keeps events queued while the scope is still loading', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    const stored = brushing();
    box.enqueue(stored);
    await box.setScope(null);

    const next = makeOutbox();
    const loading = next.setScope(UID);
    const early = brushing();
    next.enqueue(early);
    await loading;
    expect([next.getEventState(stored.eventId), next.getEventState(early.eventId)]).toEqual(['pending', 'pending']);
    serverAnswers();
    await next.flush();
    expect(sentBatches()[0].map((e) => e.event_id)).toEqual([stored.eventId, early.eventId]);
  });

  it('waitForEvent times out while the event waits', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    const a = brushing();
    box.enqueue(a);
    await expect(box.waitForEvent(a.eventId, 5)).resolves.toEqual({ state: 'timeout' });
    await expect(box.waitForEvent(newUuid(), 5)).resolves.toEqual({ state: 'unknown' });
  });

  it('refuses malformed input instead of queueing it', async () => {
    const box = makeOutbox();
    await box.setScope(UID);
    const a = brushing();
    expect(box.enqueue({ ...a, payloadJson: '{"child_id":"x"}' })).toEqual([]);
    expect(box.enqueue({ ...a, eventId: 'nope' })).toEqual([]);
    expect(box.pendingCount()).toBe(0);
  });
});
