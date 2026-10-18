// The sync_events outbox (backend/docs/api/SYNC_EVENTS.md §2, §4–§6).
//
// Every change that must reach the server is queued here as a built event (./events.ts) and
// sent in FIFO batches to `supabase.rpc('sync_events', { batch })`. The queue is persisted per
// signed-in user (appStorage, A/B slot) so nothing is lost when the app is killed; a parent and
// a child sharing one phone each have their own queue. Guest mode and signed-out have no queue.
//
// Results per event (§2, §6):
//   applied                      -> removed, remembered in a small "recently applied" ledger
//   rejected (not internal_error) -> terminal 'rejected' + code ("needs attention"); entries
//                                   that depend on it become 'held' / 'dependency_rejected'
//   rejected internal_error       -> stays 'pending', resent with the SAME event_id after backoff
// Call-level failures: network/timeout/5xx/429 -> exponential backoff with jitter (30 s, 1, 2,
// 4, 8 min ... cap 1 h; Retry-After honoured when the transport exposes it); 401/403 -> refresh
// the session once and retry, otherwise pause 'auth_required'; 400 22023 batch_size_out_of_range
// / batch_too_large -> halve the batch; PGRST202 (sync_events not deployed) -> pause 'unavailable'.
//
// Ordering: FIFO per child. An event is sendable only when each of its dependencies is applied
// (no longer queued) or sits earlier in the same batch, and no earlier event of the same child
// is still waiting. One batch is in flight at a time (single-flight flush).
//
// Privacy: never logs. Payloads, child ids, event ids and refs stay inside this module's memory
// and the encrypted store.

import { create } from 'zustand';

import { useSession } from '@/core/auth/session-store';
import { appStorage, type KeyValueBackend } from '@/core/auth/secure-storage';
import { supabase } from '@/core/auth/supabase';
import { utf8ByteLength } from '@/core/auth/validation';
import { abSlot, createWriter, type Writer } from '@/data/persist';

import { isWellFormedEvent, type BuiltEvent, type SyncEventType } from './events';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** 'applied' is never stored: applied entries leave the queue (see getEventState). */
export type OutboxEntryState = 'pending' | 'inflight' | 'applied' | 'rejected' | 'held';

export type OutboxEntry = {
  eventId: string;
  type: SyncEventType;
  childId: string;
  /** Exact JSON text of the payload; never rebuilt (idempotency hash, SYNC_EVENTS.md §4). */
  payloadJson: string;
  /** ISO timestamp of enqueue. */
  createdAt: string;
  /** How many times the event was put in a sent batch. */
  attempts: number;
  state: Exclude<OutboxEntryState, 'applied'>;
  /** Rejection code ('rejected') or 'dependency_rejected' ('held'). */
  code?: string;
  /** ms since epoch; set after internal_error. */
  nextAttemptAt?: number;
  /** event ids that must be applied first (or sit earlier in the same batch). */
  dependsOn?: string[];
  /** Opaque link to the local record (e.g. 'brushing:<id>'), used by the sync bridge. */
  ref?: string;
};

export type EnqueueInput = BuiltEvent & { dependsOn?: readonly string[]; ref?: string };

/** What subscribers hear. `dropped` = removed without a server result (purge, dismiss). */
export type OutboxNotice =
  | {
      kind: 'entry';
      eventId: string;
      type: SyncEventType;
      childId: string;
      ref: string | null;
      state: 'pending' | 'applied' | 'rejected' | 'held' | 'dropped';
      code: string | null;
    }
  | { kind: 'reset'; scope: string | null };

export type WaitResult =
  | { state: 'applied' }
  | { state: 'rejected'; code: string }
  | { state: 'held'; code: string }
  | { state: 'timeout' }
  /** Not queued and not recently applied (never enqueued, purged, dismissed, other user). */
  | { state: 'unknown' };

/**
 * A ref whose rejected event the user dismissed ("given up", SYNC_EVENTS.md §2: a final
 * rejection is not sent again). The sync bridge does not re-queue its record until the record
 * really changes or the cause is fixed (e.g. a new consent (b) grant).
 */
export type GivenUpRef = { ref: string; childId: string; code: string; at: number };

export type PauseReason = 'auth_required' | 'unavailable';
export type BackoffReason = 'network' | 'server' | 'rate_limited';

export type OutboxStatus = {
  /** Signed-in user id the queue belongs to; null = disabled (guest / signed out). */
  scope: string | null;
  /** Queue loaded from storage. */
  ready: boolean;
  syncing: boolean;
  /** Waiting to be sent (pending + inflight). */
  pending: number;
  /** Blocked by a rejected dependency. */
  held: number;
  /** Rejected by the server (needs attention). */
  rejected: number;
  pauseReason: PauseReason | null;
  backoffReason: BackoffReason | null;
  /** ms since epoch of the next automatic attempt, when one is scheduled. */
  nextAttemptAt: number | null;
  /** ms since epoch of the last sync_events call that returned results. */
  lastSuccessAt: number | null;
};

