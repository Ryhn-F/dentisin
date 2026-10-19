// Domain -> sync events. Decides WHAT may be queued for WHOM, builds the event (./events.ts) and
// queues it in the outbox (./outbox.ts) with its dependencies. The local store calls these
// functions from its actions; feature code calls the two stateless ones directly
// (recordScreeningRequest, recordBrushingProof). Every function returns the queued event id,
// or null when nothing may be sent (guest, signed out, account not loaded, wrong account type,
// consent missing, invalid input). Never throws, never logs.
//
// Gating (SYNC_EVENTS.md §3, §5; ACCOUNTS_AND_FLOWS.md §1, §2):
// - Nothing in guest mode or signed out; nothing before my_account() is known for the session.
// - guardian / teen ("adult"): data events (child_upserted, screening_recorded,
//   brushing_recorded, referral_created) only for a child whose LOCAL consent (b) is granted.
//   The (b) grant creates the server profile, so those events depend on the queued (b) grant.
//   Grants of (a)/(c)/(d) wait for (b); withdrawals are always sent. A (b) grant backfills the
//   child's unsynced profile, consents and records; a (b) withdrawal purges its queued data.
//   A teen only syncs its self profile (is_self), with its own consents (teen text versions).
// - child account: only brushing_recorded, screening_requested, brushing_proof_registered, for
//   its own child, while my_account().child_account.sync_allowed is not false. It has no local
//   consents (the parent's consents live on the server).
// - Guardians never send brushing_proof_registered or screening_requested; teens never send
//   screening_requested. A legacy (pre-ADR 017) backend gets no consent (d) and no request_id.
//
// Final rejections (SYNC_EVENTS.md §2, §6): a record whose rejected event the user dismissed is
// "given up" (outbox.isGivenUp) and is not re-queued by reconcile until the record really
// changes (local store action) or the cause is fixed (consent (b) grant). A child account has
// no sync screen: its consent_required / forbidden / dependency_rejected entries are retried
// with NEW event ids once the parent fixed the cause (see retryChildRejections).

import { useAccount } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { newUuid } from '@/core/util/uuid';
import { setLocalSyncHooks, useLocalData, type LocalSyncHooks, type ReferralRecord } from '@/data/local-store';
import type {
  BrushingRecord,
  ChildProfile,
  ConsentType,
  MyAccount,
  ProofMime,
  RequestReason,
  ScreeningRecord,
} from '@/domain/models';

import {
  buildBrushingProofRegistered,
  buildBrushingRecorded,
  buildChildUpserted,
  buildConsentChanged,
  buildReferralCreated,
  buildScreeningRecorded,
  buildScreeningRequested,
  type BuiltEvent,
  type ConsentAction,
} from './events';
import { outbox, type OutboxNotice } from './outbox';

// ---------------------------------------------------------------------------------------------
// Refs: link between an outbox entry and the local record it carries
// ---------------------------------------------------------------------------------------------

export const syncRefs = {
  consent: (childId: string, type: ConsentType, action: ConsentAction) => `consent:${childId}:${type}:${action}`,
  child: (childId: string) => `child:${childId}`,
  brushing: (id: string) => `brushing:${id}`,
  screening: (id: string) => `screening:${id}`,
  referral: (id: string) => `referral:${id}`,
  request: (id: string) => `request:${id}`,
  proof: (id: string) => `proof:${id}`,
} as const;

// ---------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------

export type SyncContext =
  | { kind: 'guardian' | 'teen'; userId: string; me: MyAccount }
  | { kind: 'child'; userId: string; me: MyAccount; childId: string; syncAllowed: boolean };

/**
 * Who may sync right now, or null: signed in, my_account() loaded for this session, and the
 * outbox and the local store both scoped to this user.
 */
export function syncContext(): SyncContext | null {
  const session = useSession.getState();
  const userId = session.userId;
  if (session.status !== 'signedIn' || !userId) return null;
  const me = useAccount.getState().me;
  if (!me || me.userId !== userId) return null;
  if (outbox.scope !== userId || useLocalData.getState().scope !== userId) return null;
  if (me.accountType === 'child') {
    if (!me.childAccount) return null;
    return { kind: 'child', userId, me, childId: me.childAccount.childId, syncAllowed: me.childAccount.syncAllowed !== false };
  }
  return { kind: me.accountType, userId, me };
}

