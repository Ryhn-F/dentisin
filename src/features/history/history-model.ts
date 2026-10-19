// Pure model of the History timeline (ACCOUNTS_AND_FLOWS.md §2.7, §6): which segments and
// kinds each account type may see, merging server pages with this phone's unsynced records,
// de-duplication, keyset-pagination bookkeeping, month grouping and the in-memory caches.
// No React, no network: everything here is unit-tested.
import type {
  BrushingRecord,
  HistoryItem,
  HistoryKind,
  HistoryPage,
  ScreeningRecord,
} from '@/domain/models';

// ---------------------------------------------------------------------------------------------
// Audience, segments and kinds
// ---------------------------------------------------------------------------------------------

/** Who is looking: the three account types, or no account (local data only). */
export type HistoryAudience = 'guardian' | 'teen' | 'child' | 'guest';

export type HistorySegment = 'all' | 'brushing' | 'screening' | 'requests' | 'video';

/** Kinds an audience may ever see (the server enforces the same; this is defense in depth). */
const audienceKinds: Record<HistoryAudience, readonly HistoryKind[]> = {
  guardian: ['screening', 'brushing', 'referral', 'screening_request', 'brushing_proof'],
  // A teen cannot ask for a check: the teen screens their own teeth.
  teen: ['screening', 'brushing', 'referral', 'brushing_proof'],
  // A child account never sees screening results or referrals (RLS), only its own activity.
  child: ['brushing', 'screening_request', 'brushing_proof'],
  guest: ['screening', 'brushing'],
};

const segmentKinds: Record<HistorySegment, readonly HistoryKind[]> = {
  all: ['screening', 'brushing', 'referral', 'screening_request', 'brushing_proof'],
  brushing: ['brushing'],
  screening: ['screening', 'referral'],
  requests: ['screening_request'],
  video: ['brushing_proof'],
};

const audienceSegments: Record<HistoryAudience, readonly HistorySegment[]> = {
  guardian: ['all', 'brushing', 'screening', 'requests', 'video'],
  teen: ['all', 'brushing', 'screening', 'video'],
  child: ['all'],
  guest: ['all', 'brushing', 'screening'],
};

export function audienceFor(accountType: 'guardian' | 'teen' | 'child' | null | undefined): HistoryAudience {
  return accountType ?? 'guest';
}

/** Segments shown as tabs for this audience, in display order. */
export function segmentsFor(audience: HistoryAudience): readonly HistorySegment[] {
  return audienceSegments[audience];
}

/** Whether the audience may see items of this kind at all. */
export function isKindAllowed(audience: HistoryAudience, kind: HistoryKind): boolean {
  return audienceKinds[audience].includes(kind);
}

/** `p_kinds` of a segment for this audience; empty when the segment is not available to it. */
export function kindsFor(audience: HistoryAudience, segment: HistorySegment): HistoryKind[] {
  if (!audienceSegments[audience].includes(segment)) return [];
  return segmentKinds[segment].filter((k) => audienceKinds[audience].includes(k));
}

/** Drops items the audience must never see, even if a server page contained them. */
export function filterForAudience(items: readonly HistoryItem[], audience: HistoryAudience): HistoryItem[] {
  return items.filter((i) => isKindAllowed(audience, i.kind));
}

// ---------------------------------------------------------------------------------------------
// Timeline entries
// ---------------------------------------------------------------------------------------------

type EntryBase = {
  /** `${kind}:${id}`, unique within a list. */
  key: string;
  id: string;
  occurredAt: string;
  /** Recorded on this phone and not yet accepted by the server. */
  unsynced: boolean;
};

export type ServerEntry = EntryBase & { origin: 'server'; kind: HistoryKind; item: HistoryItem };
export type LocalBrushingEntry = EntryBase & { origin: 'local'; kind: 'brushing'; record: BrushingRecord };
export type LocalScreeningEntry = EntryBase & { origin: 'local'; kind: 'screening'; record: ScreeningRecord };
export type TimelineEntry = ServerEntry | LocalBrushingEntry | LocalScreeningEntry;

export function entryKey(kind: HistoryKind, id: string): string {
  return `${kind}:${id}`;
}