export type FlushResult = {
  /** Events put in sent batches (including retries within this flush). */
  sent: number;
  applied: number;
  rejected: number;
  /** internal_error results scheduled for a retry with the same event id. */
  retried: number;
  /** Why the flush stopped early, null when the queue was drained of sendable events. */
  stopped: null | 'disabled' | 'scope_changed' | 'paused' | 'backoff' | PauseReason | BackoffReason;
};

export type WireEvent = { event_id: string; type: SyncEventType; payload: unknown };

/** Raw RPC answer (supabase-js shape). `retryAfterS` only when the transport can read headers. */
export type TransportResponse = {
  data: unknown;
  error: { code?: string; message?: string } | null;
  status: number;
  retryAfterS?: number;
};
export type Transport = (batch: WireEvent[]) => Promise<TransportResponse>;
export type RefreshResult = 'ok' | 'network' | 'failed';

export type OutboxDeps = {
  transport?: Transport;
  refreshSession?: () => Promise<RefreshResult>;
  storage?: KeyValueBackend;
  now?: () => number;
  random?: () => number;
  /** User id of the session the client would send with (must equal the scope to send). */
  currentUserId?: () => string | null;
  /** Debounced flush after enqueue and timers for backoff retries (off in unit tests). */
  autoFlush?: boolean;
  onStatus?: (status: OutboxStatus) => void;
  maxBatch?: number;
};

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** Recommended batch size (SYNC_EVENTS.md §6; hard limit 100). */
export const MAX_BATCH_EVENTS = 50;
/** Byte budget per batch, below the 256 KiB server cap to leave room for the envelope. */
export const MAX_BATCH_BYTES = 200_000;
export const FLUSH_DEBOUNCE_MS = 1000;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 60 * 60 * 1000;
/** sync_events missing on this backend (PGRST202): try again after this long. */
export const UNAVAILABLE_RETRY_MS = 15 * 60 * 1000;
export const RPC_TIMEOUT_MS = 30_000;
/** Size of the persisted "recently applied" ledger (getEventState / waitForEvent). */
export const RECENT_APPLIED_MAX = 200;
/** Size of the persisted "given up" ledger (oldest dropped first). */
export const GIVEN_UP_MAX = 500;
export const OUTBOX_STORAGE_PREFIX = 'dentisai.outbox.v1.';

/** Codes after which a dependent event may still be sent (the entity exists on the server). */
const DEPENDENCY_OK_CODES: ReadonlySet<string> = new Set(['entity_conflict']);

/**
 * Backoff delay for the n-th consecutive failure (n >= 1): 30 s, 1, 2, 4, 8 ... min, capped at
 * 1 h, then +/-25 % jitter (also capped) so phones that lost signal together do not retry together.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempt));
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(n - 1, 20));
  return Math.min(BACKOFF_MAX_MS, Math.round(base * (0.75 + 0.5 * random())));
}

// ---------------------------------------------------------------------------------------------
// Default transport (supabase.rpc) and session refresh
// ---------------------------------------------------------------------------------------------

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

/**
 * supabase-js does not expose response headers on rpc(), so Retry-After cannot be read here;
 * a 429 still backs off exponentially.
 */
const supabaseTransport: Transport = async (batch) => {
  const client = supabase;
  if (!client) return { data: null, error: { code: 'not_configured' }, status: 0 };
  try {
    const res = await withTimeout(client.rpc('sync_events', { batch }), RPC_TIMEOUT_MS);
    return { data: res.data, error: res.error, status: res.status };
  } catch {
    return { data: null, error: { message: 'network' }, status: 0 };
  }
};

async function supabaseRefresh(): Promise<RefreshResult> {
  const client = supabase;
  if (!client) return 'failed';
  try {
    const { data, error } = await withTimeout(client.auth.refreshSession(), RPC_TIMEOUT_MS);
    if (!error && data.session) return 'ok';
    const e = (error ?? {}) as { name?: unknown; status?: unknown; message?: unknown };
    if (e.name === 'AuthRetryableFetchError' || e.status === 0) return 'network';
    if (typeof e.message === 'string' && /network|fetch|timeout/i.test(e.message)) return 'network';
    return 'failed';
  } catch {
    return 'network';
  }
}

// ---------------------------------------------------------------------------------------------
// Persistence format
// ---------------------------------------------------------------------------------------------

type Persisted = { v: 1; entries: OutboxEntry[]; applied: [string, number][]; given?: GivenUpRef[] };

const storedStates: ReadonlySet<string> = new Set(['pending', 'inflight', 'rejected', 'held']);

