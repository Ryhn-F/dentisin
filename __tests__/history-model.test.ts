// History timeline model: segments and kinds per account type, merge / dedupe, keyset
// pagination bookkeeping, month groups, caches, and the row descriptions.
import { id } from '@/core/i18n/id';
import type { BrushingRecord, HistoryItem, ScreeningRecord } from '@/domain/models';
import {
  appendPage,
  audienceFor,
  clearHistoryCache,
  filterForAudience,
  getFirstPage,
  groupByMonth,
  hasOpenSwelling,
  isKindAllowed,
  kindsFor,
  localEntries,
  mergeRefresh,
  mergeTimeline,
  monthKey,
  nextCursor,
  parseEntryKey,
  recallItem,
  rememberItems,
  segmentsFor,
  setFirstPage,
  setHistoryScope,
  toServerEntry,
  visibleEntries,
} from '@/features/history/history-model';
import { daysUntil, describeEntry } from '@/features/history/history-rows';

const CHILD = 'c0c0c0c0-0000-4000-8000-000000000001';
const OTHER = 'c0c0c0c0-0000-4000-8000-000000000002';

const brushingItem = (n: number, at: string, over: Partial<Extract<HistoryItem, { kind: 'brushing' }>['data']> = {}): HistoryItem => ({
  kind: 'brushing',
  id: `b${n}`,
  occurredAt: at,
  data: { durationS: 120, spiritScore: null, slot: 'morning', cameraMode: false, countsForStreak: true, hasProof: false, ...over },
});
const screeningItem = (n: number, at: string): HistoryItem => ({
  kind: 'screening',
  id: `s${n}`,
  occurredAt: at,
  data: { level: 'orange', redFlag: false, modelVersion: null, rulesVersion: 'v1', findingsCount: 0, requestId: null },
});
const requestItem = (n: number, at: string, reasonCode: 'toothache' | 'swelling' = 'toothache', status: 'pending' | 'done' = 'pending'): HistoryItem => ({
  kind: 'screening_request',
  id: `q${n}`,
  occurredAt: at,
  data: { reasonCode, painLevel: 4, status, seenAt: null, respondedAt: null, screeningId: null, expiresAt: '2030-01-01T00:00:00.000Z' },
});
const proofItem = (n: number, at: string): HistoryItem => ({
  kind: 'brushing_proof',
  id: `p${n}`,
  occurredAt: at,
  data: {
    brushingEventId: 'b1',
    status: 'uploaded',
    mime: 'video/mp4',
    sizeBytes: 1000,
    durationS: 61,
    viewedAt: null,
    expiresAt: '2026-10-25T00:00:00.000Z',
  },
});
const referralItem = (n: number, at: string): HistoryItem => ({
  kind: 'referral',
  id: `r${n}`,
  occurredAt: at,
  data: { level: 'red', reasonCodes: ['a', 'b'], facilityCode: null, screeningId: null },
});

const localBrushing = (n: number, at: string, synced: boolean, childId = CHILD): BrushingRecord => ({
  id: `b${n}`,
  childId,
  startedAt: at,
  durationS: 100,
  spiritScore: null,
  slot: 'evening',
  cameraMode: false,
  synced,
  proofId: null,
});
const localScreening = (n: number, at: string, synced: boolean): ScreeningRecord => ({
  id: `s${n}`,
  childId: CHILD,
  screenedAt: at,
  level: 'urgent',
  redFlag: false,
  reasons: [],
  adviceIds: [],
  referralTemplateId: 'x',
  rulesVersion: 'v1',
  modelVersion: null,
  photoTaken: false,
  photoStatus: 'not_taken',
  findings: [],
  answers: {},
  pain: null,
  ageMonths: null,
  synced,
  requestId: null,
  referralId: null,
});

