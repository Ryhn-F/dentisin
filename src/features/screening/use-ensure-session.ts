import { useEffect } from 'react';

import { useIsScreenFocused } from '@/core/theme';
import { useMockData } from '@/mock/store';

import { useScreeningSession } from './session-store';

/**
 * Starts a session for the active child when a flow screen is opened directly (deep link,
 * reload). Only while focused: these screens stay mounted under the result screen, whose
 * "Selesai" clears the session, and must not restart it from the background.
 */
export function useEnsureSession() {
  const focused = useIsScreenFocused();
  const startedAt = useScreeningSession((s) => s.startedAt);
  useEffect(() => {
    if (!focused || startedAt) return;
    const { kids, activeChildId } = useMockData.getState();
    useScreeningSession.getState().start(kids.find((k) => k.id === activeChildId) ?? null);
  }, [focused, startedAt]);
}