function parseEntry(value: unknown): OutboxEntry | null {
  if (!value || typeof value !== 'object') return null;
  const e = value as Record<string, unknown>;
  if (typeof e.childId !== 'string' || typeof e.createdAt !== 'string') return null;
  if (!isWellFormedEvent({ eventId: e.eventId, type: e.type, childId: e.childId, payloadJson: e.payloadJson })) {
    return null;
  }
  if (typeof e.state !== 'string' || !storedStates.has(e.state)) return null;
  const entry: OutboxEntry = {
    eventId: (e.eventId as string).toLowerCase(),
    type: e.type as SyncEventType,
    childId: e.childId,
    payloadJson: e.payloadJson as string,
    createdAt: e.createdAt,
    attempts: typeof e.attempts === 'number' && e.attempts >= 0 ? Math.floor(e.attempts) : 0,
    // An event that was in flight when the app died was never confirmed: send it again.
    state: e.state === 'inflight' ? 'pending' : (e.state as OutboxEntry['state']),
  };
  if (typeof e.code === 'string') entry.code = e.code;
  if (typeof e.nextAttemptAt === 'number') entry.nextAttemptAt = e.nextAttemptAt;
  if (Array.isArray(e.dependsOn)) entry.dependsOn = e.dependsOn.filter((d): d is string => typeof d === 'string');
  if (typeof e.ref === 'string') entry.ref = e.ref;
  return entry;
}

function parseGivenUp(value: unknown): GivenUpRef | null {
  if (!value || typeof value !== 'object') return null;
  const g = value as Record<string, unknown>;
  if (typeof g.ref !== 'string' || typeof g.childId !== 'string' || typeof g.code !== 'string' || typeof g.at !== 'number') {
    return null;
  }
  return { ref: g.ref, childId: g.childId, code: g.code, at: g.at };
}

type Parsed = { entries: OutboxEntry[]; applied: [string, number][]; given: GivenUpRef[] };

function parsePersisted(raw: string): Parsed {
  try {
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (!parsed || parsed.v !== 1) return { entries: [], applied: [], given: [] };
    const entries = (Array.isArray(parsed.entries) ? parsed.entries : [])
      .map(parseEntry)
      .filter((e): e is OutboxEntry => e !== null);
    const applied = (Array.isArray(parsed.applied) ? parsed.applied : []).filter(
      (a): a is [string, number] => Array.isArray(a) && typeof a[0] === 'string' && typeof a[1] === 'number',
    );
    const given = (Array.isArray(parsed.given) ? parsed.given : [])
      .map(parseGivenUp)
      .filter((g): g is GivenUpRef => g !== null);
    return { entries, applied, given };
  } catch {
    return { entries: [], applied: [], given: [] };
  }
}

// ---------------------------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------------------------

type Hold = { reason: PauseReason | BackoffReason; until: number | null };

/** All state of one user's queue. The writer of a scope only ever serialises its own object. */
type ScopeState = {
  scope: string;
  entries: OutboxEntry[];
  /** Recently applied event ids (insertion order = age) -> ms since epoch. */
  applied: Map<string, number>;
  /** Given-up refs (insertion order = age). */
  given: Map<string, GivenUpRef>;
  ready: boolean;
  loading: Promise<void>;
  writer: Writer;
};

type CallOutcome =
  | { kind: 'results'; items: { status: 'applied' | 'rejected'; code: string | null }[] }
  | { kind: 'bad_response' | 'network' | 'server' | 'auth' | 'unavailable' | 'batch_size' }
  | { kind: 'rate_limited'; retryAfterS?: number };

export class Outbox {
  private readonly transport: Transport;
  private readonly refreshSession: () => Promise<RefreshResult>;
  private readonly storage: KeyValueBackend;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly currentUserId: () => string | null;
  private readonly autoFlush: boolean;
  private readonly onStatus?: (status: OutboxStatus) => void;
  private readonly maxBatch: number;

  private s: ScopeState | null = null;
  private listeners = new Set<(notice: OutboxNotice) => void>();
  private flushing: Promise<FlushResult> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private hold: Hold | null = null;
  private callFailures = 0;
  private batchLimit: number;
  private lastSuccessAt: number | null = null;
  private syncing = false;

  constructor(deps: OutboxDeps = {}) {
    this.transport = deps.transport ?? supabaseTransport;
    this.refreshSession = deps.refreshSession ?? supabaseRefresh;
    this.storage = deps.storage ?? appStorage;
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.currentUserId = deps.currentUserId ?? (() => useSession.getState().userId);
    this.autoFlush = deps.autoFlush ?? true;
    this.onStatus = deps.onStatus;
    this.maxBatch = Math.max(1, Math.min(deps.maxBatch ?? MAX_BATCH_EVENTS, 100));
    this.batchLimit = this.maxBatch;
  }

  // ----- scope ---------------------------------------------------------------------------------

  /** Current scope (signed-in user id) or null. */
  get scope(): string | null {
    return this.s?.scope ?? null;
  }

