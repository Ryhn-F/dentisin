// Server data of the homes (guardian, teen, child account). Every call goes through
// src/core/account/api.ts, which never throws or logs; failures fall back to local data.
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  brushingStreak,
  childHistory,
  deviceTimeZone,
  listChildren,
  listScreeningRequests,
  type ApiErrorCode,
} from '@/core/account/api';
import { useLimits } from '@/core/account/account-store';
import { useLocalData } from '@/data/local-store';
import type { BrushingRecord, BrushingStreak, ChildSummary, ScreeningRequest } from '@/domain/models';
import { computeStreak } from '@/domain/streak';
import { rememberItems } from '@/features/history/history-model';

import { mergeStreaks } from './streak';
import { serverBrushingRecords, startOfTodayIso, TODAY_BRUSHING_LIMIT } from './today-brushing';

/**
 * Codes after which a hook stops calling while its screen stays mounted: the backend has no
 * such RPC yet (v2 not deployed), the app has no backend configured, or the account may not
 * call it. Nothing will change by asking again every minute.
 */
const STOP_CODES: readonly ApiErrorCode[] = ['not_deployed', 'not_configured', 'forbidden'];

export function isStopCode(code: ApiErrorCode): boolean {
  return STOP_CODES.includes(code);
}

/**
 * Codes that say the whole backend cannot answer (v2 not deployed, no backend configured).
 * Per-child RPCs stop for every child only on these; 'forbidden' is per child: brushing_streak
 * answers it for a child that is not on the server yet (consent (b) still off), which says
 * nothing about the other children (ACCOUNTS_AND_FLOWS.md §2.7, can_access_child).
 */
const BACKEND_STOP_CODES: readonly ApiErrorCode[] = ['not_deployed', 'not_configured'];

export function isBackendStopCode(code: ApiErrorCode): boolean {
  return BACKEND_STOP_CODES.includes(code);
}

/**
 * A child the server refused is asked again after this long (its consent (b) may have been
 * granted meanwhile, which creates the server profile).
 */
export const REFUSED_CHILD_RETRY_MS = 10 * 60 * 1000;

/** Per-child 'forbidden' memory of one hook instance. */
function useRefusedChildren() {
  const ref = useRef(new Map<string, number>());
  return useMemo(
    () => ({
      has: (childId: string) => {
        const at = ref.current.get(childId);
        if (at === undefined) return false;
        if (Date.now() - at < REFUSED_CHILD_RETRY_MS) return true;
        ref.current.delete(childId);
        return false;
      },
      add: (childId: string) => void ref.current.set(childId, Date.now()),
    }),
    [],
  );
}

/** list_children() rows, merged into the local store on every successful poll. */
export function useServerChildren() {
  const merge = useLocalData((s) => s.mergeServerChildren);
  const [rows, setRows] = useState<ChildSummary[]>([]);
  const [stopped, setStopped] = useState(false);
  const stoppedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (stoppedRef.current) return;
    const result = await listChildren();
    if (result.ok) {
      merge(result.data);
      setRows(result.data);
    } else if (isStopCode(result.code)) {
      stoppedRef.current = true;
      setStopped(true);
    }
    // Other failures (network, timeout): keep the last rows; the next poll retries.
  }, [merge]);

  return { rows, stopped, refresh };
}

/**
 * Streak of one child: brushing_streak() when `remote`, corrected with today's local
 * sessions; the local server-rule streak otherwise (offline, guest, legacy backend).
 */
