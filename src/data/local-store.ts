// The app's local data: children, consents, brushing, screenings and referrals of ONE scope
// (the signed-in user id, or 'guest' in no-account mode), persisted on this phone.
//
// - Persistence: appStorage (Keystore-backed SecureStore, chunked) through an A/B slot and a
//   debounced writer (src/data/persist.ts). `ready` is false while a scope loads.
// - Scope: set by the sync engine (src/core/sync/engine.ts) from the session. A parent and a
//   child sharing one phone have separate scopes; switching writes the old scope out and loads
//   the new one, so their data never mixes. Scope null (signed out) is memory-only and empty.
// - Retention: every unsynced record is kept; synced brushing records older than 120 days are
//   trimmed on load and on write.
// - Sync: store actions call the sync bridge (src/core/sync/bridge.ts) through LocalSyncHooks,
//   which the bridge installs (installSyncBridge, done by the sync engine at app start). The
//   bridge decides whether an event may be queued (account type, consent (b), guest mode) and
//   marks records synced when their event is applied. Callers never talk to the outbox for
//   these records. (Hooks instead of an import keep this module free of a require cycle.)
//
// Privacy: this is personal health data. Nothing here logs.

import { create } from 'zustand';

import { isUuid, newUuid } from '@/core/util/uuid';
import {
  consentTextVersions,
  consentTypes,
  emptyConsentState,
  type AppLevel,
  type BrushingRecord,
  type BrushingSlot,
  type ChildProfile,
  type ChildSummary,
  type ConsentGiver,
  type ConsentState,
  type ConsentType,
  type MyAccount,
  type ScreeningRecord,
} from '@/domain/models';
import { slotForTime } from '@/domain/streak';

import { abSlot, createWriter, type Slot, type Writer } from './persist';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export const LOCAL_STORAGE_PREFIX = 'dentisai.local.v1.';
/** Scope of no-account mode. Never synced. */
export const GUEST_SCOPE = 'guest';
export const SYNCED_BRUSHING_RETENTION_DAYS = 120;
const WRITE_DEBOUNCE_MS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One consent choice for one child (a-d). */
export type ConsentRecord = {
  value: boolean;
  /** consentTextVersions id shown when granted; null when adopted from the server. */
  textVersion: string | null;
  /** ISO timestamp of the choice. */
  at: string;
  /** The latest choice is applied on the server. */
  synced: boolean;
};
export type ConsentRecords = Partial<Record<ConsentType, ConsentRecord>>;

/** A referral letter made for a screening (referral_created; one per screening). */
export type ReferralRecord = {
  id: string;
  childId: string;
  screeningId: string | null;
  level: AppLevel;
  /** Triage reason ids of the screening (sent lower-cased). */
  reasonCodes: string[];
  facilityCode: string | null;
  referredAt: string;
  synced: boolean;
};

export type NewBrushingInput = {
  /** Seconds (rounded). */
  durationS: number;
  /** ISO start time; default now - durationS. */
  startedAt?: string;
  spiritScore?: number | null;
  /** Default from the start time (slotForTime). */
  slot?: BrushingSlot;
  cameraMode?: boolean;
  /** Proof video id when one was recorded for this session. */
  proofId?: string | null;
};

export type NewReferralInput = {
  screeningId: string;
  facilityCode?: string | null;
  /** Default newUuid(). */
  referralId?: string;
  /** Default now. */
  referredAt?: string;
};

/** Persisted part of the state. */
export type LocalData = {
  kids: ChildProfile[];
  activeChildId: string | null;
  /** Newest first. */
  brushing: BrushingRecord[];
  /** Newest first. Real results only (results are never faked). */
  screenings: ScreeningRecord[];
  /** Newest first. */
  referrals: ReferralRecord[];
  consentRecords: Record<string, ConsentRecords>;
  /** Children whose birth year/month or allergies have not reached the server yet. */
  unsyncedChildren: string[];
  /** Children the server takes no more data for (e.g. deletion pending) -> code. */
  syncBlocked: Record<string, string>;
};