  /**
   * Switches the queue to `userId` (null disables it: guest / signed out). The previous user's
   * queue is written out and dropped from memory; the new one is loaded. Events enqueued while
   * it loads are kept and placed after the stored ones.
   */
  setScope(userId: string | null): Promise<void> {
    if ((this.s?.scope ?? null) === userId) return this.s?.loading ?? Promise.resolve();
    const previous = this.s;
    this.clearTimers();
    this.hold = null;
    this.callFailures = 0;
    this.batchLimit = this.maxBatch;
    this.flushing = null;
    this.syncing = false;
    const persistPrevious = previous ? previous.writer.flush() : Promise.resolve();

    if (!userId) {
      this.s = null;
      this.notify({ kind: 'reset', scope: null });
      this.emitStatus();
      return persistPrevious;
    }

    const slot = abSlot(OUTBOX_STORAGE_PREFIX + userId, this.storage);
    const state: ScopeState = {
      scope: userId,
      entries: [],
      applied: new Map(),
      given: new Map(),
      ready: false,
      loading: Promise.resolve(),
      writer: createWriter(slot, () => serialize(state), 0),
    };
    state.loading = (async () => {
      await persistPrevious;
      let stored: Parsed = { entries: [], applied: [], given: [] };
      try {
        const raw = await slot.read();
        if (raw) stored = parsePersisted(raw);
      } catch {
        // Unreadable storage: start empty; local records are re-queued by the bridge.
      }
      const known = new Set(stored.entries.map((e) => e.eventId));
      const early = state.entries.filter((e) => !known.has(e.eventId));
      state.entries = [...stored.entries, ...early];
      for (const [id, at] of stored.applied) if (!state.applied.has(id)) state.applied.set(id, at);
      const earlyGiven = [...state.given.values()];
      state.given = new Map(stored.given.map((g) => [g.ref, g]));
      for (const g of earlyGiven) state.given.set(g.ref, g);
      state.ready = true;
      if (early.length || stored.entries.some((e) => e.attempts > 0)) state.writer.schedule();
      if (this.s === state) {
        this.emitStatus();
        this.scheduleFlush(0);
      }
    })();
    this.s = state;
    this.notify({ kind: 'reset', scope: userId });
    this.emitStatus();
    return state.loading;
  }

  /** Resolves when the current scope is loaded. */
  whenReady(): Promise<void> {
    return this.s?.loading ?? Promise.resolve();
  }

  /** Deletes a user's stored queue (account deletion). Clears memory too if it is the current scope. */
  async deleteScopeData(userId: string): Promise<void> {
    if (this.s?.scope === userId) {
      this.s.entries = [];
      this.s.applied.clear();
      this.s.given.clear();
      this.s.writer.cancel();
      this.emitStatus();
    }
    await abSlot(OUTBOX_STORAGE_PREFIX + userId, this.storage).remove();
  }

  // ----- queue ---------------------------------------------------------------------------------

  /**
   * Queues built events (FIFO). Returns the ids that are queued (an id already queued or recently
   * applied is returned without a second entry). Disabled (no scope) or malformed input -> not
   * queued. An event whose dependency is already rejected/held starts as 'held'.
   */
  enqueue(input: EnqueueInput | readonly EnqueueInput[]): string[] {
    const s = this.s;
    if (!s) return [];
    const list: readonly EnqueueInput[] = Array.isArray(input) ? input : [input as EnqueueInput];
    const ids: string[] = [];
    let added = 0;
    for (const ev of list) {
      if (!isWellFormedEvent(ev)) continue;
      const eventId = ev.eventId.toLowerCase();
      if (this.find(s, eventId) || s.applied.has(eventId)) {
        ids.push(eventId);
        continue;
      }
      const entry: OutboxEntry = {
        eventId,
        type: ev.type,
        childId: ev.childId,
        payloadJson: ev.payloadJson,
        createdAt: new Date(this.now()).toISOString(),
        attempts: 0,
        state: 'pending',
      };
      const deps = [...new Set((ev.dependsOn ?? []).map((d) => d.toLowerCase()))].filter((d) => d !== eventId);
      if (deps.length) entry.dependsOn = deps;
      if (ev.ref) entry.ref = ev.ref;
      if (deps.some((d) => this.isBlocking(this.find(s, d)))) {
        entry.state = 'held';
        entry.code = 'dependency_rejected';
      }
      s.entries.push(entry);
      ids.push(eventId);
      added += 1;
      this.notifyEntry(entry, entry.state === 'held' ? 'held' : 'pending');
    }
    if (added) {
      s.writer.schedule();
      this.emitStatus();
      this.scheduleFlush(FLUSH_DEBOUNCE_MS);
    }
    return ids;
  }

  /** State of an event: queued state, 'applied' when recently applied, else null (unknown). */
  getEventState(eventId: string): OutboxEntryState | null {
    const s = this.s;
    if (!s) return null;
    const id = eventId.toLowerCase();
    const entry = this.find(s, id);
    if (entry) return entry.state;
    return s.applied.has(id) ? 'applied' : null;
  }

  /** The queued entry (copy) or null. */
  getEntry(eventId: string): OutboxEntry | null {
    const entry = this.s ? this.find(this.s, eventId.toLowerCase()) : undefined;
    return entry ? { ...entry } : null;
  }

  /** Queued entries carrying `ref`, oldest first (copies). */
  findByRef(ref: string): OutboxEntry[] {
    return (this.s?.entries ?? []).filter((e) => e.ref === ref).map((e) => ({ ...e }));
  }