describe('segments and kinds per account type', () => {
  it('maps account types to audiences', () => {
    expect(audienceFor('guardian')).toBe('guardian');
    expect(audienceFor('teen')).toBe('teen');
    expect(audienceFor('child')).toBe('child');
    expect(audienceFor(null)).toBe('guest');
  });

  it('guardian: all five segments; teen: no requests; guest: no requests or video; child: one list', () => {
    expect(segmentsFor('guardian')).toEqual(['all', 'brushing', 'screening', 'requests', 'video']);
    expect(segmentsFor('teen')).toEqual(['all', 'brushing', 'screening', 'video']);
    expect(segmentsFor('guest')).toEqual(['all', 'brushing', 'screening']);
    expect(segmentsFor('child')).toEqual(['all']);
  });

  it('segment -> p_kinds', () => {
    expect(kindsFor('guardian', 'all')).toEqual(['screening', 'brushing', 'referral', 'screening_request', 'brushing_proof']);
    expect(kindsFor('guardian', 'brushing')).toEqual(['brushing']);
    expect(kindsFor('guardian', 'screening')).toEqual(['screening', 'referral']);
    expect(kindsFor('guardian', 'requests')).toEqual(['screening_request']);
    expect(kindsFor('guardian', 'video')).toEqual(['brushing_proof']);
  });

  it('a teen cannot ask for a check: no screening_request in any teen segment', () => {
    expect(kindsFor('teen', 'all')).not.toContain('screening_request');
    expect(kindsFor('teen', 'requests')).toEqual([]);
    expect(kindsFor('teen', 'video')).toEqual(['brushing_proof']);
  });

  it('a child account is never asked for screening or referral', () => {
    expect(kindsFor('child', 'all')).toEqual(['brushing', 'screening_request', 'brushing_proof']);
    expect(kindsFor('child', 'screening')).toEqual([]);
    expect(isKindAllowed('child', 'screening')).toBe(false);
    expect(isKindAllowed('child', 'referral')).toBe(false);
    expect(isKindAllowed('child', 'brushing')).toBe(true);
  });

  it('guest only has local kinds', () => {
    expect(kindsFor('guest', 'all')).toEqual(['screening', 'brushing']);
    expect(kindsFor('guest', 'video')).toEqual([]);
  });

  it('filterForAudience and visibleEntries drop screening and referral for a child', () => {
    const items = [brushingItem(1, '2026-10-10T01:00:00.000Z'), screeningItem(1, '2026-10-10T02:00:00.000Z'), referralItem(1, '2026-10-10T03:00:00.000Z')];
    expect(filterForAudience(items, 'child').map((i) => i.kind)).toEqual(['brushing']);
    const entries = items.map(toServerEntry);
    expect(visibleEntries(entries, 'child').map((e) => e.kind)).toEqual(['brushing']);
    expect(visibleEntries(entries, 'guardian')).toHaveLength(3);
  });
});

describe('entry keys', () => {
  it('parses kind:id and rejects plain ids and unknown kinds', () => {
    expect(parseEntryKey('brushing:abc')).toEqual({ kind: 'brushing', id: 'abc' });
    expect(parseEntryKey('screening_request:q1')).toEqual({ kind: 'screening_request', id: 'q1' });
    expect(parseEntryKey('c0c0c0c0-0000-4000-8000-000000000001')).toBeNull();
    expect(parseEntryKey('nonsense:abc')).toBeNull();
    expect(parseEntryKey('brushing:')).toBeNull();
  });
});