export function useBrushingStreak(childId: string | null, remote: boolean) {
  const allBrushing = useLocalData((s) => s.brushing);
  const { streakMinDurationS } = useLimits();
  const tz = useMemo(() => deviceTimeZone(), []);
  const [server, setServer] = useState<{ childId: string; streak: BrushingStreak } | null>(null);
  const [stopped, setStopped] = useState(false);
  const stoppedRef = useRef(false);
  // Children the server refused ('forbidden'): not asked again for a while; others still are.
  const refused = useRefusedChildren();

  const local = useMemo(
    () =>
      computeStreak(
        allBrushing.filter((r) => r.childId === childId),
        { minDurationS: streakMinDurationS, tz },
      ),
    [allBrushing, childId, streakMinDurationS, tz],
  );

  const refresh = useCallback(async () => {
    if (!remote || !childId || stoppedRef.current || refused.has(childId)) return;
    const result = await brushingStreak(childId, tz);
    if (result.ok) setServer({ childId, streak: result.data });
    else if (isBackendStopCode(result.code)) {
      stoppedRef.current = true;
      setStopped(true);
    } else if (result.code === 'forbidden') refused.add(childId);
  }, [remote, childId, tz, refused]);

  const fromServer = remote && server !== null && server.childId === childId ? server.streak : null;
  return {
    streak: mergeStreaks(fromServer, local),
    source: fromServer ? ('server' as const) : ('local' as const),
    stopped,
    refresh,
  };
}

/**
 * Today's brushing sessions of one child from child_history() (sessions brushed on another
 * phone, e.g. the child's own). Empty when not `remote`, before the first answer, or when the
 * server cannot answer; the caller merges it with the local records (mergeBrushing).
 */
export function useTodayBrushing(childId: string | null, remote: boolean) {
  const [server, setServer] = useState<{ childId: string; records: BrushingRecord[] } | null>(null);
  const stoppedRef = useRef(false);
  const refused = useRefusedChildren();

  const refresh = useCallback(async () => {
    if (!remote || !childId || stoppedRef.current || refused.has(childId)) return;
    const result = await childHistory({
      childId,
      kinds: ['brushing'],
      from: startOfTodayIso(),
      limit: TODAY_BRUSHING_LIMIT,
    });
    if (result.ok) {
      // The history detail screen shows these without another request.
      rememberItems(childId, result.data.items);
      setServer({ childId, records: serverBrushingRecords(childId, result.data.items) });
    } else if (isBackendStopCode(result.code)) stoppedRef.current = true;
    else if (result.code === 'forbidden') refused.add(childId);
    // Other failures (network, timeout): keep the last answer; the next poll retries.
  }, [remote, childId, refused]);

  const records = useMemo(
    () => (remote && server !== null && server.childId === childId ? server.records : []),
    [remote, server, childId],
  );
  return { records, refresh };
}

export type KidRequestsState =
  | { status: 'loading' }
  | { status: 'ready'; items: ScreeningRequest[] }
  | { status: 'unavailable' }
  | { status: 'error' };

/** Number of the child's own requests shown on the kid home. */
export const KID_REQUESTS_LIMIT = 5;

/** The child account's own screening requests (status only), newest first. */
export function useKidRequests(childId: string | null, remote: boolean) {
  const [state, setState] = useState<KidRequestsState>(remote ? { status: 'loading' } : { status: 'unavailable' });

  const stoppedRef = useRef(false);
  const refused = useRefusedChildren();

  const refresh = useCallback(async () => {
    if (!remote || !childId || stoppedRef.current) return;
    if (refused.has(childId)) {
      setState({ status: 'unavailable' });
      return;
    }
    const result = await listScreeningRequests({ childId, limit: KID_REQUESTS_LIMIT });
    if (result.ok) setState({ status: 'ready', items: result.data.slice(0, KID_REQUESTS_LIMIT) });
    else if (isStopCode(result.code)) {
      // Per child for 'forbidden' (see isBackendStopCode); the whole hook otherwise.
      if (isBackendStopCode(result.code)) stoppedRef.current = true;
      else refused.add(childId);
      setState({ status: 'unavailable' });
    }
    // A failed refresh keeps a list that was already shown.
    else setState((s) => (s.status === 'ready' ? s : { status: 'error' }));
  }, [remote, childId, refused]);

  return { state: remote ? state : ({ status: 'unavailable' } as const), refresh };
}
