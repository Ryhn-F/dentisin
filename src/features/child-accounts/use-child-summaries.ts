import { useCallback, useEffect, useRef, useState } from 'react';

import { useMe } from '@/core/account/account-store';
import { listChildren, type ApiErrorCode } from '@/core/account/api';
import { useSession } from '@/core/auth/session-store';
import { useLocalData } from '@/data/local-store';
import type { ChildSummary } from '@/domain/models';

export type ChildSummariesState = {
  /** Rows by child id (empty until the first successful load). */
  rows: Record<string, ChildSummary>;
  loading: boolean;
  /** True once a load has succeeded in this mount. */
  loaded: boolean;
  /** Code of the last failed load (null after a success). */
  error: ApiErrorCode | null;
  /** True when list_children cannot run at all (guest, legacy backend, teen/child account). */
  unavailable: boolean;
  reload: () => Promise<void>;
};

// list_children() for the signed-in guardian: the source of "has a child account" and of children
// that exist only on the server (merged into the local store with an empty nickname).
// Skipped for guests and for a legacy backend (my_account not deployed); the screens degrade to
// the local data. Teen accounts get their one self row; child accounts are refused by the server.
export function useChildSummaries(options: { enabled?: boolean } = {}): ChildSummariesState {
  const enabled = options.enabled !== false;
  const status = useSession((s) => s.status);
  const me = useMe();
  const merge = useLocalData((s) => s.mergeServerChildren);
  const [rows, setRows] = useState<Record<string, ChildSummary>>({});
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const alive = useRef(true);
  const inFlight = useRef<Promise<void> | null>(null);

  const available = enabled && status === 'signedIn' && !!me && !me.legacy && me.accountType !== 'child';

  const reload = useCallback((): Promise<void> => {
    if (!available) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    setLoading(true);
    const run = (async () => {
      const res = await listChildren();
      if (!alive.current) return;
      if (res.ok) {
        setRows(Object.fromEntries(res.data.map((row) => [row.childId, row])));
        setError(null);
        setLoaded(true);
        merge(res.data);
      } else {
        setError(res.code);
      }
      setLoading(false);
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }, [available, merge]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rows, loading, loaded, error, unavailable: !available, reload };
}
