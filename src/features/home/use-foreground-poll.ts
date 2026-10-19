import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Home polling interval. There is no push/Realtime on the MVP backend: the guardian home polls
 * list_children() while it is shown (ACCOUNTS_AND_FLOWS.md §2.5: on open, then every 60 s).
 */
export const FOREGROUND_POLL_MS = 60_000;

/**
 * 'unknown' or no value at all (no native AppState yet, test environments) counts as
 * foreground; only 'background' and 'inactive' do not.
 */
export function isForegroundState(state: AppStateStatus | null | undefined): boolean {
  return state !== 'background' && state !== 'inactive';
}

export type ForegroundPollOptions = {
  /** Default FOREGROUND_POLL_MS. Measured from the end of one call to the start of the next. */
  intervalMs?: number;
  /** false: never runs (guest, signed out, legacy backend). */
  enabled?: boolean;
  /**
   * Changing it while focused restarts the schedule with an immediate call (e.g. the active
   * child changed, so its data must be fetched now rather than at the next tick).
   */
  restartKey?: string | number | null;
};

/**
 * Runs `callback` when the screen gains focus, when the app returns to the foreground while
 * the screen is focused, and every `intervalMs` in between. Stops on blur and in the
 * background. Calls never overlap: a tick that finds a call in flight waits for it and then
 * calls once more. Errors thrown by `callback` are swallowed (it must report its own
 * state); the latest `callback` is always used without restarting the schedule.
 */
export function useForegroundPoll(callback: () => unknown, options: ForegroundPollOptions = {}): void {
  const { intervalMs = FOREGROUND_POLL_MS, enabled = true, restartKey = null } = options;
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });
  // Shared across focus sessions so a quick blur/focus cannot start a second call.
  const inFlight = useRef<Promise<void> | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      let alive = true;
      let foreground = isForegroundState(AppState.currentState);
      let timer: ReturnType<typeof setTimeout> | null = null;

      const clear = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
      };
      const schedule = () => {
        clear();
        if (alive && foreground) timer = setTimeout(tick, intervalMs);
      };
      let waiting = false;
      function tick() {
        clear();
        if (!alive || !foreground) return;
        const running = inFlight.current;
        if (running) {
          // A call is still running (started before a blur, a background trip or a restart):
          // call again right after it, once, instead of overlapping it.
          if (!waiting) {
            waiting = true;
            void running.then(() => {
              waiting = false;
              tick();
            });
          }
          return;
        }
        const run = (async () => {
          try {
            await callbackRef.current();
          } catch {
            // The callback owns its error state; polling just continues.
          }
        })();
        inFlight.current = run;
        void run.then(() => {
          if (inFlight.current === run) inFlight.current = null;
          schedule();
        });
      }

      const sub = AppState.addEventListener('change', (state) => {
        const next = isForegroundState(state);
        if (next === foreground) return;
        foreground = next;
        if (next) tick();
        else clear();
      });
      if (foreground) tick();

      return () => {
        alive = false;
        clear();
        sub.remove();
      };
      // restartKey is a dependency on purpose: a new key re-runs the effect (first call now).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, intervalMs, restartKey]),
  );
}