type AdultContext = Extract<SyncContext, { kind: 'guardian' | 'teen' }>;
type ChildContext = Extract<SyncContext, { kind: 'child' }>;

function adultContext(): AdultContext | null {
  const ctx = syncContext();
  return ctx && ctx.kind !== 'child' ? ctx : null;
}

/** Child ids an adult account may sync: any own child (guardian) or the self profile (teen). */
function adultMaySync(ctx: AdultContext, childId: string): boolean {
  const store = useLocalData.getState();
  if (store.syncBlocked[childId]) return false;
  if (ctx.kind === 'guardian') return true;
  if (ctx.me.selfChildId) return childId === ctx.me.selfChildId;
  // Cached account from before ensure_self_profile: trust the local self profile.
  return store.kids.some((k) => k.id === childId && k.isSelf === true);
}

function consentOn(childId: string, type: ConsentType): boolean {
  return useLocalData.getState().consentRecords[childId]?.[type]?.value === true;
}

/** Latest queued event for `ref` (any state), or null. */
function latestQueued(ref: string): string | null {
  const entries = outbox.findByRef(ref);
  return entries.length ? entries[entries.length - 1].eventId : null;
}

/**
 * The queued consent_changed grant of `type` for a child, or null when none is queued (applied
 * or never sent). Feature code can wait for it with outbox.waitForEvent, e.g. before creating a
 * child account (the (b) grant creates the server profile).
 */
export function queuedConsentGrant(childId: string, type: ConsentType): string | null {
  return latestQueued(syncRefs.consent(childId, type, 'grant'));
}

function hasQueuedConsent(childId: string, type: ConsentType): boolean {
  return [syncRefs.consent(childId, type, 'grant'), syncRefs.consent(childId, type, 'withdraw')].some(
    (ref) => outbox.findByRef(ref).length > 0 || outbox.isGivenUp(ref),
  );
}

/** reconcile must not queue `ref`: an event is queued for it, or the user gave it up. */
function skipRef(refs: ReadonlySet<string>, ref: string): boolean {
  return refs.has(ref) || outbox.isGivenUp(ref);
}

/** The record behind `refs` changed locally: a given-up rejection gets a fresh chance. */
function forgetGivenUp(...refs: string[]) {
  const set = new Set(refs);
  outbox.forgetGivenUp((g) => set.has(g.ref));
}

