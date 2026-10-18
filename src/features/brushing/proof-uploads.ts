// Upload queue for brushing proof videos (ACCOUNTS_AND_FLOWS.md §2.4 step 4, §2.8 step 4;
// SYNC_EVENTS.md §3.8; SUPABASE_API.md §4).
//
// After a camera session the clip is registered with a brushing_proof_registered event (sync
// bridge). This queue keeps the file until it is uploaded:
//   waiting   -> the event is still queued in the outbox (or the next attempt is due)
//   uploading -> the file is being sent (real progress from the native upload task)
//   retrying  -> network / server / auth problem; tried again with backoff and on foreground
//   done      -> stored (200, or 409 "already exists"); the local file is deleted
//   failed    -> final: the event was rejected (limit_exceeded, consent_required, ...), the
//                storage policy refused the file, the file vanished, or it waited too long.
//                The local file is deleted.
// The upload starts ONLY after the event is applied (the storage policy accepts exactly the
// registered path). Path: <owner>/<child_id>/<proof_id>.mp4|.mov, lower case, owner = the parent
// (child account) or the teen itself; POST without upsert.
//
// The queue is persisted per signed-in user (appStorage, A/B slot) so uploads resume after a
// restart; the files live in an app-private documents folder (./proof-files.ts), never in the
// gallery. Never logs: no paths, ids, tokens or URLs leave this module.

import { useEffect, useMemo } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { useAccount } from '@/core/account/account-store';
import { PROOF_BUCKET, isProofObjectPath } from '@/core/account/api';
import { useSession } from '@/core/auth/session-store';
import { appStorage, type KeyValueBackend } from '@/core/auth/secure-storage';
import { supabase } from '@/core/auth/supabase';
import { config } from '@/core/config';
import { backoffDelay, outbox, type Outbox, type OutboxNotice } from '@/core/sync/outbox';
import { abSlot, createWriter, type Writer } from '@/data/persist';
import { DEFAULT_LIMITS, proofMimes, type ProofMime } from '@/domain/models';

import type { ProofAudience } from './camera-availability';
import { expoProofFiles, type ProofFiles, type UploadHandle, type UploadResponse } from './proof-files';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type ProofUploadState = 'waiting' | 'uploading' | 'retrying' | 'done' | 'failed';

/** Final failure reasons. Event rejection codes are kept as-is (SYNC_EVENTS.md §2, §3.8). */
export type ProofUploadFailure =
  | 'limit_exceeded'
  | 'consent_required'
  | 'feature_disabled'
  | 'forbidden'
  | 'deletion_pending'
  | 'schema_invalid'
  /** The brushing event (or a consent it waited for) was rejected. */
  | 'dependency_rejected'
  /** The event is no longer known to the outbox (purged after a consent withdrawal, dismissed). */
  | 'not_registered'
  /** The storage policy refused the file (consent withdrawn, expired, size/type mismatch). */
  | 'upload_refused'
  | 'file_missing'
  | 'expired'
  | 'other';

export type RetryReason = 'network' | 'server' | 'auth' | 'unavailable';

export type ProofUpload = {
  proofId: string;
  /** brushing_proof_registered event id. */
  eventId: string;
  childId: string;
  /** First path segment (parent or teen user id), lower case. */
  ownerId: string;
  audience: ProofAudience;
  mime: ProofMime;
  /** App-private copy of the clip; null once deleted. */
  fileUri: string | null;
  sizeBytes: number;
  durationS: number;
  /** ms since epoch. */
  createdAt: number;
  state: ProofUploadState;
  /** 0..1 while uploading; 1 when done. Not persisted. */
  progress: number;
  /** Upload attempts that failed and will be retried. */
  attempts: number;
  /** ms since epoch of the next automatic attempt (retrying). */
  nextAttemptAt: number | null;
  retryReason: RetryReason | null;
  failure: ProofUploadFailure | null;
  finishedAt: number | null;
};

export type EnqueueProofInput = {
  /** Signed-in user who recorded the clip (must be the queue's scope). */
  userId: string;
  proofId: string;
  eventId: string;
  childId: string;
  ownerId: string;
  audience: ProofAudience;
  mime: ProofMime;
  /** Where expo-camera wrote the clip (cache). Moved into the private folder. */
  sourceUri: string;
  sizeBytes: number;
  durationS: number;
};