export type LocalDataState = LocalData & {
  /** Signed-in user id, GUEST_SCOPE, or null (signed out: memory only). */
  scope: string | null;
  /** The scope's stored data is loaded. */
  ready: boolean;
  /** Consent values per child (derived from consentRecords; all false for a new child). */
  consents: Record<string, ConsentState>;

  /** Switches scope (sync engine only). Resolves when the new scope is loaded. */
  setScope: (scope: string | null) => Promise<void>;
  /** Writes pending changes now (app going to the background). */
  flushWrites: () => Promise<void>;
  /**
   * Deletes a scope's stored data (account deletion). If it is the current scope, memory is
   * cleared and nothing is written for it any more until the scope changes (sign out next).
   */
  deleteScopeData: (scope: string) => Promise<void>;
  /**
   * Removes a child and every local record of it after its deletion was requested. A
   * 'deletion_pending' marker stays in syncBlocked so the child is never synced or merged back.
   */
  forgetChild: (childId: string) => void;

  setActiveChild: (id: string) => void;
  /** Adds or replaces a child. Birth/allergy changes are queued as child_upserted (needs consent b). */
  upsertChild: (child: ChildProfile) => void;
  /** LOCAL ONLY display name. */
  setNickname: (childId: string, nickname: string) => void;
  /** Teen self profile after ensure_self_profile (use the id the RPC returned). */
  ensureSelfProfile: (input: { childId: string; birthYear: number | null; birthMonth: number | null; nickname?: string }) => ChildProfile;
  /** Aligns children with my_account(): child account = its one child; teen = self profile. */
  applyAccount: (me: MyAccount | null) => void;
  /**
   * Adds list_children() rows unknown locally (empty nickname, server consents) unless their
   * deletion is pending. The only deletion: a child marked deletion_pending that the (complete)
   * list no longer contains was deleted by the server, so its local copy goes too.
   */
  mergeServerChildren: (rows: readonly ChildSummary[]) => void;
  /** Records a consent choice (value + text version + time) and queues consent_changed. */
  setConsent: (childId: string, type: ConsentType, value: boolean, options?: { textVersion?: string; at?: string }) => void;
  /** Records a finished session and queues brushing_recorded. Returns the new record. */
  addBrushing: (childId: string, input: NewBrushingInput) => BrushingRecord;
  /** Links a proof video id to a session (one proof per session). */
  attachProof: (brushingId: string, proofId: string) => void;
  /** Saves a screening result (needs consent a, checked by the caller) and queues screening_recorded. */
  addScreening: (record: ScreeningRecord) => void;
  /** Creates the referral of a screening (once) and queues referral_created after the screening. */
  addReferral: (input: NewReferralInput) => ReferralRecord | null;

  // Called by the sync bridge when events are applied (or found already on the server).
  markSynced: (kind: 'brushing' | 'screening' | 'referral', id: string) => void;
  markChildSynced: (childId: string) => void;
  markConsentSynced: (childId: string, type: ConsentType) => void;
  blockChildSync: (childId: string, code: string) => void;
};

/** What the store tells the sync layer after a change. Installed by the sync bridge. */
export type LocalSyncHooks = {
  consent: (childId: string, type: ConsentType, action: 'grant' | 'withdraw', textVersion: string | null, at: string) => void;
  child: (child: ChildProfile) => void;
  brushing: (record: BrushingRecord) => void;
  screening: (record: ScreeningRecord) => void;
  referral: (referral: ReferralRecord) => void;
};

let syncHooks: LocalSyncHooks | null = null;

/** Installs (or removes, with null) the sync hooks. Only the sync bridge calls this. */
export function setLocalSyncHooks(hooks: LocalSyncHooks | null): void {
  syncHooks = hooks;
}

/** Runs a sync hook; a sync problem must never break a store action. */
function notifySync(run: (hooks: LocalSyncHooks) => void) {
  if (!syncHooks) return;
  try {
    run(syncHooks);
  } catch {
    // The record stays unsynced; the bridge's reconcile queues it later.
  }
}

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

