import type { KeyValueBackend } from '@/core/auth/secure-storage';
import type { OutboxEntry, OutboxEntryState, OutboxNotice } from '@/core/sync/outbox';
import { expoProofFiles } from '@/features/brushing/proof-files';
import {
  PROOF_UPLOADS_STORAGE_PREFIX,
  ProofUploadQueue,
  classifyUploadResponse,
  failureForRejection,
  proofObjectPath,
  type AuthPort,
  type EnqueueProofInput,
  type ProofUploadsSnapshot,
} from '@/features/brushing/proof-uploads';

// ---------------------------------------------------------------------------------------------
// In-memory expo-file-system (SDK 57 object API): File / Directory / Paths / upload task.
// ---------------------------------------------------------------------------------------------

type UploadCall = {
  uri: string;
  url: string;
  options: { httpMethod?: string; uploadType?: number; headers?: Record<string, string>; mimeType?: string; onProgress?: (p: { bytesSent: number; totalBytes: number }) => void };
};

const mockFs = {
  files: new Map<string, number>(),
  dirs: new Set<string>(),
  uploads: [] as UploadCall[],
  respond: jest.fn<Promise<{ status: number; body: string; headers: Record<string, string> }>, [UploadCall]>(),
  failMove: false,
};

jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) =>
    parts
      .map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri))
      .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
      .join('/');
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockFs.files.has(this.uri);
    }
    get size() {
      return mockFs.files.get(this.uri) ?? 0;
    }
    delete() {
      if (!mockFs.files.delete(this.uri)) throw new Error('missing');
    }
    async move(target: { uri: string }) {
      if (mockFs.failMove || !mockFs.files.has(this.uri)) throw new Error('move failed');
      mockFs.files.set(target.uri, mockFs.files.get(this.uri)!);
      mockFs.files.delete(this.uri);
      this.uri = target.uri;
    }
    createUploadTask(url: string, options: UploadCall['options']) {
      const call = { uri: this.uri, url, options };
      return {
        uploadAsync: () => {
          mockFs.uploads.push(call);
          return mockFs.respond(call);
        },
        cancel: jest.fn(),
      };
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockFs.dirs.has(this.uri);
    }
    create() {
      mockFs.dirs.add(this.uri);
    }
    delete() {
      mockFs.dirs.delete(this.uri);
      for (const key of [...mockFs.files.keys()]) if (key.startsWith(`${this.uri}/`)) mockFs.files.delete(key);
    }
    list() {
      return [...mockFs.files.keys()]
        .filter((k) => k.startsWith(`${this.uri}/`) && !k.slice(this.uri.length + 1).includes('/'))
        .map((k) => new File(k));
    }
  }
  return { File, Directory, Paths: { document: new Directory('file:///docs') }, UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 } };
});

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

const USER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const CHILD = '33333333-3333-4333-8333-333333333333';
const PROOF = '44444444-4444-4444-8444-444444444444';
const EVENT = '55555555-5555-4555-8555-555555555555';
const SOURCE = 'file:///cache/Camera/clip.mp4';
const DEST = `file:///docs/brushing-proofs/${USER}/${PROOF}.mp4`;
const DAY = 24 * 60 * 60 * 1000;

function memoryStorage(): KeyValueBackend & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    removeItem: async (k) => {
      map.delete(k);
    },
  };
}