export type ProofUploadsSnapshot = {
  scope: string | null;
  ready: boolean;
  /** Newest first. */
  items: ProofUpload[];
};

/** The outbox calls this queue relies on (the app singleton satisfies it). */
export type OutboxPort = Pick<Outbox, 'scope' | 'getEventState' | 'getEntry' | 'subscribe' | 'whenReady'>;

export type AuthPort = {
  /** Access token of the current session, only when it belongs to `userId`. */
  accessToken: (userId: string) => Promise<string | null>;
  /** Refreshes the session once. */
  refresh: () => Promise<'ok' | 'network' | 'failed'>;
};

export type ProofUploadDeps = {
  files?: ProofFiles;
  outbox?: OutboxPort;
  auth?: AuthPort;
  storage?: KeyValueBackend;
  /** Supabase project URL and anon key; null when not configured. */
  endpoint?: () => { url: string; anonKey: string } | null;
  /** Days a registered proof lives on the server (my_account().limits.proof_retention_days). */
  retentionDays?: () => number;
  now?: () => number;
  random?: () => number;
  /** Timers for retries (off in unit tests, which call run() themselves). */
  autoRun?: boolean;
  onChange?: (snapshot: ProofUploadsSnapshot) => void;
};

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

export const PROOF_UPLOADS_STORAGE_PREFIX = 'dentisai.proofUploads.v1.';
/** Storage not deployed / bucket missing: try again after this long. */
export const UNAVAILABLE_RETRY_MS = 15 * 60 * 1000;
/** Finished items stay visible (done screen, kid home) for this long. */
export const FINISHED_KEEP_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_ITEMS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const ACTIVE_STATES: ReadonlySet<ProofUploadState> = new Set(['waiting', 'uploading', 'retrying']);
const REJECTION_CODES: ReadonlySet<string> = new Set([
  'limit_exceeded',
  'consent_required',
  'feature_disabled',
  'forbidden',
  'deletion_pending',
  'schema_invalid',
]);

export function isActiveUpload(item: Pick<ProofUpload, 'state'>): boolean {
  return ACTIVE_STATES.has(item.state);
}

/** Storage object path of a proof: `<owner>/<child_id>/<proof_id>.mp4|.mov`, lower case. */
export function proofObjectPath(item: Pick<ProofUpload, 'ownerId' | 'childId' | 'proofId' | 'mime'>): string {
  const ext = item.mime === 'video/quicktime' ? 'mov' : 'mp4';
  return `${item.ownerId}/${item.childId}/${item.proofId}.${ext}`.toLowerCase();
}

/** Outbox rejection code -> failure reason. */
export function failureForRejection(code: string | null | undefined): ProofUploadFailure {
  return code && REJECTION_CODES.has(code) ? (code as ProofUploadFailure) : 'other';
}

type UploadVerdict = 'done' | 'auth' | 'retry' | 'unavailable' | 'refused';

function parseBody(body: string): { statusCode: string; error: string; message: string } {
  try {
    const o = JSON.parse(body) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
    return { statusCode: s(o.statusCode), error: s(o.error), message: s(o.message) };
  } catch {
    return { statusCode: '', error: '', message: '' };
  }
}

/**
 * Supabase Storage answer -> what to do. Storage may report the real status in the body
 * (`{"statusCode":"409","error":"Duplicate"}` with HTTP 400), so both are read.
 */
export function classifyUploadResponse(res: UploadResponse): UploadVerdict {
  const { status } = res;
  if (status >= 200 && status < 300) return 'done';
  const body = parseBody(res.body);
  const text = `${body.error} ${body.message}`;
  if (status === 409 || body.statusCode === '409' || /duplicate|already exists/i.test(text)) return 'done';
  // Row-level security (consent withdrawn, proof expired, flag off, not the registered path):
  // final, even though some Storage versions label it "Unauthorized".
  if (/row[- ]level security|policy/i.test(text)) return 'refused';
  if (status === 401 || body.statusCode === '401' || /jwt|jws|invalid signature/i.test(text)) return 'auth';
  if (status === 429 || status >= 500 || status === 0) return 'retry';
  if (/bucket not found/i.test(text) || status === 404) return 'unavailable';
  // 403, 413 too large, 400 invalid type/key: final for this file.
  return 'refused';
}

// ---------------------------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------------------------