function emptyData(): LocalData {
  return {
    kids: [],
    activeChildId: null,
    brushing: [],
    screenings: [],
    referrals: [],
    consentRecords: {},
    unsyncedChildren: [],
    syncBlocked: {},
  };
}

/** Consent values per known child, all false unless granted. */
export function deriveConsents(kids: readonly ChildProfile[], records: Record<string, ConsentRecords>): Record<string, ConsentState> {
  const out: Record<string, ConsentState> = {};
  for (const kid of kids) {
    const r = records[kid.id] ?? {};
    out[kid.id] = { ...emptyConsentState };
    for (const t of consentTypes) out[kid.id][t] = r[t]?.value === true;
  }
  return out;
}

/** Keeps every unsynced record; drops synced brushing records older than the retention window. */
export function applyRetention(data: LocalData, now: number): LocalData {
  const cutoff = now - SYNCED_BRUSHING_RETENTION_DAYS * DAY_MS;
  const brushing = data.brushing.filter((r) => !r.synced || !(Date.parse(r.startedAt) < cutoff));
  return brushing.length === data.brushing.length ? data : { ...data, brushing };
}

function pickData(s: LocalData): LocalData {
  return {
    kids: s.kids,
    activeChildId: s.activeChildId,
    brushing: s.brushing,
    screenings: s.screenings,
    referrals: s.referrals,
    consentRecords: s.consentRecords,
    unsyncedChildren: s.unsyncedChildren,
    syncBlocked: s.syncBlocked,
  };
}

function serializeData(s: LocalData, now: number): string {
  return JSON.stringify({ v: 1, ...applyRetention(pickData(s), now) });
}

/** Display name of a child, or null when only the server knows it (UI shows a fallback). */
export function childDisplayName(child: Pick<ChildProfile, 'nickname'> | null | undefined): string | null {
  const name = child?.nickname?.trim();
  return name ? name : null;
}

const byNewest = <T>(time: (item: T) => string) => (a: T, b: T) => (time(a) < time(b) ? 1 : time(a) > time(b) ? -1 : 0);

function mergeById<T extends { id: string }>(stored: readonly T[], early: readonly T[]): T[] {
  if (!early.length) return [...stored];
  const ids = new Set(early.map((r) => r.id));
  return [...early, ...stored.filter((r) => !ids.has(r.id))];
}

/** Stored data + changes made while it was loading (the latter win). */
function mergeData(stored: LocalData, early: LocalData): LocalData {
  const consentRecords: Record<string, ConsentRecords> = { ...stored.consentRecords };
  for (const [childId, recs] of Object.entries(early.consentRecords)) {
    consentRecords[childId] = { ...(consentRecords[childId] ?? {}), ...recs };
  }
  return {
    kids: [...stored.kids.filter((k) => !early.kids.some((e) => e.id === k.id)), ...early.kids],
    activeChildId: early.activeChildId ?? stored.activeChildId,
    brushing: mergeById(stored.brushing, early.brushing).sort(byNewest((r) => r.startedAt)),
    screenings: mergeById(stored.screenings, early.screenings).sort(byNewest((r) => r.screenedAt)),
    referrals: mergeById(stored.referrals, early.referrals).sort(byNewest((r) => r.referredAt)),
    consentRecords,
    unsyncedChildren: [...new Set([...stored.unsyncedChildren, ...early.unsyncedChildren])],
    syncBlocked: { ...stored.syncBlocked, ...early.syncBlocked },
  };
}

function hasData(d: LocalData): boolean {
  return !!(
    d.kids.length ||
    d.activeChildId ||
    d.brushing.length ||
    d.screenings.length ||
    d.referrals.length ||
    Object.keys(d.consentRecords).length ||
    d.unsyncedChildren.length ||
    Object.keys(d.syncBlocked).length
  );
}

// ----- parsing of stored data (defensive: the data may come from an older app version) -------

const slots: readonly string[] = ['morning', 'evening', 'other'];
const appLevels: readonly string[] = ['emergency', 'urgent', 'scheduled', 'routine'];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const numOrNull = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v));
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