  /** Every ref that still has a queued entry (any state). */
  refs(): Set<string> {
    const out = new Set<string>();
    for (const e of this.s?.entries ?? []) if (e.ref) out.add(e.ref);
    return out;
  }

  /** Rejected and held entries (copies), oldest first: the "needs attention" list. */
  needsAttention(): OutboxEntry[] {
    return (this.s?.entries ?? []).filter((e) => e.state === 'rejected' || e.state === 'held').map((e) => ({ ...e }));
  }

  /** Number of entries waiting to be sent (pending + inflight). */
  pendingCount(): number {
    return (this.s?.entries ?? []).filter((e) => e.state === 'pending' || e.state === 'inflight').length;
  }

  /**
   * Removes a rejected or held entry (the user saw it; a fix needs a NEW event id). With
   * `giveUp` (the user dismissed it in the sync screen) its ref is remembered as given up, so
   * the bridge does not queue the same record again on the next reconcile (see GivenUpRef).
   */
  dismiss(eventId: string, options: { giveUp?: boolean } = {}): boolean {
    const s = this.s;
    const id = eventId.toLowerCase();
    const entry = s ? this.find(s, id) : undefined;
    const removed = this.dismissWhere((e) => e.eventId === id) > 0;
    if (removed && s && options.giveUp && entry?.ref) {
      s.given.delete(entry.ref);
      s.given.set(entry.ref, { ref: entry.ref, childId: entry.childId, code: entry.code ?? 'unknown', at: this.now() });
      while (s.given.size > GIVEN_UP_MAX) {
        const oldest = s.given.keys().next().value;
        if (oldest === undefined) break;
        s.given.delete(oldest);
      }
      s.writer.schedule();
    }
    return removed;
  }

  /** Was the rejected event carrying `ref` dismissed for good (given up)? */
  isGivenUp(ref: string): boolean {
    return this.s?.given.has(ref) ?? false;
  }

  /** Given-up refs (copies), oldest first. */
  givenUp(): GivenUpRef[] {
    return [...(this.s?.given.values() ?? [])].map((g) => ({ ...g }));
  }

  /** Forgets given-up refs matching `predicate` (the record changed or the cause was fixed). */
  forgetGivenUp(predicate: (g: Readonly<GivenUpRef>) => boolean): number {
    const s = this.s;
    if (!s) return 0;
    let removed = 0;
    for (const [ref, g] of [...s.given]) {
      if (!predicate(g)) continue;
      s.given.delete(ref);
      removed += 1;
    }
    if (removed) s.writer.schedule();
    return removed;
  }

  /** Removes rejected/held entries matching `predicate`. Returns how many were removed. */
  dismissWhere(predicate: (entry: Readonly<OutboxEntry>) => boolean): number {
    return this.removeWhere((e) => (e.state === 'rejected' || e.state === 'held') && predicate(e));
  }

  /**
   * After a consent (b) withdrawal: drops this child's queued DATA events (pending, held and
   * rejected; an event already in flight cannot be recalled). consent_changed events stay.
   */
  purgeChildData(childId: string): number {
    return this.removeWhere((e) => e.childId === childId && e.type !== 'consent_changed' && e.state !== 'inflight');
  }

  // ----- observation ---------------------------------------------------------------------------

  /** Listener for entry state changes and scope resets. Returns the unsubscribe function. */
  subscribe(listener: (notice: OutboxNotice) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Resolves when the event is applied, rejected or held, or after `timeoutMs`. Unknown ids
   * (and ids dropped while waiting) resolve { state: 'unknown' }.
   */
  async waitForEvent(eventId: string, timeoutMs: number): Promise<WaitResult> {
    const s = this.s;
    if (!s) return { state: 'unknown' };
    await s.loading;
    if (this.s !== s) return { state: 'unknown' };
    const id = eventId.toLowerCase();
    const settled = this.settledResult(s, id);
    if (settled) return settled;
    return new Promise<WaitResult>((resolve) => {
      let done = false;
      const finish = (result: WaitResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(result);
      };
      const timer = setTimeout(() => finish({ state: 'timeout' }), Math.max(0, timeoutMs));
      const unsubscribe = this.subscribe((n) => {
        if (n.kind === 'reset') finish({ state: 'unknown' });
        else if (n.eventId === id) {
          if (n.state === 'applied') finish({ state: 'applied' });
          else if (n.state === 'rejected') finish({ state: 'rejected', code: n.code ?? 'unknown' });
          else if (n.state === 'held') finish({ state: 'held', code: n.code ?? 'dependency_rejected' });
          else if (n.state === 'dropped') finish({ state: 'unknown' });
        }
      });
    });
  }

  /** Snapshot for the UI (also pushed to onStatus on every change). */
  getStatus(): OutboxStatus {
    const entries = this.s?.entries ?? [];
    let pending = 0;
    let held = 0;
    let rejected = 0;
    for (const e of entries) {
      if (e.state === 'pending' || e.state === 'inflight') pending += 1;
      else if (e.state === 'held') held += 1;
      else if (e.state === 'rejected') rejected += 1;
    }
    const hold = this.hold;
    return {
      scope: this.s?.scope ?? null,
      ready: this.s?.ready ?? false,
      syncing: this.syncing,
      pending,
      held,
      rejected,
      pauseReason: hold && (hold.reason === 'auth_required' || hold.reason === 'unavailable') ? hold.reason : null,
      backoffReason: hold && hold.reason !== 'auth_required' && hold.reason !== 'unavailable' ? hold.reason : null,
      nextAttemptAt: hold?.until ?? null,
      lastSuccessAt: this.lastSuccessAt,
    };
  }

  // ----- flush ---------------------------------------------------------------------------------

  /**
   * Sends every sendable event, batch after batch, until the queue has nothing sendable or a
   * call fails. Single-flight: concurrent calls share one run. `ignoreBackoff` (foreground,
   * "sync now") retries now after a network/server failure or an auth pause; a 429 or a
   * missing sync_events still waits for its time.
   */
  flush(options: { ignoreBackoff?: boolean } = {}): Promise<FlushResult> {
    if (this.flushing) return this.flushing;
    const run = this.runFlush(options).finally(() => {
      // A run abandoned by a scope switch must not touch the new scope's flags.
      if (this.flushing !== run) return;
      this.flushing = null;
      this.setSyncing(false);
    });
    this.flushing = run;
    return run;
  }

  private async runFlush(options: { ignoreBackoff?: boolean }): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, applied: 0, rejected: 0, retried: 0, stopped: null };
    const s = this.s;
    if (!s) return { ...result, stopped: 'disabled' };
    await s.loading;
    if (this.s !== s) return { ...result, stopped: 'scope_changed' };