/** Splits "kind:id" (detail route param); null when it is not a server key. */
export function parseEntryKey(value: string): { kind: HistoryKind; id: string } | null {
  const at = value.indexOf(':');
  if (at <= 0) return null;
  const kind = value.slice(0, at);
  const id = value.slice(at + 1);
  const known: readonly string[] = segmentKinds.all;
  return known.includes(kind) && id ? { kind: kind as HistoryKind, id } : null;
}

export function toServerEntry(item: HistoryItem): ServerEntry {
  return {
    origin: 'server',
    kind: item.kind,
    key: entryKey(item.kind, item.id),
    id: item.id,
    occurredAt: item.occurredAt,
    unsynced: false,
    item,
  };
}

export type LocalSources = {
  childId: string | null;
  brushing: readonly BrushingRecord[];
  screenings: readonly ScreeningRecord[];
  /** Kinds of the current segment (a local record is listed only when its kind is requested). */
  kinds: readonly HistoryKind[];
  /** true: only records the server has not accepted yet (merged with server pages). */
  onlyUnsynced: boolean;
};

/** This phone's records of one child, as timeline entries. */
export function localEntries(src: LocalSources): TimelineEntry[] {
  if (!src.childId) return [];
  const out: TimelineEntry[] = [];
  if (src.kinds.includes('brushing')) {
    for (const record of src.brushing) {
      if (record.childId !== src.childId) continue;
      if (src.onlyUnsynced && record.synced) continue;
      out.push({
        origin: 'local',
        kind: 'brushing',
        key: entryKey('brushing', record.id),
        id: record.id,
        occurredAt: record.startedAt,
        unsynced: !record.synced,
        record,
      });
    }
  }
  if (src.kinds.includes('screening')) {
    for (const record of src.screenings) {
      if (record.childId !== src.childId) continue;
      if (src.onlyUnsynced && record.synced) continue;
      out.push({
        origin: 'local',
        kind: 'screening',
        key: entryKey('screening', record.id),
        id: record.id,
        occurredAt: record.screenedAt,
        unsynced: !record.synced,
        record,
      });
    }
  }
  return out;
}

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Newest first; equal times fall back to the key so the order is stable between renders. */
export function byNewest(a: Pick<TimelineEntry, 'occurredAt' | 'key'>, b: Pick<TimelineEntry, 'occurredAt' | 'key'>): number {
  const d = time(b.occurredAt) - time(a.occurredAt);
  if (d !== 0) return d;
  return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
}

/**
 * Server items + local entries, de-duplicated by kind+id (the server copy wins: it is the
 * accepted one, and a local record that just synced must not show twice), newest first.
 */
export function mergeTimeline(server: readonly HistoryItem[], local: readonly TimelineEntry[]): TimelineEntry[] {
  const byKey = new Map<string, TimelineEntry>();
  for (const entry of local) byKey.set(entry.key, entry);
  for (const item of server) {
    const entry = toServerEntry(item);
    byKey.set(entry.key, entry);
  }
  return [...byKey.values()].sort(byNewest);
}

// ---------------------------------------------------------------------------------------------
// Keyset pagination
// ---------------------------------------------------------------------------------------------