type Persisted = { v: 1; items: Omit<ProofUpload, 'progress'>[] };

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const states: ReadonlySet<string> = new Set(['waiting', 'uploading', 'retrying', 'done', 'failed']);
const failures: ReadonlySet<string> = new Set([
  ...REJECTION_CODES,
  'dependency_rejected',
  'not_registered',
  'upload_refused',
  'file_missing',
  'expired',
  'other',
]);
const retryReasons: ReadonlySet<string> = new Set(['network', 'server', 'auth', 'unavailable']);

function parseItem(value: unknown): ProofUpload | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : null);
  const num = (k: string) => (typeof v[k] === 'number' && Number.isFinite(v[k]) ? (v[k] as number) : null);
  const proofId = str('proofId');
  const eventId = str('eventId');
  const childId = str('childId');
  const ownerId = str('ownerId');
  const state = str('state');
  const mime = str('mime');
  const sizeBytes = num('sizeBytes');
  const durationS = num('durationS');
  const createdAt = num('createdAt');
  if (!proofId || !UUID_RE.test(proofId) || !eventId || !childId || !ownerId) return null;
  if (!state || !states.has(state) || !mime || !proofMimes.includes(mime as ProofMime)) return null;
  if (sizeBytes === null || durationS === null || createdAt === null) return null;
  const failure = str('failure');
  const retryReason = str('retryReason');
  return {
    proofId,
    eventId,
    childId,
    ownerId,
    audience: v.audience === 'self' ? 'self' : 'parent',
    mime: mime as ProofMime,
    fileUri: str('fileUri'),
    sizeBytes,
    durationS,
    createdAt,
    // An upload that was running when the app died starts over.
    state: state === 'uploading' ? 'waiting' : (state as ProofUploadState),
    progress: state === 'done' ? 1 : 0,
    attempts: Math.max(0, Math.floor(num('attempts') ?? 0)),
    nextAttemptAt: num('nextAttemptAt'),
    retryReason: retryReason && retryReasons.has(retryReason) ? (retryReason as RetryReason) : null,
    failure: failure && failures.has(failure) ? (failure as ProofUploadFailure) : null,
    finishedAt: num('finishedAt'),
  };
}

export function parsePersistedUploads(raw: string): ProofUpload[] {
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; items?: unknown };
    if (parsed.v !== 1 || !Array.isArray(parsed.items)) return [];
    const seen = new Set<string>();
    const out: ProofUpload[] = [];
    for (const raw of parsed.items) {
      const item = parseItem(raw);
      if (item && !seen.has(item.proofId)) {
        seen.add(item.proofId);
        out.push(item);
      }
    }
    return out;
  } catch {
    return [];
  }
}

function serialize(items: readonly ProofUpload[]): string {
  const persisted: Persisted = { v: 1, items: items.map(({ progress: _progress, ...rest }) => rest) };
  return JSON.stringify(persisted);
}

// ---------------------------------------------------------------------------------------------
// Default adapters
// ---------------------------------------------------------------------------------------------

const supabaseAuth: AuthPort = {
  async accessToken(userId) {
    if (!supabase) return null;
    try {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session || session.user.id !== userId) return null;
      return session.access_token;
    } catch {
      return null;
    }
  },
  async refresh() {
    if (!supabase) return 'failed';
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.session) return 'ok';
      const e = (error ?? {}) as { name?: unknown; status?: unknown; message?: unknown };
      if (e.name === 'AuthRetryableFetchError' || e.status === 0) return 'network';
      if (typeof e.message === 'string' && /network|fetch|timeout/i.test(e.message)) return 'network';
      return 'failed';
    } catch {
      return 'network';
    }
  },
};

function defaultEndpoint(): { url: string; anonKey: string } | null {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
  return { url: config.supabaseUrl.replace(/\/+$/, ''), anonKey: config.supabaseAnonKey };
}

function defaultRetentionDays(): number {
  return useAccount.getState().me?.limits.proofRetentionDays ?? DEFAULT_LIMITS.proofRetentionDays;
}

// ---------------------------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------------------------

type ScopeState = {
  scope: string;
  /** Oldest first (upload order). */
  items: ProofUpload[];
  ready: boolean;
  loading: Promise<void>;
  writer: Writer;
};