describe('local entries', () => {
  const brushing = [
    localBrushing(1, '2026-10-10T01:00:00.000Z', false),
    localBrushing(2, '2026-10-09T01:00:00.000Z', true),
    localBrushing(3, '2026-10-08T01:00:00.000Z', false, OTHER),
  ];
  const screenings = [localScreening(1, '2026-10-10T02:00:00.000Z', false), localScreening(2, '2026-10-07T02:00:00.000Z', true)];

  it('only unsynced records of the child when merged with server pages', () => {
    const out = localEntries({ childId: CHILD, brushing, screenings, kinds: ['brushing', 'screening'], onlyUnsynced: true });
    expect(out.map((e) => e.key).sort()).toEqual(['brushing:b1', 'screening:s1']);
    expect(out.every((e) => e.unsynced)).toBe(true);
  });

  it('all records of the child when local only', () => {
    const out = localEntries({ childId: CHILD, brushing, screenings, kinds: ['brushing', 'screening'], onlyUnsynced: false });
    expect(out.map((e) => e.key).sort()).toEqual(['brushing:b1', 'brushing:b2', 'screening:s1', 'screening:s2']);
  });

  it('respects the requested kinds and the child', () => {
    expect(localEntries({ childId: CHILD, brushing, screenings, kinds: ['brushing'], onlyUnsynced: false })).toHaveLength(2);
    expect(localEntries({ childId: CHILD, brushing, screenings, kinds: ['screening_request'], onlyUnsynced: false })).toHaveLength(0);
    expect(localEntries({ childId: null, brushing, screenings, kinds: ['brushing'], onlyUnsynced: false })).toHaveLength(0);
  });
});

describe('mergeTimeline', () => {
  it('sorts newest first across server and local entries', () => {
    const server = [brushingItem(1, '2026-10-10T01:00:00.000Z'), screeningItem(1, '2026-10-08T01:00:00.000Z')];
    const local = localEntries({
      childId: CHILD,
      brushing: [localBrushing(9, '2026-10-09T05:00:00.000Z', false)],
      screenings: [localScreening(9, '2026-10-11T05:00:00.000Z', false)],
      kinds: ['brushing', 'screening'],
      onlyUnsynced: true,
    });
    expect(mergeTimeline(server, local).map((e) => e.key)).toEqual(['screening:s9', 'brushing:b1', 'brushing:b9', 'screening:s1']);
  });

  it('de-duplicates by kind+id and the server copy wins', () => {
    const server = [brushingItem(1, '2026-10-10T01:00:00.000Z')];
    const local = localEntries({
      childId: CHILD,
      brushing: [localBrushing(1, '2026-10-10T01:00:00.000Z', false)],
      screenings: [],
      kinds: ['brushing'],
      onlyUnsynced: true,
    });
    const merged = mergeTimeline(server, local);
    expect(merged).toHaveLength(1);
    expect(merged[0].origin).toBe('server');
    expect(merged[0].unsynced).toBe(false);
  });

  it('same id but different kind are different entries', () => {
    const merged = mergeTimeline([brushingItem(1, '2026-10-10T01:00:00.000Z'), { ...screeningItem(1, '2026-10-10T01:00:00.000Z'), id: 'b1' }], []);
    expect(merged).toHaveLength(2);
  });

  it('keeps a stable order for equal timestamps', () => {
    const at = '2026-10-10T01:00:00.000Z';
    const a = mergeTimeline([brushingItem(1, at), brushingItem(2, at), brushingItem(3, at)], []);
    const b = mergeTimeline([brushingItem(3, at), brushingItem(1, at), brushingItem(2, at)], []);
    expect(a.map((e) => e.key)).toEqual(b.map((e) => e.key));
  });
});