function fakeOutbox(scope: string | null = USER) {
  const states = new Map<string, OutboxEntryState>();
  const codes = new Map<string, string>();
  const listeners = new Set<(n: OutboxNotice) => void>();
  return {
    scope,
    getEventState: (id: string) => states.get(id) ?? null,
    getEntry: (id: string) => (states.has(id) ? ({ eventId: id, code: codes.get(id) } as OutboxEntry) : null),
    subscribe: (l: (n: OutboxNotice) => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    whenReady: async () => {},
    set(id: string, state: OutboxEntryState | null, code?: string) {
      if (state === null) states.delete(id);
      else states.set(id, state);
      if (code) codes.set(id, code);
      for (const l of listeners) {
        l({ kind: 'entry', eventId: id, type: 'brushing_proof_registered', childId: CHILD, ref: null, state: state === null ? 'dropped' : state === 'inflight' ? 'pending' : state, code: code ?? null });
      }
    },
  };
}

function fakeAuth(token: string | null = 'jwt-1'): AuthPort & { accessToken: jest.Mock; refresh: jest.Mock } {
  return {
    accessToken: jest.fn(async () => token),
    refresh: jest.fn(async () => 'ok' as const),
  };
}

const ok = (status = 200, body = '{"Key":"brushing_proofs/x"}') => Promise.resolve({ status, body, headers: {} });

let clock = Date.UTC(2026, 9, 18, 7, 0, 0);
let snapshots: ProofUploadsSnapshot[] = [];

function makeQueue(over: Partial<ConstructorParameters<typeof ProofUploadQueue>[0]> = {}) {
  const outbox = fakeOutbox();
  const auth = fakeAuth();
  const storage = memoryStorage();
  const queue = new ProofUploadQueue({
    files: expoProofFiles,
    outbox,
    auth,
    storage,
    endpoint: () => ({ url: 'https://proj.supabase.co', anonKey: 'anon-key' }),
    retentionDays: () => 7,
    now: () => clock,
    random: () => 0.5,
    autoRun: false,
    onChange: (s) => snapshots.push(s),
    ...over,
  });
  return { queue, outbox, auth, storage };
}

const input = (over: Partial<EnqueueProofInput> = {}): EnqueueProofInput => ({
  userId: USER,
  proofId: PROOF,
  eventId: EVENT,
  childId: CHILD,
  ownerId: OWNER,
  audience: 'parent',
  mime: 'video/mp4',
  sourceUri: SOURCE,
  sizeBytes: 3_400_000,
  durationS: 120,
  ...over,
});

beforeEach(() => {
  mockFs.files.clear();
  mockFs.dirs.clear();
  mockFs.uploads = [];
  mockFs.respond.mockReset().mockImplementation(() => ok());
  mockFs.failMove = false;
  mockFs.files.set(SOURCE, 3_400_000);
  clock = Date.UTC(2026, 9, 18, 7, 0, 0);
  snapshots = [];
});

async function ready(over: Partial<ConstructorParameters<typeof ProofUploadQueue>[0]> = {}) {
  const made = makeQueue(over);
  await made.queue.setScope(USER);
  return made;
}

// ---------------------------------------------------------------------------------------------

describe('pure helpers', () => {
  it('builds the lower-case object path <owner>/<child>/<proof>.mp4|.mov', () => {
    expect(proofObjectPath({ ownerId: OWNER.toUpperCase(), childId: CHILD, proofId: PROOF, mime: 'video/mp4' })).toBe(
      `${OWNER}/${CHILD}/${PROOF}.mp4`,
    );
    expect(proofObjectPath({ ownerId: OWNER, childId: CHILD, proofId: PROOF, mime: 'video/quicktime' })).toBe(`${OWNER}/${CHILD}/${PROOF}.mov`);
  });

  it.each([
    [{ status: 200, body: '' }, 'done'],
    [{ status: 409, body: '' }, 'done'],
    [{ status: 400, body: '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}' }, 'done'],
    [{ status: 401, body: '' }, 'auth'],
    [{ status: 400, body: '{"statusCode":"403","error":"Unauthorized","message":"jwt expired"}' }, 'auth'],
    [{ status: 403, body: '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}' }, 'refused'],
    [{ status: 400, body: '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}' }, 'refused'],
    [{ status: 413, body: '{"statusCode":"413","error":"Payload too large"}' }, 'refused'],
    [{ status: 400, body: '{"statusCode":"415","error":"invalid_mime_type"}' }, 'refused'],
    [{ status: 404, body: '{"statusCode":"404","error":"Bucket not found"}' }, 'unavailable'],
    [{ status: 429, body: '' }, 'retry'],
    [{ status: 503, body: 'upstream' }, 'retry'],
  ])('classifies %j as %s', (res, verdict) => {
    expect(classifyUploadResponse(res)).toBe(verdict);
  });

  it('maps outbox rejection codes', () => {
    expect(failureForRejection('limit_exceeded')).toBe('limit_exceeded');
    expect(failureForRejection('consent_required')).toBe('consent_required');
    expect(failureForRejection('event_id_conflict')).toBe('other');
    expect(failureForRejection(undefined)).toBe('other');
  });
});

describe('ProofUploadQueue', () => {
  it('moves the clip into the private folder and waits until the event is applied', async () => {
    const { queue, outbox } = await ready();
    outbox.set(EVENT, 'pending');
    const item = await queue.enqueue(input());
    expect(item).toMatchObject({ state: 'waiting', fileUri: DEST });
    expect(mockFs.files.has(SOURCE)).toBe(false);
    expect(mockFs.files.get(DEST)).toBe(3_400_000);

    await queue.run();
    outbox.set(EVENT, 'inflight');
    await queue.run();
    expect(mockFs.uploads).toHaveLength(0);
    expect(queue.getItem(PROOF)?.state).toBe('waiting');
  });

  it('uploads after `applied` with the exact path and headers (no upsert), then deletes the file', async () => {
    const { queue, outbox } = await ready();
    outbox.set(EVENT, 'pending');
    await queue.enqueue(input());
    outbox.set(EVENT, 'applied');
    await queue.run();

    expect(mockFs.uploads).toHaveLength(1);
    const call = mockFs.uploads[0];
    expect(call.uri).toBe(DEST);
    expect(call.url).toBe(`https://proj.supabase.co/storage/v1/object/brushing_proofs/${OWNER}/${CHILD}/${PROOF}.mp4`);
    expect(call.options).toMatchObject({
      httpMethod: 'POST',
      uploadType: 0,
      mimeType: 'video/mp4',
      headers: { Authorization: 'Bearer jwt-1', apikey: 'anon-key', 'Content-Type': 'video/mp4', 'x-upsert': 'false' },
    });
    expect(queue.getItem(PROOF)).toMatchObject({ state: 'done', progress: 1, fileUri: null, failure: null });
    expect(mockFs.files.has(DEST)).toBe(false);
  });

  it('reports real upload progress', async () => {
    mockFs.respond.mockImplementation((call) => {
      call.options.onProgress?.({ bytesSent: 1_700_000, totalBytes: 3_400_000 });
      return ok();
    });
    const { queue, outbox } = await ready();
    outbox.set(EVENT, 'applied');
    await queue.enqueue(input());
    await queue.run();
    const states = snapshots.map((s) => s.items[0]).filter(Boolean).map((i) => [i.state, i.progress]);
    expect(states).toContainEqual(['uploading', 0]);
    expect(states).toContainEqual(['uploading', 0.5]);
    expect(states[states.length - 1]).toEqual(['done', 1]);
  });

  it('kicks itself when the outbox reports the event applied (autoRun)', async () => {
    const { queue, outbox } = await ready({ autoRun: true });
    const unsubscribe = outbox.subscribe((n) => queue.handleOutboxNotice(n));
    outbox.set(EVENT, 'pending');
    await queue.enqueue(input());
    await queue.run();
    expect(mockFs.uploads).toHaveLength(0);
    outbox.set(EVENT, 'applied');
    await queue.run();
    expect(queue.getItem(PROOF)?.state).toBe('done');
    unsubscribe();
    queue.dispose();
  });

  it.each([
    ['HTTP 409', () => ok(409, '{"statusCode":"409","error":"Duplicate"}')],
    ['HTTP 400 carrying statusCode 409', () => ok(400, '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}')],
  ])('treats "already exists" (%s) as success', async (_name, respond) => {
    mockFs.respond.mockImplementation(respond);
    const { queue, outbox } = await ready();
    outbox.set(EVENT, 'applied');
    await queue.enqueue(input());
    await queue.run();
    expect(queue.getItem(PROOF)).toMatchObject({ state: 'done', fileUri: null });
    expect(mockFs.files.has(DEST)).toBe(false);
  });

  it('refreshes only once when the new token is refused too', async () => {
    const { queue, outbox, auth } = await ready();
    mockFs.respond.mockImplementation(() => ok(401, ''));
    outbox.set(EVENT, 'applied');
    await queue.enqueue(input());
    await queue.run();
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(mockFs.uploads).toHaveLength(2);
    expect(queue.getItem(PROOF)).toMatchObject({ state: 'retrying', retryReason: 'auth', fileUri: DEST });
  });

  it('refreshes the session once on 401 and retries with the new token', async () => {
    const { queue, outbox, auth } = await ready();
    auth.accessToken.mockResolvedValueOnce('old-jwt').mockResolvedValue('new-jwt');
    mockFs.respond.mockImplementationOnce(() => ok(401, '{"message":"jwt expired"}')).mockImplementation(() => ok());
    outbox.set(EVENT, 'applied');
    await queue.enqueue(input());
    await queue.run();
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(mockFs.uploads.map((u) => u.options.headers?.Authorization)).toEqual(['Bearer old-jwt', 'Bearer new-jwt']);
    expect(queue.getItem(PROOF)?.state).toBe('done');
  });

  it('keeps the file and waits for sign-in when the refresh fails', async () => {
    const { queue, outbox, auth } = await ready();
    auth.refresh.mockResolvedValue('failed');
    mockFs.respond.mockImplementation(() => ok(401, ''));
    outbox.set(EVENT, 'applied');
    await queue.enqueue(input());
    await queue.run();
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(mockFs.uploads).toHaveLength(1);
    expect(queue.getItem(PROOF)).toMatchObject({ state: 'retrying', retryReason: 'auth', fileUri: DEST });
    expect(mockFs.files.has(DEST)).toBe(true);

    // A new session for the same user: it goes again right away.
    mockFs.respond.mockImplementation(() => ok());
    await queue.resumeAuthWaiting();
    expect(queue.getItem(PROOF)?.state).toBe('done');
  });

  it('retries network errors and 5xx with backoff, and right away on foreground', async () => {
    const { queue, outbox } = await ready();
    mockFs.respond.mockImplementation(() => Promise.reject(new Error('offline')));
    outbox.set(EVENT, 'applied');
    await queue.enqueue(input());
    await queue.run();
    expect(queue.getItem(PROOF)).toMatchObject({ state: 'retrying', retryReason: 'network', attempts: 1, nextAttemptAt: clock + 30_000 });

    await queue.run(); // not due yet
    expect(mockFs.uploads).toHaveLength(1);

    mockFs.respond.mockImplementation(() => ok(503, ''));
    clock += 31_000;
    await queue.run();
    expect(queue.getItem(PROOF)).toMatchObject({ state: 'retrying', retryReason: 'server', attempts: 2, nextAttemptAt: clock + 60_000 });

    mockFs.respond.mockImplementation(() => ok());
    queue.retryNow(); // app back in the foreground
    await queue.run();
    expect(queue.getItem(PROOF)?.state).toBe('done');
    expect(mockFs.uploads).toHaveLength(3);
  });

  it.each([
    ['rejected limit_exceeded', 'rejected', 'limit_exceeded', 'limit_exceeded'],
    ['rejected consent_required', 'rejected', 'consent_required', 'consent_required'],
    ['rejected feature_disabled', 'rejected', 'feature_disabled', 'feature_disabled'],
    ['rejected forbidden', 'rejected', 'forbidden', 'forbidden'],
    ['rejected deletion_pending', 'rejected', 'deletion_pending', 'deletion_pending'],
    ['rejected schema_invalid', 'rejected', 'schema_invalid', 'schema_invalid'],
    ['held (brushing event rejected)', 'held', 'dependency_rejected', 'dependency_rejected'],
    ['dropped (purged after consent withdrawal)', null, undefined, 'not_registered'],
  ] as const)('event %s: deletes the file, never uploads', async (_name, state, code, failure) => {
    const { queue, outbox } = await ready();
    outbox.set(EVENT, 'pending');
    await queue.enqueue(input());
    outbox.set(EVENT, state, code);
    await queue.run();
    expect(mockFs.uploads).toHaveLength(0);
    expect(queue.getItem(PROOF)).toMatchObject({ state: 'failed', failure, fileUri: null });
    expect(mockFs.files.has(DEST)).toBe(false);
  });

  it('storage policy refusal (403) is final and deletes the file', async () => {
    mockFs.respond.mockImplementation(() => ok(403, '{"statusCode":"403","message":"new row violates row-level security policy"}'));
    const { queue, outbox } = await ready();
    outbox.set(EVENT, 'applied');
    await queue.enqueue(input());
    await queue.run();
    expect(queue.getItem(PROOF)).toMatchObject({ state: 'failed', failure: 'upload_refused', fileUri: null });
    expect(mockFs.files.size).toBe(0);
  });

  it('a missing bucket (not deployed) waits 15 minutes', async () => {
    mockFs.respond.mockImplementation(() => ok(404, '{"statusCode":"404","error":"Bucket not found"}'));
    const { queue, outbox } = await ready();
    outbox.set(EVENT, 'applied');
    await queue.enqueue(input());
    await queue.run();
    expect(queue.getItem(PROOF)).toMatchObject({ state: 'retrying', retryReason: 'unavailable', nextAttemptAt: clock + 15 * 60 * 1000 });
    expect(mockFs.files.has(DEST)).toBe(true);
  });

  it('a vanished file fails as file_missing', async () => {
    const { queue, outbox } = await ready();
    outbox.set(EVENT, 'applied');
    await queue.enqueue(input());
    mockFs.files.delete(DEST);
    await queue.run();
    expect(mockFs.uploads).toHaveLength(0);
    expect(queue.getItem(PROOF)).toMatchObject({ state: 'failed', failure: 'file_missing' });
  });

  it('a failed move fails as file_missing and removes the cache file', async () => {
    mockFs.failMove = true;
    const { queue } = await ready();
    const item = await queue.enqueue(input());
    expect(item).toMatchObject({ state: 'failed', failure: 'file_missing' });
  });

  it('expires uploads older than the proof retention', async () => {
    const { queue, outbox } = await ready();
    outbox.set(EVENT, 'pending');
    await queue.enqueue(input());
    clock += 8 * DAY;
    await queue.run();
    expect(queue.getItem(PROOF)).toMatchObject({ state: 'failed', failure: 'expired' });
    expect(mockFs.files.has(DEST)).toBe(false);
  });

  it('does nothing while the outbox holds another user (or none)', async () => {
    const outbox = fakeOutbox(null);
    const { queue } = await ready({ outbox });
    outbox.set(EVENT, 'applied');
    await queue.enqueue(input());
    await queue.run();
    expect(mockFs.uploads).toHaveLength(0);
    expect(queue.getItem(PROOF)?.state).toBe('waiting');
  });

  it('waits when there is no session token for the scope user', async () => {
    const { queue, outbox } = await ready({ auth: fakeAuth(null) });
    outbox.set(EVENT, 'applied');
    await queue.enqueue(input());
    await queue.run();
    expect(mockFs.uploads).toHaveLength(0);
    expect(queue.getItem(PROOF)).toMatchObject({ state: 'retrying', retryReason: 'auth' });
  });

  it('refuses a clip of another user and deletes it', async () => {
    const { queue } = await ready();
    expect(await queue.enqueue(input({ userId: OWNER }))).toBeNull();
    expect(mockFs.files.has(SOURCE)).toBe(false);
    expect(queue.items()).toEqual([]);
  });

  it('survives a restart: the persisted queue resumes and uploads', async () => {
    const first = await ready();
    first.outbox.set(EVENT, 'pending');
    await first.queue.enqueue(input());
    await first.queue.flushWrites();
    first.queue.dispose();
    expect(first.storage.map.size).toBeGreaterThan(0);
    expect([...first.storage.map.values()].join('')).not.toContain('jwt');

    // New app process: same storage, same files.
    const outbox = fakeOutbox();
    const second = new ProofUploadQueue({
      files: expoProofFiles,
      outbox,
      auth: fakeAuth('jwt-2'),
      storage: first.storage,
      endpoint: () => ({ url: 'https://proj.supabase.co', anonKey: 'anon-key' }),
      retentionDays: () => 7,
      now: () => clock,
      random: () => 0.5,
      autoRun: false,
    });
    await second.setScope(USER);
    expect(second.getItem(PROOF)).toMatchObject({ state: 'waiting', fileUri: DEST, ownerId: OWNER, childId: CHILD });
    outbox.set(EVENT, 'applied');
    await second.run();
    expect(second.getItem(PROOF)?.state).toBe('done');
    expect(mockFs.uploads[0].options.headers?.Authorization).toBe('Bearer jwt-2');
  });

  it('an upload interrupted by the app dying starts over', async () => {
    const storage = memoryStorage();
    const item = {
      proofId: PROOF,
      eventId: EVENT,
      childId: CHILD,
      ownerId: OWNER,
      audience: 'self',
      mime: 'video/mp4',
      fileUri: DEST,
      sizeBytes: 10,
      durationS: 30,
      createdAt: clock,
      state: 'uploading',
      attempts: 0,
      nextAttemptAt: null,
      retryReason: null,
      failure: null,
      finishedAt: null,
    };
    await storage.setItem(`${PROOF_UPLOADS_STORAGE_PREFIX}${USER}.a`, JSON.stringify({ v: 1, items: [item] }));
    await storage.setItem(`${PROOF_UPLOADS_STORAGE_PREFIX}${USER}.cur`, 'a');
    mockFs.files.set(DEST, 10);
    const { queue, outbox } = await ready({ storage });
    expect(queue.getItem(PROOF)).toMatchObject({ state: 'waiting', audience: 'self', progress: 0 });
    outbox.set(EVENT, 'applied');
    await queue.run();
    expect(queue.getItem(PROOF)?.state).toBe('done');
  });

  it('removes orphaned files of the user on load, keeps referenced ones', async () => {
    const orphan = `file:///docs/brushing-proofs/${USER}/orphan.mp4`;
    mockFs.files.set(orphan, 5);
    const first = await ready();
    first.outbox.set(EVENT, 'pending');
    await first.queue.enqueue(input());
    await first.queue.flushWrites();
    const second = makeQueue({ storage: first.storage });
    await second.queue.setScope(USER);
    expect(mockFs.files.has(orphan)).toBe(false);
    expect(mockFs.files.has(DEST)).toBe(true);
  });

  it('switching to another user stops uploads; deleteScopeData removes queue and files', async () => {
    const { queue, outbox, storage } = await ready();
    outbox.set(EVENT, 'pending');
    await queue.enqueue(input());
    await queue.setScope(null);
    expect(queue.items()).toEqual([]);
    await queue.deleteScopeData(USER);
    expect(mockFs.files.has(DEST)).toBe(false);
    expect([...storage.map.keys()].filter((k) => k.startsWith(PROOF_UPLOADS_STORAGE_PREFIX))).toEqual([]);
  });

  it('snapshots list newest first', async () => {
    const { queue, outbox } = await ready();
    outbox.set(EVENT, 'pending');
    await queue.enqueue(input());
    mockFs.files.set('file:///cache/Camera/two.mov', 20);
    const second = '66666666-6666-4666-8666-666666666666';
    clock += 1000;
    await queue.enqueue(input({ proofId: second, eventId: '77777777-7777-4777-8777-777777777777', sourceUri: 'file:///cache/Camera/two.mov', mime: 'video/quicktime' }));
    expect(queue.items().map((i) => i.proofId)).toEqual([second, PROOF]);
    expect(queue.getItem(second)?.fileUri).toBe(`file:///docs/brushing-proofs/${USER}/${second}.mov`);
  });
});
