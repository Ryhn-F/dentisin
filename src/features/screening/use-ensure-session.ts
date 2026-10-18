import { useEffect } from 'react';

import { useAccount } from '@/core/account/account-store';
import { useIsScreenFocused } from '@/core/theme';
import { useLocalData } from '@/data/local-store';

import { useScreeningSession } from './session-store';
import { teenSelfProfile } from './subject';

/**
 * Starts a session for the active child (a teen: its self profile) when a flow screen is opened
 * directly (deep link, reload). Only while focused: these screens stay mounted under the result
 * screen, whose "Selesai" clears the session, and must not restart it from the background.
 */
export function useEnsureSession() {
  const focused = useIsScreenFocused();
  const startedAt = useScreeningSession((s) => s.startedAt);
  useEffect(() => {
    if (!focused || startedAt) return;
    const { kids, activeChildId } = useLocalData.getState();
    const me = useAccount.getState().me;
    const child = me?.accountType === 'teen' ? teenSelfProfile(kids, me) : (kids.find((k) => k.id === activeChildId) ?? null);
    useScreeningSession.getState().start(child);
  }, [focused, startedAt]);
}