    const hold = this.hold;
    if (hold) {
      const soft = hold.reason === 'network' || hold.reason === 'server' || hold.reason === 'auth_required';
      const due = hold.until !== null && hold.until <= this.now();
      if (due || (options.ignoreBackoff && soft)) this.hold = null;
      else return { ...result, stopped: hold.reason };
    }
    // Only send with the session of the user this queue belongs to.
    if (this.currentUserId() !== s.scope) return { ...result, stopped: 'scope_changed' };

    let refreshed = false;
    for (;;) {
      if (this.s !== s) return { ...result, stopped: 'scope_changed' };
      const batch = this.buildBatch(s, this.now());
      if (!batch.length) break;
      this.setSyncing(true);
      for (const e of batch) {
        e.state = 'inflight';
        e.attempts += 1;
      }
      s.writer.schedule();
      this.emitStatus();
      result.sent += batch.length;

      // JSON.parse of text we produced with JSON.stringify: supabase-js stringifies it again and
      // reproduces the same text (same key order, same number spelling), so the server hashes
      // the same payload on every attempt (SYNC_EVENTS.md §4).
      const wire: WireEvent[] = batch.map((e) => ({ event_id: e.eventId, type: e.type, payload: JSON.parse(e.payloadJson) }));
      let response: TransportResponse;
      try {
        response = await this.transport(wire);
      } catch {
        response = { data: null, error: { message: 'network' }, status: 0 };
      }
      const outcome = classify(response, batch);
      const current = this.s === s;

      if (outcome.kind === 'results') {
        this.applyResults(s, batch, outcome.items, result, current);
        if (!current) return { ...result, stopped: 'scope_changed' };
        this.callFailures = 0;
        this.lastSuccessAt = this.now();
        this.emitStatus();
        continue;
      }

      // Call-level failure: nothing was confirmed; the same events (same ids and payload text)
      // go out again later.
      for (const e of batch) if (e.state === 'inflight') e.state = 'pending';
      s.writer.schedule();
      if (!current) return { ...result, stopped: 'scope_changed' };

      if (outcome.kind === 'batch_size' && batch.length > 1) {
        this.batchLimit = Math.max(1, Math.floor(batch.length / 2));
        continue;
      }
      if (outcome.kind === 'auth' && !refreshed) {
        refreshed = true;
        const refresh = await this.refreshSession();
        if (this.s !== s) return { ...result, stopped: 'scope_changed' };
        if (refresh === 'ok') continue;
        if (refresh === 'network') {
          this.enterBackoff('network');
          return { ...result, stopped: 'network' };
        }
      }
      if (outcome.kind === 'auth') {
        // The outbox stays intact; the user signs in again (or the next foreground retries).
        this.setHold({ reason: 'auth_required', until: null });
        return { ...result, stopped: 'auth_required' };
      }
      if (outcome.kind === 'unavailable') {
        this.setHold({ reason: 'unavailable', until: this.now() + UNAVAILABLE_RETRY_MS });
        return { ...result, stopped: 'unavailable' };
      }
      if (outcome.kind === 'rate_limited') {
        this.enterBackoff('rate_limited', outcome.retryAfterS);
        return { ...result, stopped: 'rate_limited' };
      }
      const reason: BackoffReason = outcome.kind === 'network' ? 'network' : 'server';
      this.enterBackoff(reason);
      return { ...result, stopped: reason };
    }