export class ProofUploadQueue {
  private readonly files: ProofFiles;
  private readonly outbox: OutboxPort;
  private readonly auth: AuthPort;
  private readonly storage: KeyValueBackend;
  private readonly endpoint: () => { url: string; anonKey: string } | null;
  private readonly retentionDays: () => number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly autoRun: boolean;
  private readonly onChange?: (snapshot: ProofUploadsSnapshot) => void;

  private s: ScopeState | null = null;
  private running: Promise<void> | null = null;
  private rerun = false;
  private rerunIgnoreBackoff = false;
  private current: UploadHandle | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: ProofUploadDeps = {}) {
    this.files = deps.files ?? expoProofFiles;
    this.outbox = deps.outbox ?? outbox;
    this.auth = deps.auth ?? supabaseAuth;
    this.storage = deps.storage ?? appStorage;
    this.endpoint = deps.endpoint ?? defaultEndpoint;
    this.retentionDays = deps.retentionDays ?? defaultRetentionDays;
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.autoRun = deps.autoRun ?? true;
    this.onChange = deps.onChange;
  }

  get scope(): string | null {
    return this.s?.scope ?? null;
  }

  /** Copy of the items, newest first. */
  items(): ProofUpload[] {
    return [...(this.s?.items ?? [])].reverse().map((i) => ({ ...i }));
  }

  getItem(proofId: string): ProofUpload | null {
    const item = this.s?.items.find((i) => i.proofId === proofId);
    return item ? { ...item } : null;
  }

  /** Resolves when the current scope is loaded. */
  whenReady(): Promise<void> {
    return this.s?.loading ?? Promise.resolve();
  }

  /** Writes pending changes now (tests, app going to the background). */
  async flushWrites(): Promise<void> {
    await this.s?.writer.flush();
  }

  /**
   * Switches to `userId`'s queue (null = signed out / guest: nothing uploads). The previous
   * queue is written out; files stay on the device for that user's next session.
   */
  setScope(userId: string | null): Promise<void> {
    if ((this.s?.scope ?? null) === userId) return this.s?.loading ?? Promise.resolve();
    const previous = this.s;
    this.cancelCurrent();
    this.clearTimer();
    const persistPrevious = previous ? previous.writer.flush() : Promise.resolve();
    if (!userId) {
      this.s = null;
      this.emit();
      return persistPrevious;
    }
    const slot = abSlot(PROOF_UPLOADS_STORAGE_PREFIX + userId, this.storage);
    const state: ScopeState = {
      scope: userId,
      items: [],
      ready: false,
      loading: Promise.resolve(),
      writer: createWriter(slot, () => serialize(state.items), 0),
    };
    state.loading = (async () => {
      await persistPrevious;
      let stored: ProofUpload[] = [];
      try {
        const raw = await slot.read();
        if (raw) stored = parsePersistedUploads(raw);
      } catch {
        // Unreadable storage: start empty (orphaned files are removed below).
      }
      const known = new Set(stored.map((i) => i.proofId));
      state.items = [...stored, ...state.items.filter((i) => !known.has(i.proofId))];
      state.ready = true;
      if (this.s !== state) return;
      this.housekeep(state);
      this.removeOrphans(state);
      state.writer.schedule();
      this.emit();
      this.kick();
    })();
    this.s = state;
    this.emit();
    return state.loading;
  }

  /** Deletes a user's queue and files (account deletion). */
  async deleteScopeData(userId: string): Promise<void> {
    if (this.s?.scope === userId) {
      this.cancelCurrent();
      this.s.items = [];
      this.s.writer.cancel();
      this.emit();
    }
    this.files.removeAll(userId);
    await abSlot(PROOF_UPLOADS_STORAGE_PREFIX + userId, this.storage).remove();
  }

  /**
   * Takes over a registered clip: moves it into the private folder and queues the upload.
   * Returns the item, or null when this queue is not on `input.userId` (the clip is deleted).
   */
  async enqueue(input: EnqueueProofInput): Promise<ProofUpload | null> {
    const s = this.s;
    if (!s || s.scope !== input.userId) {
      this.files.remove(input.sourceUri);
      return null;
    }
    await s.loading;
    if (this.s !== s) {
      this.files.remove(input.sourceUri);
      return null;
    }
    const existing = s.items.find((i) => i.proofId === input.proofId);
    if (existing) return { ...existing };
    const ext = input.mime === 'video/quicktime' ? 'mov' : 'mp4';
    let destination: string | null = null;
    try {
      destination = this.files.destination(s.scope, `${input.proofId.toLowerCase()}.${ext}`);
    } catch {
      destination = null;
    }
    const item: ProofUpload = {
      proofId: input.proofId.toLowerCase(),
      eventId: input.eventId.toLowerCase(),
      childId: input.childId.toLowerCase(),
      ownerId: input.ownerId.toLowerCase(),
      audience: input.audience,
      mime: input.mime,
      fileUri: destination,
      sizeBytes: input.sizeBytes,
      durationS: input.durationS,
      createdAt: this.now(),
      state: 'waiting',
      progress: 0,
      attempts: 0,
      nextAttemptAt: null,
      retryReason: null,
      failure: null,
      finishedAt: null,
    };
    // Recorded before the move so a kill in between never leaves an untracked file behind.
    s.items.push(item);
    s.writer.schedule();
    const moved = destination ? await this.files.move(input.sourceUri, destination) : false;
    if (!moved) {
      this.files.remove(input.sourceUri);
      this.finish(s, item, 'failed', 'file_missing');
    }
    this.prune(s);
    this.emit();
    this.kick();
    return { ...item };
  }

  /** Outbox listener: a change of a proof event (or a scope reset) may unblock an upload. */
  handleOutboxNotice(notice: OutboxNotice): void {
    if (notice.kind === 'reset') {
      this.kick();
      return;
    }
    if (this.s?.items.some((i) => i.eventId === notice.eventId && isActiveUpload(i))) this.kick();
  }

  /** Foreground / "try now": retries scheduled uploads immediately. */
  retryNow(): void {
    void this.run({ ignoreBackoff: true });
  }

  /** The session changed for the same user: uploads that waited for a token go now. */
  resumeAuthWaiting(): Promise<void> {
    const s = this.s;
    if (s) {
      for (const item of s.items) {
        if (item.state === 'retrying' && item.retryReason === 'auth') item.nextAttemptAt = null;
      }
    }
    return this.run();
  }

  /**
   * Processes the queue (single-flight; a call during a run triggers one more run). Resolves
   * when nothing more can be done right now.
   */
  run(options: { ignoreBackoff?: boolean } = {}): Promise<void> {
    if (this.running) {
      this.rerun = true;
      this.rerunIgnoreBackoff = this.rerunIgnoreBackoff || options.ignoreBackoff === true;
      return this.running;
    }
    const run = (async () => {
      let ignoreBackoff = options.ignoreBackoff === true;
      do {
        this.rerun = false;
        await this.pump(ignoreBackoff);
        ignoreBackoff = this.rerunIgnoreBackoff;
        this.rerunIgnoreBackoff = false;
      } while (this.rerun);
    })().finally(() => {
      this.running = null;
      this.scheduleTimer();
    });
    this.running = run;
    return run;
  }

  dispose(): void {
    this.cancelCurrent();
    this.clearTimer();
  }

  // ----- internals -----------------------------------------------------------------------------

  private kick() {
    if (this.autoRun) void this.run();
  }

  private emit() {
    this.onChange?.({ scope: this.scope, ready: this.s?.ready ?? false, items: this.items() });
  }

  private async pump(ignoreBackoff: boolean): Promise<void> {
    const s = this.s;
    if (!s || !s.ready) return;
    this.housekeep(s);
    if (!s.items.some(isActiveUpload)) return;
    // Event states are only meaningful when the outbox holds this user's queue.
    if (this.outbox.scope !== s.scope) return;
    await this.outbox.whenReady();
    if (this.s !== s || this.outbox.scope !== s.scope) return;

    for (const item of [...s.items]) {
      if (this.s !== s) return;
      if (!isActiveUpload(item)) continue;
      const eventState = this.outbox.getEventState(item.eventId);
      if (eventState === 'pending' || eventState === 'inflight') continue; // wait for the notice
      if (eventState === 'rejected') {
        this.finish(s, item, 'failed', failureForRejection(this.outbox.getEntry(item.eventId)?.code));
        continue;
      }
      if (eventState === 'held') {
        this.finish(s, item, 'failed', 'dependency_rejected');
        continue;
      }
      if (eventState === null) {
        // Not queued and not recently applied: purged (consent withdrawn) or dismissed. Do not
        // send a video the server no longer expects.
        this.finish(s, item, 'failed', 'not_registered');
        continue;
      }
      // applied
      if (!ignoreBackoff && item.nextAttemptAt !== null && item.nextAttemptAt > this.now()) continue;
      await this.upload(s, item);
    }
  }

  private async upload(s: ScopeState, item: ProofUpload): Promise<void> {
    const endpoint = this.endpoint();
    if (!endpoint) {
      this.retry(s, item, 'unavailable');
      return;
    }
    const path = proofObjectPath(item);
    if (!isProofObjectPath(path)) {
      this.finish(s, item, 'failed', 'other');
      return;
    }
    if (!item.fileUri || this.files.size(item.fileUri) === null) {
      this.finish(s, item, 'failed', 'file_missing');
      return;
    }
    const url = `${endpoint.url}/storage/v1/object/${PROOF_BUCKET}/${path}`;

    item.state = 'uploading';
    item.progress = 0;
    this.emit();

    let refreshed = false;
    for (;;) {
      const token = await this.auth.accessToken(s.scope);
      if (this.s !== s) return;
      if (!token) {
        // Signed out or another account: wait for the session (scope change re-runs the queue).
        this.retry(s, item, 'auth');
        return;
      }
      const result = await this.send(item, url, token, endpoint.anonKey);
      if (this.s !== s) return;
      if (result === 'network') {
        // The file may have been removed underneath us (storage cleared).
        if (!item.fileUri || this.files.size(item.fileUri) === null) this.finish(s, item, 'failed', 'file_missing');
        else this.retry(s, item, 'network');
        return;
      }
      const verdict = classifyUploadResponse(result);
      if (verdict === 'auth' && !refreshed) {
        refreshed = true;
        const r = await this.auth.refresh();
        if (this.s !== s) return;
        if (r === 'ok') continue;
        this.retry(s, item, r === 'network' ? 'network' : 'auth');
        return;
      }
      switch (verdict) {
        case 'done':
          this.finish(s, item, 'done', null);
          return;
        case 'auth':
          this.retry(s, item, 'auth');
          return;
        case 'retry':
          this.retry(s, item, 'server');
          return;
        case 'unavailable':
          this.retry(s, item, 'unavailable');
          return;
        case 'refused':
          this.finish(s, item, 'failed', 'upload_refused');
          return;
      }
    }
  }

  private async send(item: ProofUpload, url: string, token: string, anonKey: string): Promise<UploadResponse | 'network'> {
    let handle: UploadHandle;
    try {
      handle = this.files.upload(item.fileUri ?? '', url, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
          'Content-Type': item.mime,
          'x-upsert': 'false',
        },
        mimeType: item.mime,
        onProgress: (sent, total) => {
          const denominator = total > 0 ? total : item.sizeBytes;
          const next = denominator > 0 ? Math.min(1, Math.max(0, sent / denominator)) : 0;
          // Re-render on whole percents only.
          if (Math.floor(next * 100) !== Math.floor(item.progress * 100)) {
            item.progress = next;
            this.emit();
          }
        },
      });
    } catch {
      return 'network';
    }
    this.current = handle;
    try {
      return await handle.promise;
    } catch {
      return 'network';
    } finally {
      if (this.current === handle) this.current = null;
    }
  }

  private retry(s: ScopeState, item: ProofUpload, reason: RetryReason) {
    item.state = 'retrying';
    item.progress = 0;
    item.retryReason = reason;
    item.attempts += 1;
    const delay = reason === 'unavailable' ? UNAVAILABLE_RETRY_MS : backoffDelay(item.attempts, this.random);
    item.nextAttemptAt = this.now() + delay;
    s.writer.schedule();
    this.emit();
  }

  private finish(s: ScopeState, item: ProofUpload, state: 'done' | 'failed', failure: ProofUploadFailure | null) {
    if (item.fileUri) this.files.remove(item.fileUri);
    item.fileUri = null;
    item.state = state;
    item.failure = failure;
    item.progress = state === 'done' ? 1 : 0;
    item.nextAttemptAt = null;
    item.retryReason = null;
    item.finishedAt = this.now();
    s.writer.schedule();
    this.emit();
  }

  /** Expires uploads the server no longer accepts and drops old finished items. */
  private housekeep(s: ScopeState) {
    const maxAge = Math.max(1, this.retentionDays()) * DAY_MS;
    const now = this.now();
    for (const item of s.items) {
      if (isActiveUpload(item) && item.state !== 'uploading' && now - item.createdAt > maxAge) {
        this.finish(s, item, 'failed', 'expired');
      }
    }
    this.prune(s);
  }

  private prune(s: ScopeState) {
    const now = this.now();
    let kept = s.items.filter((i) => isActiveUpload(i) || now - (i.finishedAt ?? i.createdAt) <= FINISHED_KEEP_MS);
    if (kept.length > MAX_ITEMS) {
      const active = kept.filter(isActiveUpload);
      const finished = kept.filter((i) => !isActiveUpload(i)).slice(-(Math.max(0, MAX_ITEMS - active.length)));
      const keep = new Set([...active, ...finished]);
      kept = kept.filter((i) => keep.has(i));
    }
    if (kept.length !== s.items.length) {
      for (const dropped of s.items.filter((i) => !kept.includes(i))) {
        if (dropped.fileUri) this.files.remove(dropped.fileUri);
      }
      s.items = kept;
      s.writer.schedule();
    }
  }

  /** Files in the user's folder that no waiting upload references (e.g. a crash mid-enqueue). */
  private removeOrphans(s: ScopeState) {
    const referenced = new Set(s.items.filter(isActiveUpload).map((i) => i.fileUri).filter((u): u is string => !!u));
    for (const uri of this.files.list(s.scope)) {
      if (!referenced.has(uri)) this.files.remove(uri);
    }
  }

  private cancelCurrent() {
    const handle = this.current;
    this.current = null;
    handle?.cancel();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleTimer() {
    this.clearTimer();
    if (!this.autoRun) return;
    const next = (this.s?.items ?? [])
      .filter((i) => i.state === 'retrying' && i.nextAttemptAt !== null)
      .reduce<number | null>((min, i) => (min === null || i.nextAttemptAt! < min ? i.nextAttemptAt! : min), null);
    if (next === null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, Math.max(0, next - this.now()));
  }
}