describe('keyset pagination', () => {
  it('appendPage skips items that are already loaded', () => {
    const first = [brushingItem(1, '2026-10-10T03:00:00.000Z'), brushingItem(2, '2026-10-10T02:00:00.000Z')];
    const second = [brushingItem(2, '2026-10-10T02:00:00.000Z'), brushingItem(3, '2026-10-10T01:00:00.000Z')];
    expect(appendPage(first, second).map((i) => i.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('follows next_before until null', () => {
    expect(nextCursor(null, { nextBefore: '2026-10-10T02:00:00.000Z' })).toBe('2026-10-10T02:00:00.000Z');
    expect(nextCursor('2026-10-10T02:00:00.000Z', { nextBefore: '2026-10-09T00:00:00.000Z' })).toBe('2026-10-09T00:00:00.000Z');
    expect(nextCursor('2026-10-09T00:00:00.000Z', { nextBefore: null })).toBeNull();
  });

  it('a cursor that did not move ends the list (no endless loop)', () => {
    expect(nextCursor('2026-10-10T02:00:00.000Z', { nextBefore: '2026-10-10T02:00:00.000Z' })).toBeNull();
    expect(nextCursor('2026-10-10T02:00:00.000Z', { nextBefore: '2026-10-11T00:00:00.000Z' })).toBeNull();
  });

  it('mergeRefresh keeps pages the user already scrolled to', () => {
    const existing = {
      items: [brushingItem(1, '2026-10-10T03:00:00.000Z'), brushingItem(2, '2026-10-10T02:00:00.000Z'), brushingItem(3, '2026-10-09T01:00:00.000Z'), brushingItem(4, '2026-10-08T01:00:00.000Z')],
      nextBefore: '2026-10-08T01:00:00.000Z',
    };
    const fresh = {
      items: [brushingItem(9, '2026-10-10T05:00:00.000Z'), brushingItem(1, '2026-10-10T03:00:00.000Z'), brushingItem(2, '2026-10-10T02:00:00.000Z')],
      nextBefore: '2026-10-10T02:00:00.000Z',
    };
    const merged = mergeRefresh(existing, fresh);
    expect(merged.items.map((i) => i.id)).toEqual(['b9', 'b1', 'b2', 'b3', 'b4']);
    expect(merged.nextBefore).toBe('2026-10-08T01:00:00.000Z');
  });

  it('mergeRefresh replaces everything when the fresh page covers the whole list or nothing is loaded', () => {
    const fresh = { items: [brushingItem(1, '2026-10-10T03:00:00.000Z')], nextBefore: null };
    expect(mergeRefresh({ items: [brushingItem(7, '2026-10-01T03:00:00.000Z')], nextBefore: null }, fresh)).toEqual(fresh);
    expect(mergeRefresh(null, fresh)).toEqual(fresh);
  });
});

describe('month groups', () => {
  it('groups a newest-first list by local calendar month', () => {
    const entries = mergeTimeline(
      [brushingItem(1, '2026-10-20T05:00:00'), brushingItem(2, '2026-10-02T05:00:00'), brushingItem(3, '2026-09-28T05:00:00'), brushingItem(4, '2026-08-01T12:00:00')],
      [],
    );
    const groups = groupByMonth(entries);
    expect(groups.map((g) => g.key)).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(groups[0].entries.map((e) => e.id)).toEqual(['b1', 'b2']);
    expect(monthKey('2026-10-20T05:00:00')).toBe('2026-10');
  });
});

describe('in-memory caches', () => {
  beforeEach(() => {
    setHistoryScope(null);
    clearHistoryCache();
  });

  it('keeps the first page per child + segment and the items for the detail screen', () => {
    setHistoryScope('user-1');
    const items = [proofItem(1, '2026-10-10T01:00:00.000Z')];
    setFirstPage(CHILD, 'video', { items, nextBefore: null });
    rememberItems(CHILD, items);
    expect(getFirstPage(CHILD, 'video')?.items).toHaveLength(1);
    expect(getFirstPage(CHILD, 'all')).toBeNull();
    expect(getFirstPage(OTHER, 'video')).toBeNull();
    expect(recallItem('brushing_proof', 'p1')).toEqual({ childId: CHILD, item: items[0] });
    expect(recallItem('brushing', 'p1')).toBeNull();
  });

  it('another user never sees the previous user cache', () => {
    setHistoryScope('user-1');
    setFirstPage(CHILD, 'all', { items: [], nextBefore: null });
    rememberItems(CHILD, [brushingItem(1, '2026-10-10T01:00:00.000Z')]);
    setHistoryScope('user-1');
    expect(getFirstPage(CHILD, 'all')).not.toBeNull();
    setHistoryScope('user-2');
    expect(getFirstPage(CHILD, 'all')).toBeNull();
    expect(recallItem('brushing', 'b1')).toBeNull();
  });

  it('signing out clears it', () => {
    setHistoryScope('user-1');
    rememberItems(CHILD, [brushingItem(1, '2026-10-10T01:00:00.000Z')]);
    setHistoryScope(null);
    expect(recallItem('brushing', 'b1')).toBeNull();
  });
});

describe('hasOpenSwelling', () => {
  it('is true only for an open swelling request', () => {
    expect(hasOpenSwelling([toServerEntry(requestItem(1, '2026-10-10T01:00:00.000Z', 'swelling', 'pending'))])).toBe(true);
    expect(hasOpenSwelling([toServerEntry(requestItem(1, '2026-10-10T01:00:00.000Z', 'swelling', 'done'))])).toBe(false);
    expect(hasOpenSwelling([toServerEntry(requestItem(1, '2026-10-10T01:00:00.000Z', 'toothache', 'pending'))])).toBe(false);
  });
});

describe('row descriptions', () => {
  const now = new Date('2026-10-20T00:00:00.000Z');

  it('daysUntil rounds up and never goes below zero', () => {
    expect(daysUntil('2026-10-25T00:00:00.000Z', now)).toBe(5);
    expect(daysUntil('2026-10-20T12:00:00.000Z', now)).toBe(1);
    expect(daysUntil('2026-10-01T00:00:00.000Z', now)).toBe(0);
  });

  it('server brushing: slot, duration, proof and streak tags (adult)', () => {
    const row = describeEntry(toServerEntry(brushingItem(1, '2026-10-10T01:00:00.000Z', { hasProof: true, countsForStreak: false })), 'guardian', now);
    expect(row.title).toBe(id.timeline.row.brushing.title.morning);
    expect(row.value).toBe('2:00');
    expect(row.subtitle).toContain(id.timeline.row.brushing.hasProof);
    expect(row.subtitle).toContain(id.timeline.row.brushing.notCounted);
  });

  it('server screening: level label, indication wording, red flag', () => {
    const item: HistoryItem = {
      kind: 'screening',
      id: 's1',
      occurredAt: '2026-10-10T01:00:00.000Z',
      data: { level: 'red', redFlag: true, modelVersion: null, rulesVersion: 'v1', findingsCount: 2, requestId: null },
    };
    const row = describeEntry(toServerEntry(item), 'guardian', now);
    expect(row.title).toContain(id.levels.emergency.label);
    expect(row.subtitle).toContain(id.timeline.row.screening.redFlag);
    expect(row.subtitle).toContain(id.timeline.row.screening.findings(2));
    expect(row.subtitle).not.toMatch(/diagnos/i);
  });

  it('local unsynced records carry the unsynced tag; child wording differs', () => {
    const [entry] = localEntries({ childId: CHILD, brushing: [localBrushing(1, '2026-10-10T01:00:00.000Z', false)], screenings: [], kinds: ['brushing'], onlyUnsynced: false });
    expect(describeEntry(entry, 'guardian', now).subtitle).toContain(id.timeline.unsynced);
    expect(describeEntry(entry, 'child', now).subtitle).toContain(id.timeline.kid.unsynced);
  });

  it('child request and proof rows use the simple status texts', () => {
    const req = describeEntry(toServerEntry(requestItem(1, '2026-10-10T01:00:00.000Z')), 'child', now);
    expect(req.subtitle).toContain(id.timeline.kid.requestStatus.pending);
    const proof = describeEntry(toServerEntry(proofItem(1, '2026-10-10T01:00:00.000Z')), 'child', now);
    expect(proof.title).toBe(id.timeline.kid.proof.title);
    expect(proof.subtitle).toContain(id.timeline.kid.proof.sent);
  });

  it('adult proof row shows status and the retention countdown', () => {
    const proof = describeEntry(toServerEntry(proofItem(1, '2026-10-10T01:00:00.000Z')), 'guardian', now);
    expect(proof.subtitle).toContain(id.timeline.proofStatus.uploaded);
    expect(proof.subtitle).toContain(id.timeline.row.proof.expiresIn(5));
  });
});