function enqueue(make: () => BuiltEvent, ref: string, deps: readonly (string | null | undefined)[]): string | null {
  try {
    const event = make();
    const dependsOn = deps.filter((d): d is string => typeof d === 'string');
    const [id] = outbox.enqueue({ ...event, ref, dependsOn });
    return id ?? null;
  } catch {
    // Invalid input (SyncEventError) or anything unexpected: never break the caller.
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Record functions
// ---------------------------------------------------------------------------------------------

const reconciling = new Set<string>();

/**
 * consent_changed for a child (adult accounts). (b) is always sent; other grants only while (b)
 * is granted locally (they depend on its queued grant); withdrawals always. Side effects: a (b)
 * grant backfills the child; a (b) withdrawal purges the child's queued data events.
 */
export function recordConsent(
  childId: string,
  type: ConsentType,
  action: ConsentAction,
  textVersion: string | null,
  at?: string,
): string | null {
  const ctx = adultContext();
  if (!ctx || !adultMaySync(ctx, childId)) return null;
  if (type === 'd' && ctx.me.legacy) return null; // pre-ADR 017 backend: no consent (d)
  if (type !== 'b' && action === 'grant' && !consentOn(childId, 'b')) return null;
  const deps = type === 'b' ? [] : [queuedConsentGrant(childId, 'b')];
  const id = enqueue(
    () => buildConsentChanged({ childId, consentType: type, action, textVersion, at }),
    syncRefs.consent(childId, type, action),
    deps,
  );
  if (type === 'b' && id) {
    if (action === 'grant') {
      // Entries that failed only because (b) was missing get a fresh chance (new event ids).
      outbox.dismissWhere(
        (e) =>
          e.childId === childId &&
          (e.code === 'dependency_rejected' || (e.code === 'consent_required' && e.type !== 'consent_changed')),
      );
      // Same for records whose rejection the user already dismissed.
      outbox.forgetGivenUp(
        (g) =>
          g.childId === childId &&
          (g.code === 'dependency_rejected' || (g.code === 'consent_required' && !g.ref.startsWith('consent:'))),
      );
      reconcileChild(ctx, childId);
    } else {
      outbox.purgeChildData(childId);
    }
  }
  return id;
}

/** child_upserted (adult accounts, consent (b) granted locally). */
export function recordChild(child: ChildProfile): string | null {
  const ctx = adultContext();
  if (!ctx || !adultMaySync(ctx, child.id) || !consentOn(child.id, 'b')) return null;
  return enqueue(
    () => buildChildUpserted({ childId: child.id, birthYear: child.birthYear, birthMonth: child.birthMonth, allergies: child.allergies }),
    syncRefs.child(child.id),
    [queuedConsentGrant(child.id, 'b')],
  );
}

/**
 * brushing_recorded. Adult: needs consent (b). Child account: its own child, sync allowed.
 * Returns the already-queued event id when the record is queued; null when synced.
 */
export function recordBrushing(record: BrushingRecord): string | null {
  if (record.synced) return null;
  const ctx = syncContext();
  if (!ctx) return null;
  let deps: (string | null)[] = [];
  if (ctx.kind === 'child') {
    if (record.childId !== ctx.childId || !ctx.syncAllowed) return null;
  } else {
    if (!adultMaySync(ctx, record.childId) || !consentOn(record.childId, 'b')) return null;
    deps = [queuedConsentGrant(record.childId, 'b')];
  }
  const queued = latestQueued(syncRefs.brushing(record.id));
  if (queued) return queued;
  return enqueue(() => buildBrushingRecorded(record), syncRefs.brushing(record.id), deps);
}

/** screening_recorded (adult accounts, consent (b)). Includes request_id when the screening answers a request. */
export function recordScreening(record: ScreeningRecord): string | null {
  if (record.synced) return null;
  const ctx = adultContext();
  if (!ctx || !adultMaySync(ctx, record.childId) || !consentOn(record.childId, 'b')) return null;
  const queued = latestQueued(syncRefs.screening(record.id));
  if (queued) return queued;
  const input = ctx.me.legacy ? { ...record, requestId: null } : record;
  return enqueue(() => buildScreeningRecorded(input), syncRefs.screening(record.id), [queuedConsentGrant(record.childId, 'b')]);
}

/**
 * referral_created (adult accounts, consent (b)). Depends on its screening's event: the screening
 * is queued first when it is not synced yet (the server needs it applied, SYNC_EVENTS.md §3.5).
 */
export function recordReferral(referral: ReferralRecord): string | null {
  if (referral.synced) return null;
  const ctx = adultContext();
  if (!ctx || !adultMaySync(ctx, referral.childId) || !consentOn(referral.childId, 'b')) return null;
  const queued = latestQueued(syncRefs.referral(referral.id));
  if (queued) return queued;
  let screeningDep: string | null = null;
  if (referral.screeningId) {
    const screening = useLocalData.getState().screenings.find((s) => s.id === referral.screeningId);
    if (screening && !screening.synced) {
      screeningDep = recordScreening(screening);
      if (!screeningDep) return null;
    }
  }
  return enqueue(
    () =>
      buildReferralCreated({
        referralId: referral.id,
        childId: referral.childId,
        screeningId: referral.screeningId,
        level: referral.level,
        reasonCodes: referral.reasonCodes,
        facilityCode: referral.facilityCode,
        referredAt: referral.referredAt,
      }),
    syncRefs.referral(referral.id),
    [queuedConsentGrant(referral.childId, 'b'), screeningDep],
  );
}

export type ScreeningRequestInput = {
  childId: string;
  reasonCode: RequestReason;
  painLevel: number | null;
  /** Default newUuid(). */
  requestId?: string;
};

/**
 * screening_requested: child accounts only, for their own child, while sync is allowed. Red
 * flags are handled locally by the caller first (the server judges nothing). Check the result
 * with outbox.waitForEvent (limit_exceeded = daily limit reached).
 */
export function recordScreeningRequest(input: ScreeningRequestInput): string | null {
  const ctx = syncContext();
  if (!ctx || ctx.kind !== 'child' || input.childId !== ctx.childId || !ctx.syncAllowed) return null;
  const requestId = input.requestId ?? newUuid();
  return enqueue(
    () => buildScreeningRequested({ requestId, childId: input.childId, reasonCode: input.reasonCode, painLevel: input.painLevel }),
    syncRefs.request(requestId),
    [],
  );
}

export type BrushingProofInput = {
  proofId: string;
  childId: string;
  /** Local BrushingRecord id (= brushing_id of its brushing_recorded event). */
  brushingRecordId: string;
  sizeBytes: number;
  durationS: number;
  mime: ProofMime;
};

/**
 * brushing_proof_registered (child account for its own child, or teen for its self profile with
 * local consents (b) + (d)), gated on my_account().capabilities.registerProofs. Queues the
 * brushing event first when needed and depends on it; links the proof id to the local record.
 * Upload the file only after this event is applied (outbox.waitForEvent).
 */
export function recordBrushingProof(input: BrushingProofInput): string | null {
  const ctx = syncContext();
  if (!ctx || !ctx.me.capabilities.registerProofs || ctx.me.legacy) return null;
  const deps: (string | null)[] = [];
  if (ctx.kind === 'child') {
    if (input.childId !== ctx.childId || !ctx.syncAllowed) return null;
  } else if (ctx.kind === 'teen') {
    if (!adultMaySync(ctx, input.childId) || !consentOn(input.childId, 'b') || !consentOn(input.childId, 'd')) return null;
    deps.push(queuedConsentGrant(input.childId, 'b'), queuedConsentGrant(input.childId, 'd'));
  } else {
    return null; // guardians watch proofs; they never register them (ADR 018)
  }
  const store = useLocalData.getState();
  const brushing = store.brushing.find((r) => r.id === input.brushingRecordId && r.childId === input.childId);
  if (!brushing || (brushing.proofId && brushing.proofId !== input.proofId)) return null;
  const queued = latestQueued(syncRefs.proof(input.proofId));
  if (queued) return queued;
  let brushingDep: string | null = null;
  if (!brushing.synced) {
    brushingDep = recordBrushing(brushing);
    if (!brushingDep) return null;
  }
  const id = enqueue(
    () =>
      buildBrushingProofRegistered(
        {
          proofId: input.proofId,
          childId: input.childId,
          brushingEventId: brushing.id,
          sizeBytes: input.sizeBytes,
          durationS: input.durationS,
          mime: input.mime,
        },
        { limits: ctx.me.limits },
      ),
    syncRefs.proof(input.proofId),
    [...deps, brushingDep],
  );
  if (id) store.attachProof(brushing.id, input.proofId);
  return id;
}

// ---------------------------------------------------------------------------------------------
// Reconcile (backfill)
// ---------------------------------------------------------------------------------------------

function reconcileChild(ctx: AdultContext, childId: string): number {
  if (reconciling.has(childId) || !adultMaySync(ctx, childId)) return 0;
  reconciling.add(childId);
  let queued = 0;
  const count = (id: string | null) => {
    if (id) queued += 1;
  };
  try {
    const store = useLocalData.getState();
    const records = store.consentRecords[childId] ?? {};
    // (b) first: it creates the server profile and gates everything else.
    const b = records.b;
    if (b && !b.synced && !hasQueuedConsent(childId, 'b')) {
      count(recordConsent(childId, 'b', b.value ? 'grant' : 'withdraw', b.textVersion, b.at));
    }
    for (const type of ['a', 'c', 'd'] as const) {
      const rec = records[type];
      if (!rec || rec.synced || hasQueuedConsent(childId, type)) continue;
      count(recordConsent(childId, type, rec.value ? 'grant' : 'withdraw', rec.textVersion, rec.at));
    }
    if (!consentOn(childId, 'b')) return queued;
    const refs = outbox.refs();
    const kid = store.kids.find((k) => k.id === childId);
    if (kid && store.unsyncedChildren.includes(childId) && !skipRef(refs, syncRefs.child(childId))) count(recordChild(kid));
    // Oldest first, so the server sees them in the order they happened.
    for (const r of [...store.brushing].reverse()) {
      if (r.childId === childId && !r.synced && !skipRef(refs, syncRefs.brushing(r.id))) count(recordBrushing(r));
    }
    for (const r of [...store.screenings].reverse()) {
      if (r.childId === childId && !r.synced && !skipRef(refs, syncRefs.screening(r.id))) count(recordScreening(r));
    }
    for (const r of [...store.referrals].reverse()) {
      if (r.childId === childId && !r.synced && !skipRef(refs, syncRefs.referral(r.id))) count(recordReferral(r));
    }
    return queued;
  } finally {
    reconciling.delete(childId);
  }
}

/**
 * Rejection codes a child account recovers from once its parent fixes the cause: consent (b)
 * or (d) granted again (consent_required), account re-enabled (forbidden), or the event it
 * depended on (dependency_rejected). SYNC_EVENTS.md §2: send a NEW event (new event_id).
 */
const CHILD_RECOVERABLE_CODES: ReadonlySet<string> = new Set(['consent_required', 'forbidden', 'dependency_rejected']);

/**
 * A child account cannot see its parent's consents (sync_allowed only says "not disabled"), so a
 * recoverable rejection is also tried again after this long. Bounds the retries while the
 * consent stays withdrawn.
 */
export const CHILD_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

/** child_account flags last seen per user (this app run), to notice the parent fixing things. */
const lastChildAccount = new Map<string, { syncAllowed: boolean; proofAllowed: boolean }>();

/**
 * Child accounts: dismisses this child's recoverable rejected / held entries so reconcile queues
 * their records again with new event ids. Everything is retried at once when `force` (an event
 * of this child was just applied, so consent and account are fine again) or when my_account()
 * shows the parent re-enabled the account or turned proofs on; otherwise only entries older
 * than CHILD_RETRY_AFTER_MS. Returns the refs of the dismissed entries.
 */
function retryChildRejections(ctx: ChildContext, force: boolean, now: number = Date.now()): string[] {
  const state = { syncAllowed: ctx.syncAllowed, proofAllowed: ctx.me.childAccount?.proofAllowed === true };
  const prev = lastChildAccount.get(ctx.userId);
  lastChildAccount.set(ctx.userId, state);
  if (!ctx.syncAllowed) return [];
  const improved = !!prev && ((!prev.syncAllowed && state.syncAllowed) || (!prev.proofAllowed && state.proofAllowed));
  const due = (at: number) => force || improved || !(now - at < CHILD_RETRY_AFTER_MS);
  outbox.forgetGivenUp((g) => g.childId === ctx.childId && CHILD_RECOVERABLE_CODES.has(g.code) && due(g.at));
  const retry = outbox
    .needsAttention()
    .filter((e) => e.childId === ctx.childId && CHILD_RECOVERABLE_CODES.has(e.code ?? '') && due(Date.parse(e.createdAt)));
  if (!retry.length) return [];
  const ids = new Set(retry.map((e) => e.eventId));
  outbox.dismissWhere((e) => ids.has(e.eventId));
  return retry.map((e) => e.ref).filter((ref): ref is string => typeof ref === 'string');
}

/**
 * Queues every unsynced local record that has no queued event (safety net after a crash, an
 * account change, a backend upgrade, or sync becoming allowed). Cheap and idempotent; the sync
 * engine runs it when the scope is ready and when my_account() changes. Returns how many
 * events were queued.
 */
export function reconcile(): number {
  const ctx = syncContext();
  const store = useLocalData.getState();
  if (!ctx || !store.ready || !outbox.getStatus().ready) return 0;
  if (ctx.kind === 'child') {
    retryChildRejections(ctx, false);
    if (!ctx.syncAllowed) return 0;
    const refs = outbox.refs();
    let queued = 0;
    for (const r of [...store.brushing].reverse()) {
      if (r.childId === ctx.childId && !r.synced && !skipRef(refs, syncRefs.brushing(r.id)) && recordBrushing(r)) queued += 1;
    }
    return queued;
  }
  let queued = 0;
  for (const kid of store.kids) queued += reconcileChild(ctx, kid.id);
  return queued;
}

// ---------------------------------------------------------------------------------------------
// Results -> local records
// ---------------------------------------------------------------------------------------------

/** Outbox listener: marks records synced; handles entity_conflict and deletion_pending. */
export function handleOutboxNotice(n: OutboxNotice): void {
  if (n.kind !== 'entry' || !n.ref) return;
  if (n.state !== 'applied' && n.state !== 'rejected') return;
  const store = useLocalData.getState();
  if (n.state === 'rejected' && n.code === 'deletion_pending') {
    // The server stopped taking data for this child (SYNC_EVENTS.md §2): stop queueing it and
    // drop everything still queued for it (consents too: the deletion cannot be undone).
    store.blockChildSync(n.childId, 'deletion_pending');
    outbox.purgeChild(n.childId);
    return;
  }
  // entity_conflict: the id already exists under another event id -> it is on the server.
  const onServer = n.state === 'applied' || n.code === 'entity_conflict';
  if (!onServer) return;
  const [kind, id, type, action] = n.ref.split(':');
  const othersQueued = (ref: string) => outbox.findByRef(ref).some((e) => e.eventId !== n.eventId);
  switch (kind) {
    case 'brushing':
    case 'screening':
    case 'referral':
      store.markSynced(kind, id);
      break;
    case 'child':
      if (!othersQueued(n.ref)) store.markChildSynced(id);
      break;
    case 'consent': {
      const t = type as ConsentType;
      const rec = store.consentRecords[id]?.[t];
      const pending = othersQueued(syncRefs.consent(id, t, 'grant')) || othersQueued(syncRefs.consent(id, t, 'withdraw'));
      if (rec && !pending && rec.value === (action === 'grant')) store.markConsentSynced(id, t);
      break;
    }
  }
  if (n.state === 'rejected') outbox.dismiss(n.eventId);
  if (n.state === 'applied') {
    // Child account: an applied event proves consent and account are fine again, so the
    // records rejected meanwhile go out again now (new event ids). After markSynced above, so
    // reconcile does not queue the record that was just applied.
    // Only the dismissed records: the other events of the same batch are not marked synced yet.
    const ctx = syncContext();
    if (ctx?.kind === 'child' && n.childId === ctx.childId) {
      for (const ref of retryChildRejections(ctx, true)) {
        const [refKind, refId] = ref.split(':');
        if (refKind !== 'brushing') continue; // proofs failed with their brushing; requests are not resent
        const record = useLocalData.getState().brushing.find((r) => r.id === refId);
        if (record && !record.synced) recordBrushing(record);
      }
    }
  }
}

// Local store actions are real changes: a record the user gave up on gets a fresh chance.
const localHooks: LocalSyncHooks = {
  consent: (childId, type, action, textVersion, at) => {
    forgetGivenUp(syncRefs.consent(childId, type, 'grant'), syncRefs.consent(childId, type, 'withdraw'));
    void recordConsent(childId, type, action, textVersion, at);
  },
  child: (child) => {
    forgetGivenUp(syncRefs.child(child.id));
    void recordChild(child);
  },
  brushing: (record) => {
    forgetGivenUp(syncRefs.brushing(record.id));
    void recordBrushing(record);
  },
  screening: (record) => {
    forgetGivenUp(syncRefs.screening(record.id));
    void recordScreening(record);
  },
  referral: (referral) => {
    forgetGivenUp(syncRefs.referral(referral.id));
    void recordReferral(referral);
  },
};

let unsubscribe: (() => void) | null = null;

/**
 * Connects the local store's actions to this bridge and the bridge to outbox results
 * (idempotent). The sync engine calls it at app start. Returns the uninstall function.
 */
export function installSyncBridge(): () => void {
  setLocalSyncHooks(localHooks);
  if (!unsubscribe) unsubscribe = outbox.subscribe(handleOutboxNotice);
  return () => {
    setLocalSyncHooks(null);
    unsubscribe?.();
    unsubscribe = null;
  };
}