/** Appends a page to already loaded items, skipping ids that are already there. */
export function appendPage(existing: readonly HistoryItem[], page: readonly HistoryItem[]): HistoryItem[] {
  const seen = new Set(existing.map((i) => entryKey(i.kind, i.id)));
  const out = [...existing];
  for (const item of page) {
    const key = entryKey(item.kind, item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * The cursor for the next page, or null when the list ends. A cursor that did not move (a
 * misbehaving server) also ends the list, so "Muat lagi" can never loop on the same page.
 */
export function nextCursor(previous: string | null, page: Pick<HistoryPage, 'nextBefore'>): string | null {
  if (!page.nextBefore) return null;
  if (previous !== null && time(page.nextBefore) >= time(previous)) return null;
  return page.nextBefore;
}

// ---------------------------------------------------------------------------------------------
// Month groups
// ---------------------------------------------------------------------------------------------

export type MonthGroup = { key: string; /** ISO of its newest entry (for the title). */ firstAt: string; entries: TimelineEntry[] };

/** `YYYY-MM` of the device's local calendar month. */
export function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Groups a newest-first list by local calendar month (order kept). */
export function groupByMonth(entries: readonly TimelineEntry[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const entry of entries) {
    const key = monthKey(entry.occurredAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else groups.push({ key, firstAt: entry.occurredAt, entries: [entry] });
  }
  return groups;
}

// ---------------------------------------------------------------------------------------------
// In-memory caches (never persisted: they hold health history of children)
// ---------------------------------------------------------------------------------------------

export type CachedPage = { items: HistoryItem[]; nextBefore: string | null };

/** A server item plus the child it was listed for (the proof player needs the child). */
export type RememberedItem = { childId: string; item: HistoryItem };

const MAX_REMEMBERED_ITEMS = 600;
const MAX_CACHED_PAGES = 40;

let scopeUserId: string | null = null;
const firstPages = new Map<string, CachedPage>();
const remembered = new Map<string, RememberedItem>();

/** Drops every cached page and item when another user signs in (or the user signs out). */
export function setHistoryScope(userId: string | null): void {
  if (scopeUserId === userId) return;
  scopeUserId = userId;
  clearHistoryCache();
}

export function clearHistoryCache(): void {
  firstPages.clear();
  remembered.clear();
}

export function pageCacheKey(childId: string, segment: HistorySegment): string {
  return `${childId}|${segment}`;
}

export function getFirstPage(childId: string, segment: HistorySegment): CachedPage | null {
  return firstPages.get(pageCacheKey(childId, segment)) ?? null;
}

export function setFirstPage(childId: string, segment: HistorySegment, page: CachedPage): void {
  const key = pageCacheKey(childId, segment);
  firstPages.delete(key);
  firstPages.set(key, page);
  while (firstPages.size > MAX_CACHED_PAGES) {
    const oldest = firstPages.keys().next().value;
    if (oldest === undefined) break;
    firstPages.delete(oldest);
  }
}

/** Remembers server items so the detail screen can show them without another request. */
export function rememberItems(childId: string, items: readonly HistoryItem[]): void {
  for (const item of items) {
    const key = entryKey(item.kind, item.id);
    remembered.delete(key);
    remembered.set(key, { childId, item });
  }
  while (remembered.size > MAX_REMEMBERED_ITEMS) {
    const oldest = remembered.keys().next().value;
    if (oldest === undefined) break;
    remembered.delete(oldest);
  }
}

export function recallItem(kind: HistoryKind, id: string): RememberedItem | null {
  return remembered.get(entryKey(kind, id)) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Refresh without losing deeper pages
// ---------------------------------------------------------------------------------------------

export type LoadedPages = { items: HistoryItem[]; nextBefore: string | null };

/**
 * Result of re-fetching the first page while older pages are already loaded: the fresh page
 * replaces everything it covers (so deleted or changed items update), and the older pages the
 * user already scrolled to are kept below it. The cursor stays where the user was.
 */
export function mergeRefresh(existing: LoadedPages | null, fresh: LoadedPages): LoadedPages {
  if (!existing || fresh.nextBefore === null || fresh.items.length === 0) return fresh;
  const oldest = time(fresh.items[fresh.items.length - 1].occurredAt);
  const tail = existing.items.filter((i) => time(i.occurredAt) < oldest);
  if (tail.length === 0) return fresh;
  return { items: appendPage(fresh.items, tail), nextBefore: existing.nextBefore };
}

/** Timeline entries the audience may see (a child account never gets screening or referral rows). */
export function visibleEntries(entries: readonly TimelineEntry[], audience: HistoryAudience): TimelineEntry[] {
  return entries.filter((e) => isKindAllowed(audience, e.kind));
}

/** A swelling request that is still open: the red-flag advice stays on top of the child's list. */
export function hasOpenSwelling(entries: readonly TimelineEntry[]): boolean {
  return entries.some(
    (e) =>
      e.origin === 'server' &&
      e.item.kind === 'screening_request' &&
      e.item.data.reasonCode === 'swelling' &&
      (e.item.data.status === 'pending' || e.item.data.status === 'seen'),
  );
}