// ---------------------------------------------------------------------------------------------
// App singleton + React bindings
// ---------------------------------------------------------------------------------------------

export const useProofUploadStore = create<ProofUploadsSnapshot>(() => ({ scope: null, ready: false, items: [] }));

export const proofUploads = new ProofUploadQueue({ onChange: (snapshot) => useProofUploadStore.setState(snapshot) });

let stopEngine: (() => void) | null = null;

/**
 * Connects the queue to the session (scope = signed-in user), the outbox (event results) and
 * the app state (retry on foreground). Idempotent; returns the stop function.
 */
export function startProofUploads(): () => void {
  if (stopEngine) return stopEngine;
  const applySession = () => {
    const { status, userId } = useSession.getState();
    const scope = status === 'signedIn' && userId ? userId : null;
    if (scope === proofUploads.scope) {
      // Same user, maybe a fresh token after a sign-in or refresh: uploads waiting for it go now.
      if (scope) void proofUploads.resumeAuthWaiting();
      return;
    }
    void proofUploads.setScope(scope);
  };
  applySession();
  const unsubscribeSession = useSession.subscribe(applySession);
  const unsubscribeOutbox = outbox.subscribe((notice) => proofUploads.handleOutboxNotice(notice));
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') proofUploads.retryNow();
    else void proofUploads.flushWrites();
  });
  stopEngine = () => {
    unsubscribeSession();
    unsubscribeOutbox();
    appState.remove();
    proofUploads.dispose();
    stopEngine = null;
  };
  return stopEngine;
}

export type ProofUploadsView = {
  /** Newest first. */
  items: ProofUpload[];
  /** Waiting, uploading or retrying. */
  active: ProofUpload[];
};

/** Upload queue of the signed-in user (starts the queue on first use). */
export function useProofUploads(): ProofUploadsView {
  useEffect(() => {
    startProofUploads();
  }, []);
  const items = useProofUploadStore((s) => s.items);
  return useMemo(() => ({ items, active: items.filter(isActiveUpload) }), [items]);
}

/** One proof's upload, or null (unknown / other user). */
export function useProofUpload(proofId: string | null): ProofUpload | null {
  useEffect(() => {
    startProofUploads();
  }, []);
  return useProofUploadStore((s) => (proofId ? (s.items.find((i) => i.proofId === proofId.toLowerCase()) ?? null) : null));
}