    this.scheduleEntryRetry(s);
    this.emitStatus();
    return result;
  }

  private buildBatch(s: ScopeState, now: number): OutboxEntry[] {
    const batch: OutboxEntry[] = [];
    const inBatch = new Set<string>();
    const blockedChildren = new Set<string>();
    let bytes = 2;
    for (const e of s.entries) {
      if (batch.length >= this.batchLimit) break;
      if (e.state === 'inflight') blockedChildren.add(e.childId);
      if (e.state !== 'pending') continue;
      // FIFO per child: a waiting event holds back the later events of the same child.
      if (blockedChildren.has(e.childId)) continue;
      const waiting =
        (e.nextAttemptAt !== undefined && e.nextAttemptAt > now) ||
        !(e.dependsOn ?? []).every((d) => inBatch.has(d) || this.dependencySatisfied(s, d));
      if (waiting) {
        blockedChildren.add(e.childId);
        continue;
      }
      const size = utf8ByteLength(e.payloadJson) + 120; // + envelope
      if (batch.length > 0 && bytes + size > MAX_BATCH_BYTES) break;
      batch.push(e);
      inBatch.add(e.eventId);
      bytes += size;
    }
    return batch;
  }

  private applyResults(
    s: ScopeState,
    batch: OutboxEntry[],
    items: { status: 'applied' | 'rejected'; code: string | null }[],
    result: FlushResult,
    notify: boolean,
  ) {
    const now = this.now();
    const notices: [OutboxEntry, 'applied' | 'rejected' | 'held'][] = [];
    const appliedIds = new Set<string>();
    batch.forEach((e, i) => {
      const item = items[i];
      if (item.status === 'applied') {
        appliedIds.add(e.eventId);
        s.applied.delete(e.eventId);
        s.applied.set(e.eventId, now);
        result.applied += 1;
        notices.push([e, 'applied']);
      } else if (item.code === 'internal_error') {
        // The only retryable rejection: same event id after a pause.
        e.state = 'pending';
        e.nextAttemptAt = now + backoffDelay(e.attempts, this.random);
        result.retried += 1;
      } else {
        e.state = 'rejected';
        e.code = item.code ?? 'unknown';
        delete e.nextAttemptAt;
        result.rejected += 1;
        notices.push([e, 'rejected']);
        if (!DEPENDENCY_OK_CODES.has(e.code)) {
          for (const held of this.holdDependents(s, e.eventId)) notices.push([held, 'held']);
        }
      }
    });
    s.entries = s.entries.filter((e) => !appliedIds.has(e.eventId));
    while (s.applied.size > RECENT_APPLIED_MAX) {
      const oldest = s.applied.keys().next().value;
      if (oldest === undefined) break;
      s.applied.delete(oldest);
    }
    s.writer.schedule();
    if (notify) for (const [entry, state] of notices) this.notifyEntry(entry, state);
  }

  /** Marks pending entries that (transitively) depend on `rootId` as held. */
  private holdDependents(s: ScopeState, rootId: string): OutboxEntry[] {
    const blocked = new Set([rootId]);
    const held: OutboxEntry[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of s.entries) {
        if (e.state !== 'pending' || !e.dependsOn?.some((d) => blocked.has(d))) continue;
        e.state = 'held';
        e.code = 'dependency_rejected';
        delete e.nextAttemptAt;
        blocked.add(e.eventId);
        held.push(e);
        changed = true;
      }
    }
    return held;
  }

  private dependencySatisfied(s: ScopeState, id: string): boolean {
    const dep = this.find(s, id);
    // Not queued any more = applied (or removed on purpose).
    if (!dep) return true;
    return dep.state === 'rejected' && DEPENDENCY_OK_CODES.has(dep.code ?? '');
  }

  private isBlocking(dep: OutboxEntry | undefined): boolean {
    if (!dep) return false;
    if (dep.state === 'held') return true;
    return dep.state === 'rejected' && !DEPENDENCY_OK_CODES.has(dep.code ?? '');
  }

  private settledResult(s: ScopeState, id: string): WaitResult | null {
    const entry = this.find(s, id);
    if (entry) {
      if (entry.state === 'rejected') return { state: 'rejected', code: entry.code ?? 'unknown' };
      if (entry.state === 'held') return { state: 'held', code: entry.code ?? 'dependency_rejected' };
      return null;
    }
    return s.applied.has(id) ? { state: 'applied' } : { state: 'unknown' };
  }

  // ----- helpers -------------------------------------------------------------------------------

  private find(s: ScopeState, id: string): OutboxEntry | undefined {
    return s.entries.find((e) => e.eventId === id);
  }

  private removeWhere(predicate: (e: OutboxEntry) => boolean): number {
    const s = this.s;
    if (!s) return 0;
    const removed = s.entries.filter(predicate);
    if (!removed.length) return 0;
    const ids = new Set(removed.map((e) => e.eventId));
    s.entries = s.entries.filter((e) => !ids.has(e.eventId));
    s.writer.schedule();
    for (const e of removed) this.notifyEntry(e, 'dropped');
    this.emitStatus();
    return removed.length;
  }

  private enterBackoff(reason: BackoffReason, retryAfterS?: number) {
    this.callFailures += 1;
    let delay = backoffDelay(this.callFailures, this.random);
    if (retryAfterS && retryAfterS > 0) delay = Math.max(delay, Math.round(retryAfterS * 1000));
    this.setHold({ reason, until: this.now() + delay });
  }

  private setHold(hold: Hold) {
    this.hold = hold;
    this.emitStatus();
    if (hold.until !== null) this.scheduleRetry(hold.until - this.now());
  }

  /** After a drained flush: wake up when the earliest internal_error retry is due. */
  private scheduleEntryRetry(s: ScopeState) {
    const now = this.now();
    let next: number | null = null;
    for (const e of s.entries) {
      if (e.state === 'pending' && e.nextAttemptAt !== undefined && e.nextAttemptAt > now) {
        next = next === null ? e.nextAttemptAt : Math.min(next, e.nextAttemptAt);
      }
    }
    if (next !== null) this.scheduleRetry(next - now);
  }

  private scheduleFlush(delayMs: number) {
    if (!this.autoFlush || !this.s) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, delayMs);
  }

  private scheduleRetry(delayMs: number) {
    if (!this.autoFlush || !this.s) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, Math.max(0, delayMs));
  }

  private clearTimers() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.debounceTimer = null;
    this.retryTimer = null;
  }

  private setSyncing(value: boolean) {
    if (this.syncing === value) return;
    this.syncing = value;
    this.emitStatus();
  }

  private notifyEntry(e: OutboxEntry, state: 'pending' | 'applied' | 'rejected' | 'held' | 'dropped') {
    this.notify({
      kind: 'entry',
      eventId: e.eventId,
      type: e.type,
      childId: e.childId,
      ref: e.ref ?? null,
      state,
      code: e.code ?? null,
    });
  }

  private notify(notice: OutboxNotice) {
    for (const listener of [...this.listeners]) {
      try {
        listener(notice);
      } catch {
        // A failing listener must not break the queue.
      }
    }
  }

  private emitStatus() {
    this.onStatus?.(this.getStatus());
  }
}

