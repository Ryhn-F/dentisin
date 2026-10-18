// Loads child_history() pages for one child + segment (keyset pagination, in-memory cache of
// the first page, silent refresh) and falls back to "this phone only" when the server cannot
// answer. Never throws or logs; the API layer already maps every failure to a code.
import { useCallback, useEffect, useRef, useState } from 'react';

import { childHistory, type ApiErrorCode } from '@/core/account/api';
import type { HistoryItem } from '@/domain/models';

import {
  filterForAudience,
  getFirstPage,
  kindsFor,
  mergeRefresh,
  nextCursor,
  appendPage,
  rememberItems,
  setFirstPage,
  type HistoryAudience,
  type HistorySegment,
  type LoadedPages,
} from './history-model';

export const PAGE_SIZE = 30;

/** Why only this phone's records are listed. */
export type LocalOnlyReason = 'guest' | 'not_deployed' | 'offline' | 'not_allowed' | 'auth_required';

export type HistoryLoadState = {
  /** First page of this child + segment is on its way and nothing is cached. */
  loading: boolean;
  /** Server items loaded so far, newest first. */
  items: HistoryItem[];
  nextBefore: string | null;
  /** null = the server list is shown; otherwise the reason it is not. */
  localOnly: LocalOnlyReason | null;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  /** A refresh failed but older (cached) server items are still shown. */
  refreshFailed: boolean;
};

const EMPTY: HistoryLoadState = {
  loading: false,
  items: [],
  nextBefore: null,
  localOnly: null,
  loadingMore: false,
  loadMoreFailed: false,
  refreshFailed: false,
};

/** Map an API failure to the banner reason. Codes that never change by retrying stay put. */
export function localOnlyReason(code: ApiErrorCode): LocalOnlyReason {
  switch (code) {
    case 'not_deployed':
    case 'not_configured':
      return 'not_deployed';
    case 'forbidden':
      return 'not_allowed';
    case 'not_authenticated':
      return 'auth_required';
    default:
      return 'offline';
  }
}

/** State of a list that has not answered yet: cached first page, local-only, or loading. */
function initialState(
  childId: string | null,
  segment: HistorySegment,
  localReason: LocalOnlyReason | null,
  active: boolean,
): HistoryLoadState {
  if (localReason !== null) return { ...EMPTY, localOnly: localReason };
  if (!active || !childId) return EMPTY;
  const cached = getFirstPage(childId, segment);
  return cached ? { ...EMPTY, items: cached.items, nextBefore: cached.nextBefore } : { ...EMPTY, loading: true };
}

export function useChildHistory({
  childId,
  segment,
  audience,
  localReason,
}: {
  childId: string | null;
  segment: HistorySegment;
  audience: HistoryAudience;
  /** Non-null = do not ask the server (guest, backend without v2): local records only. */
  localReason: LocalOnlyReason | null;
}) {
  const kinds = kindsFor(audience, segment);
  const active = localReason === null && !!childId && kinds.length > 0;
  const key = [childId ?? '', segment, audience, localReason ?? ''].join('|');

  // State is tagged with the list it belongs to: another child / segment starts from its own
  // initial state, and a late answer for a previous list is dropped by the key check below.
  const [store, setStore] = useState(() => ({ key, state: initialState(childId, segment, localReason, active) }));
  let state = store.state;
  if (store.key !== key) {
    state = initialState(childId, segment, localReason, active);
    setStore({ key, state });
  }
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const lastFetchedAt = useRef(0);

  const update = useCallback(
    (forKey: string, change: (s: HistoryLoadState) => HistoryLoadState) =>
      setStore((cur) => (cur.key === forKey ? { key: forKey, state: change(cur.state) } : cur)),
    [],
  );

  const fetchFirst = useCallback(
    async (silent: boolean) => {
      if (!active || !childId) return;
      // Stamped at the start so a focus revalidation right after mount does not fetch twice.
      lastFetchedAt.current = Date.now();
      const result = await childHistory({ childId, kinds: kindsFor(audience, segment), limit: PAGE_SIZE });
      if (result.ok) {
        const items = filterForAudience(result.data.items, audience);
        const fresh: LoadedPages = { items, nextBefore: nextCursor(null, result.data) };
        rememberItems(childId, items);
        setFirstPage(childId, segment, fresh);
        update(key, (s) => {
          const merged = silent && !s.loading ? mergeRefresh({ items: s.items, nextBefore: s.nextBefore }, fresh) : fresh;
          return { ...EMPTY, items: merged.items, nextBefore: merged.nextBefore };
        });
        return;
      }
      update(key, (s) => {
        // Cached items stay on screen with a small notice; with nothing cached the list is local-only.
        if (s.items.length > 0 && !s.localOnly) return { ...s, loading: false, refreshFailed: true };
        return { ...EMPTY, localOnly: localOnlyReason(result.code) };
      });
    },
    [active, childId, segment, audience, key, update],
  );

  // New child / segment: the cached first page is already on screen; revalidate it.
  const fetchRef = useRef(fetchFirst);
  useEffect(() => {
    fetchRef.current = fetchFirst;
  });
  useEffect(() => {
    void fetchRef.current(false);
  }, [fetchFirst]);

  const refresh = useCallback(() => fetchFirst(true), [fetchFirst]);

  /** Silent refresh used on focus; skipped when the list was fetched very recently. */
  const revalidate = useCallback(
    (maxAgeMs: number) => {
      if (Date.now() - lastFetchedAt.current < maxAgeMs) return Promise.resolve();
      return fetchFirst(true);
    },
    [fetchFirst],
  );

  const loadMore = useCallback(async () => {
    const s = stateRef.current;
    if (!active || !childId || s.loading || s.loadingMore || s.nextBefore === null || s.localOnly) return;
    const cursor = s.nextBefore;
    update(key, (cur) => ({ ...cur, loadingMore: true, loadMoreFailed: false }));
    const result = await childHistory({
      childId,
      kinds: kindsFor(audience, segment),
      limit: PAGE_SIZE,
      before: cursor,
    });
    if (result.ok) {
      const items = filterForAudience(result.data.items, audience);
      rememberItems(childId, items);
      update(key, (cur) => ({
        ...cur,
        loadingMore: false,
        items: appendPage(cur.items, items),
        nextBefore: nextCursor(cursor, result.data),
      }));
    } else {
      update(key, (cur) => ({ ...cur, loadingMore: false, loadMoreFailed: true }));
    }
  }, [active, childId, segment, audience, key, update]);

  return { state, refresh, revalidate, loadMore };
}