function parseChild(v: unknown): ChildProfile | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.nickname !== 'string') return null;
  if (!numOrNull(v.birthYear) || !numOrNull(v.birthMonth)) return null;
  const child: ChildProfile = {
    id: v.id,
    nickname: v.nickname,
    birthYear: v.birthYear,
    birthMonth: v.birthMonth,
    allergies: Array.isArray(v.allergies) ? v.allergies.filter((a): a is string => typeof a === 'string') : [],
  };
  if (v.isSelf === true) child.isSelf = true;
  return child;
}

function parseBrushing(v: unknown): BrushingRecord | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.childId !== 'string' || typeof v.startedAt !== 'string') return null;
  if (typeof v.durationS !== 'number' || !numOrNull(v.spiritScore) || typeof v.slot !== 'string' || !slots.includes(v.slot)) {
    return null;
  }
  return {
    id: v.id,
    childId: v.childId,
    startedAt: v.startedAt,
    durationS: v.durationS,
    spiritScore: v.spiritScore,
    slot: v.slot as BrushingSlot,
    cameraMode: v.cameraMode === true,
    synced: v.synced === true,
    proofId: typeof v.proofId === 'string' ? v.proofId : null,
  };
}

function parseScreening(v: unknown): ScreeningRecord | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.childId !== 'string' || typeof v.screenedAt !== 'string') return null;
  if (typeof v.level !== 'string' || !appLevels.includes(v.level) || typeof v.rulesVersion !== 'string') return null;
  if (!Array.isArray(v.reasons) || !Array.isArray(v.findings) || !isObj(v.answers)) return null;
  // Shape of the remaining fields is our own; keep them, with v2 fields defaulted.
  return {
    ...(v as unknown as ScreeningRecord),
    synced: v.synced === true,
    requestId: typeof v.requestId === 'string' ? v.requestId : null,
    referralId: typeof v.referralId === 'string' ? v.referralId : null,
    triageSource: v.triageSource === 'server' ? 'server' : 'device',
  };
}

function parseReferral(v: unknown): ReferralRecord | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.childId !== 'string' || typeof v.referredAt !== 'string') return null;
  if (!strOrNull(v.screeningId) || typeof v.level !== 'string' || !appLevels.includes(v.level)) return null;
  return {
    id: v.id,
    childId: v.childId,
    screeningId: v.screeningId,
    level: v.level as AppLevel,
    reasonCodes: Array.isArray(v.reasonCodes) ? v.reasonCodes.filter((c): c is string => typeof c === 'string') : [],
    facilityCode: typeof v.facilityCode === 'string' ? v.facilityCode : null,
    referredAt: v.referredAt,
    synced: v.synced === true,
  };
}

function parseConsentRecords(v: unknown): Record<string, ConsentRecords> {
  const out: Record<string, ConsentRecords> = {};
  if (!isObj(v)) return out;
  for (const [childId, recs] of Object.entries(v)) {
    if (!isObj(recs)) continue;
    const parsed: ConsentRecords = {};
    for (const t of consentTypes) {
      const r = recs[t];
      if (isObj(r) && typeof r.value === 'boolean' && strOrNull(r.textVersion) && typeof r.at === 'string') {
        parsed[t] = { value: r.value, textVersion: r.textVersion, at: r.at, synced: r.synced === true };
      }
    }
    out[childId] = parsed;
  }
  return out;
}

function list<T>(v: unknown, parse: (item: unknown) => T | null): T[] {
  return Array.isArray(v) ? v.map(parse).filter((x): x is T => x !== null) : [];
}

/** Stored JSON -> LocalData (malformed parts are dropped, never thrown). */
export function parseStoredData(raw: string): LocalData {
  try {
    const p: unknown = JSON.parse(raw);
    if (!isObj(p) || p.v !== 1) return emptyData();
    const blocked: Record<string, string> = {};
    if (isObj(p.syncBlocked)) {
      for (const [k, code] of Object.entries(p.syncBlocked)) if (typeof code === 'string') blocked[k] = code;
    }
    return {
      kids: list(p.kids, parseChild),
      activeChildId: typeof p.activeChildId === 'string' ? p.activeChildId : null,
      brushing: list(p.brushing, parseBrushing),
      screenings: list(p.screenings, parseScreening),
      referrals: list(p.referrals, parseReferral),
      consentRecords: parseConsentRecords(p.consentRecords),
      unsyncedChildren: Array.isArray(p.unsyncedChildren) ? p.unsyncedChildren.filter((c): c is string => typeof c === 'string') : [],
      syncBlocked: blocked,
    };
  } catch {
    return emptyData();
  }
}