function serialize(s: ScopeState): string {
  const persisted: Persisted = { v: 1, entries: s.entries, applied: [...s.applied.entries()], given: [...s.given.values()] };
  return JSON.stringify(persisted);
}

/** sync_events answer -> what the flush loop does next. */
function classify(res: TransportResponse, batch: readonly OutboxEntry[]): CallOutcome {
  if (!res.error) {
    const data = res.data;
    if (!Array.isArray(data) || data.length !== batch.length) return { kind: 'bad_response' };
    const items: { status: 'applied' | 'rejected'; code: string | null }[] = [];
    for (let i = 0; i < data.length; i++) {
      const item = data[i] as { status?: unknown; code?: unknown; event_id?: unknown } | null;
      if (!item || typeof item !== 'object') return { kind: 'bad_response' };
      if (item.event_id !== null && item.event_id !== undefined) {
        if (typeof item.event_id !== 'string' || item.event_id.toLowerCase() !== batch[i].eventId) {
          return { kind: 'bad_response' };
        }
      }
      if (item.status === 'applied') items.push({ status: 'applied', code: null });
      else if (item.status === 'rejected' && typeof item.code === 'string') items.push({ status: 'rejected', code: item.code });
      else return { kind: 'bad_response' };
    }
    return { kind: 'results', items };
  }
  const code = typeof res.error.code === 'string' ? res.error.code : '';
  const message = typeof res.error.message === 'string' ? res.error.message : '';
  const status = res.status;
  if (code === 'not_configured' || code === 'PGRST202' || code === '42883' || status === 404) return { kind: 'unavailable' };
  if (code === '22023' && (message === 'batch_size_out_of_range' || message === 'batch_too_large')) {
    return { kind: 'batch_size' };
  }
  if (status === 401 || status === 403 || code === '28000' || /^PGRST30[123]$/.test(code) || message === 'not_authenticated') {
    return { kind: 'auth' };
  }
  if (status === 429) return { kind: 'rate_limited', retryAfterS: res.retryAfterS };
  if (!status) return { kind: 'network' };
  // 5xx and unexpected 4xx (e.g. batch_must_be_array): back off instead of looping.
  return { kind: 'server' };
}

// ---------------------------------------------------------------------------------------------
// App singleton
// ---------------------------------------------------------------------------------------------

const initialStatus: OutboxStatus = {
  scope: null,
  ready: false,
  syncing: false,
  pending: 0,
  held: 0,
  rejected: 0,
  pauseReason: null,
  backoffReason: null,
  nextAttemptAt: null,
  lastSuccessAt: null,
};

/** Outbox status for React (useSyncStatus, "needs attention" badges). */
export const useOutboxStatus = create<OutboxStatus>(() => ({ ...initialStatus }));

/** The app's outbox (supabase.rpc transport, appStorage). Scope is set by the sync engine. */
export const outbox = new Outbox({ onStatus: (status) => useOutboxStatus.setState(status) });