/**
 * The data without one child: its profile, brushing, screenings, referrals, consents and
 * unsynced flag. The active child moves to the first remaining one. syncBlocked is kept.
 */
export function withoutChild(data: LocalData, childId: string): LocalData {
  const kids = data.kids.filter((k) => k.id !== childId);
  const consentRecords = { ...data.consentRecords };
  delete consentRecords[childId];
  return {
    kids,
    activeChildId: data.activeChildId === childId ? (kids[0]?.id ?? null) : data.activeChildId,
    brushing: data.brushing.filter((r) => r.childId !== childId),
    screenings: data.screenings.filter((r) => r.childId !== childId),
    referrals: data.referrals.filter((r) => r.childId !== childId),
    consentRecords,
    unsyncedChildren: data.unsyncedChildren.filter((c) => c !== childId),
    syncBlocked: data.syncBlocked,
  };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// ---------------------------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------------------------

type ScopeHandle = {
  scope: string;
  slot: Slot;
  writer: Writer;
  /** Final snapshot taken when the scope is left; the writer then only writes this. */
  frozen: string | null;
};

let handle: ScopeHandle | null = null;
let generation = 0;
let loading: Promise<void> | null = null;

export const useLocalData = create<LocalDataState>((set, get) => {
  /** Applies a change to the persisted data, refreshes derived consents, schedules a write. */
  function commit(partial: Partial<LocalData>) {
    const s = get();
    const next: Partial<LocalDataState> = { ...partial };
    if (partial.kids || partial.consentRecords) {
      next.consents = deriveConsents(partial.kids ?? s.kids, partial.consentRecords ?? s.consentRecords);
    }
    set(next);
    // Never write while the scope loads: that would overwrite the stored copy with the few
    // changes made meanwhile (they are merged and written once loading finishes).
    if (get().ready) handle?.writer.schedule();
  }

  function makeHandle(scope: string): ScopeHandle {
    const slot = abSlot(LOCAL_STORAGE_PREFIX + scope);
    const h: ScopeHandle = { scope, slot, frozen: null, writer: null as unknown as Writer };
    h.writer = createWriter(slot, () => h.frozen ?? serializeData(get(), Date.now()), WRITE_DEBOUNCE_MS);
    return h;
  }

  return {
    ...emptyData(),
    scope: null,
    ready: true,
    consents: {},

    setScope(scope) {
      if (scope === get().scope) return loading ?? Promise.resolve();
      generation += 1;
      const gen = generation;
      // Leave the old scope: freeze its data and write it out under its own key.
      const old = handle;
      let persistOld: Promise<void> = Promise.resolve();
      if (old) {
        old.frozen = serializeData(get(), Date.now());
        persistOld = old.writer.flush();
      }
      handle = scope ? makeHandle(scope) : null;
      set({ ...emptyData(), consents: {}, scope, ready: scope === null });
      if (!scope || !handle) {
        loading = null;
        return persistOld;
      }
      const h = handle;
      const run = (async () => {
        await persistOld;
        let stored = emptyData();
        try {
          const raw = await h.slot.read();
          if (raw) stored = parseStoredData(raw);
        } catch {
          // Unreadable storage: start empty rather than block the app.
        }
        if (gen !== generation) return;
        const early = pickData(get());
        const merged = applyRetention(hasData(early) ? mergeData(stored, early) : stored, Date.now());
        set({ ...merged, consents: deriveConsents(merged.kids, merged.consentRecords), ready: true });
        if (hasData(early)) h.writer.schedule();
      })();
      loading = run.finally(() => {
        if (gen === generation) loading = null;
      });
      return loading;
    },

    async flushWrites() {
      await handle?.writer.flush();
    },

    async deleteScopeData(scope) {
      if (get().scope === scope && handle) {
        const h = handle;
        h.writer.cancel();
        // Detach: later changes stay in memory and leaving the scope writes nothing back.
        handle = null;
        set({ ...emptyData(), consents: {} });
        // A write already running must finish before the copies are removed.
        await h.writer.flush();
      }
      try {
        await abSlot(LOCAL_STORAGE_PREFIX + scope).remove();
      } catch {
        // Nothing more to do; the next write replaces it.
      }
    },

    forgetChild(childId) {
      const s = get();
      commit({ ...withoutChild(pickData(s), childId), syncBlocked: { ...s.syncBlocked, [childId]: 'deletion_pending' } });
    },

    setActiveChild(id) {
      if (get().activeChildId !== id) commit({ activeChildId: id });
    },

    upsertChild(child) {
      const s = get();
      const prev = s.kids.find((k) => k.id === child.id);
      const next: ChildProfile = { ...child, allergies: [...child.allergies] };
      if (prev?.isSelf && child.isSelf === undefined) next.isSelf = true;
      const kids = prev ? s.kids.map((k) => (k.id === child.id ? next : k)) : [...s.kids, next];
      const serverChanged =
        !prev ||
        prev.birthYear !== next.birthYear ||
        prev.birthMonth !== next.birthMonth ||
        !sameList(prev.allergies, next.allergies);
      const nextActiveId =
        s.activeChildId && kids.some((k) => k.id === s.activeChildId)
          ? s.activeChildId
          : child.id;
      commit({
        kids,
        activeChildId: nextActiveId,
        unsyncedChildren:
          serverChanged && !s.unsyncedChildren.includes(child.id) ? [...s.unsyncedChildren, child.id] : s.unsyncedChildren,
      });
      if (serverChanged) notifySync((h) => h.child(next));
    },

    setNickname(childId, nickname) {
      const s = get();
      if (!s.kids.some((k) => k.id === childId)) return;
      commit({ kids: s.kids.map((k) => (k.id === childId ? { ...k, nickname } : k)) });
    },

    ensureSelfProfile({ childId, birthYear, birthMonth, nickname }) {
      const s = get();
      const prev = s.kids.find((k) => k.id === childId);
      const profile: ChildProfile = {
        id: childId,
        nickname: nickname ?? prev?.nickname ?? '',
        birthYear,
        birthMonth,
        allergies: prev?.allergies ?? [],
        isSelf: true,
      };
      // ensure_self_profile stored the birth year/month: only local allergies still need a sync.
      const unsynced = s.unsyncedChildren.filter((id) => id !== childId);
      if (profile.allergies.length) unsynced.push(childId);
      commit({
        kids: prev ? s.kids.map((k) => (k.id === childId ? profile : k)) : [...s.kids, profile],
        activeChildId: childId,
        unsyncedChildren: unsynced,
      });
      return profile;
    },

    applyAccount(me) {
      const s = get();
      if (!me || me.userId !== s.scope) return;
      // Never while the scope loads: rows built from the still-empty kids would replace the
      // stored profiles when the load merges (birth, allergies lost). The sync engine applies
      // the account again once the scope is ready.
      if (!s.ready) return;
      if (me.accountType === 'child' && me.childAccount) {
        const { childId, username } = me.childAccount;
        const prev = s.kids.find((k) => k.id === childId);
        if (s.kids.length === 1 && prev?.nickname === username && s.activeChildId === childId) return;
        // A child account sees exactly one child: itself, named by its username.
        const profile: ChildProfile = {
          id: childId,
          nickname: username,
          birthYear: prev?.birthYear ?? null,
          birthMonth: prev?.birthMonth ?? null,
          allergies: prev?.allergies ?? [],
        };
        commit({ kids: [profile], activeChildId: childId, unsyncedChildren: [] });
        return;
      }
      if (me.accountType === 'teen' && me.selfChildId) {
        const selfId = me.selfChildId;
        const prev = s.kids.find((k) => k.id === selfId);
        const kids = prev
          ? prev.isSelf
            ? s.kids
            : s.kids.map((k) => (k.id === selfId ? { ...k, isSelf: true } : k))
          : [...s.kids, { id: selfId, nickname: '', birthYear: null, birthMonth: null, allergies: [], isSelf: true }];
        const activeOk = !!s.activeChildId && kids.some((k) => k.id === s.activeChildId);
        if (kids === s.kids && activeOk) return;
        commit({ kids, activeChildId: activeOk ? s.activeChildId : selfId });
      }
    },

    mergeServerChildren(rows) {
      const s = get();
      // Never while the scope loads (see applyAccount): nickname-less server rows and adopted
      // consents would overwrite the stored nicknames, allergies and unsynced consent changes.
      // The pollers merge again on their next run.
      if (!s.ready) return;
      // Deletion finished on the server (requested here or on another phone): drop the local copy.
      const listed = new Set(rows.map((r) => r.childId));
      let data = pickData(s);
      for (const kid of s.kids) {
        if (s.syncBlocked[kid.id] === 'deletion_pending' && !listed.has(kid.id)) data = withoutChild(data, kid.id);
      }
      const removed = data.kids.length !== s.kids.length;
      const kids = [...data.kids];
      const consentRecords = { ...data.consentRecords };
      const syncBlocked = { ...s.syncBlocked };
      const now = new Date().toISOString();
      let changed = false;
      for (const row of rows) {
        if (!isUuid(row.childId)) continue;
        if (row.deletionPending && syncBlocked[row.childId] !== 'deletion_pending') {
          syncBlocked[row.childId] = 'deletion_pending';
          changed = true;
        }
        const index = kids.findIndex((k) => k.id === row.childId);
        // A child being deleted is not brought onto this phone (nor back after forgetChild).
        if (index < 0 && syncBlocked[row.childId] === 'deletion_pending') continue;
        if (index >= 0) {
          if (row.isSelf && !kids[index].isSelf) {
            kids[index] = { ...kids[index], isSelf: true };
            changed = true;
          }
          // A known child (e.g. the teen self profile applyAccount created on a new phone) adopts
          // the server's active consents for every type this phone has no record of. A local
          // record (even an unsynced withdrawal) always wins.
          const local = consentRecords[row.childId] ?? {};
          const adopted: ConsentRecords = {};
          for (const t of row.consents) {
            if (!local[t]) adopted[t] = { value: true, textVersion: null, at: now, synced: true };
          }
          if (Object.keys(adopted).length) {
            consentRecords[row.childId] = { ...local, ...adopted };
            changed = true;
          }
          continue;
        }
        const child: ChildProfile = {
          id: row.childId,
          nickname: '',
          birthYear: row.birthYear,
          birthMonth: row.birthMonth,
          allergies: [],
        };
        if (row.isSelf) child.isSelf = true;
        kids.push(child);
        // What the server holds is already applied: adopt it without queueing events.
        const recs: ConsentRecords = {};
        for (const t of row.consents) recs[t] = { value: true, textVersion: null, at: now, synced: true };
        consentRecords[row.childId] = recs;
        changed = true;
      }
      if (removed) {
        commit({ ...data, kids, consentRecords, syncBlocked, activeChildId: data.activeChildId ?? kids[0]?.id ?? null });
        return;
      }
      if (!changed) return;
      commit({ kids, consentRecords, syncBlocked, activeChildId: s.activeChildId ?? kids[0]?.id ?? null });
    },

    setConsent(childId, type, value, options) {
      const s = get();
      const records = s.consentRecords[childId] ?? {};
      const prev = records[type];
      if ((prev?.value ?? false) === value) return;
      const kid = s.kids.find((k) => k.id === childId);
      const giver: ConsentGiver = kid?.isSelf ? 'teen' : 'guardian';
      const at = options?.at ?? new Date().toISOString();
      const textVersion = value ? (options?.textVersion ?? consentTextVersions[giver][type]) : (prev?.textVersion ?? null);
      const record: ConsentRecord = { value, textVersion, at, synced: false };
      commit({ consentRecords: { ...s.consentRecords, [childId]: { ...records, [type]: record } } });
      notifySync((h) => h.consent(childId, type, value ? 'grant' : 'withdraw', textVersion, at));
    },

    addBrushing(childId, input) {
      const durationS = Math.max(0, Math.round(Number.isFinite(input.durationS) ? input.durationS : 0));
      const startedAt = input.startedAt ?? new Date(Date.now() - durationS * 1000).toISOString();
      const record: BrushingRecord = {
        id: newUuid(),
        childId,
        startedAt,
        durationS,
        spiritScore: input.spiritScore ?? null,
        slot: input.slot ?? slotForTime(new Date(startedAt)),
        cameraMode: input.cameraMode ?? false,
        synced: false,
        proofId: input.proofId ?? null,
      };
      commit({ brushing: [record, ...get().brushing] });
      notifySync((h) => h.brushing(record));
      return record;
    },

    attachProof(brushingId, proofId) {
      const s = get();
      const record = s.brushing.find((r) => r.id === brushingId);
      if (!record || record.proofId === proofId || record.proofId) return;
      commit({ brushing: s.brushing.map((r) => (r.id === brushingId ? { ...r, proofId } : r)) });
    },

    addScreening(record) {
      commit({ screenings: [record, ...get().screenings.filter((r) => r.id !== record.id)] });
      if (!record.synced) notifySync((h) => h.screening(record));
    },

    addReferral({ screeningId, facilityCode, referralId, referredAt }) {
      const s = get();
      const screening = s.screenings.find((r) => r.id === screeningId);
      if (!screening) return null;
      if (screening.referralId) return s.referrals.find((r) => r.id === screening.referralId) ?? null;
      const referral: ReferralRecord = {
        id: referralId ?? newUuid(),
        childId: screening.childId,
        screeningId,
        level: screening.level,
        reasonCodes: screening.reasons.map((r) => r.id),
        facilityCode: facilityCode ?? null,
        referredAt: referredAt ?? new Date().toISOString(),
        synced: false,
      };
      commit({
        referrals: [referral, ...s.referrals],
        screenings: s.screenings.map((r) => (r.id === screeningId ? { ...r, referralId: referral.id } : r)),
      });
      notifySync((h) => h.referral(referral));
      return referral;
    },

    markSynced(kind, id) {
      const s = get();
      if (kind === 'brushing') {
        if (s.brushing.some((r) => r.id === id && !r.synced)) {
          commit({ brushing: s.brushing.map((r) => (r.id === id ? { ...r, synced: true } : r)) });
        }
      } else if (kind === 'screening') {
        if (s.screenings.some((r) => r.id === id && !r.synced)) {
          commit({ screenings: s.screenings.map((r) => (r.id === id ? { ...r, synced: true } : r)) });
        }
      } else if (s.referrals.some((r) => r.id === id && !r.synced)) {
        commit({ referrals: s.referrals.map((r) => (r.id === id ? { ...r, synced: true } : r)) });
      }
    },

    markChildSynced(childId) {
      const s = get();
      if (s.unsyncedChildren.includes(childId)) commit({ unsyncedChildren: s.unsyncedChildren.filter((c) => c !== childId) });
    },

    markConsentSynced(childId, type) {
      const s = get();
      const rec = s.consentRecords[childId]?.[type];
      if (!rec || rec.synced) return;
      commit({ consentRecords: { ...s.consentRecords, [childId]: { ...s.consentRecords[childId], [type]: { ...rec, synced: true } } } });
    },

    blockChildSync(childId, code) {
      const s = get();
      if (s.syncBlocked[childId] !== code) commit({ syncBlocked: { ...s.syncBlocked, [childId]: code } });
    },
  };
});

/** True when the current scope's data is loaded (screens may show empty states). */
export function useLocalReady(): boolean {
  return useLocalData((s) => s.ready);
}

/** child_profile.id is a uuid created on the device. */
export function newChildId(): string {
  return newUuid();
}
