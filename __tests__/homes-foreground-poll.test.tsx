import { act, render } from '@testing-library/react-native';
import { useContext } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { FOREGROUND_POLL_MS, isForegroundState, useForegroundPoll } from '@/features/home/use-foreground-poll';

// useFocusEffect stand-in: the effect runs while the FocusContext value is true and is
// cleaned up when it turns false (blur) or the callback changes (restart).
jest.mock('expo-router', () => {
  const mockReact = jest.requireActual('react');
  const FocusContext = mockReact.createContext(true);
  return {
    FocusContext,
    useFocusEffect: (effect: () => undefined | (() => void)) => {
      const focused = mockReact.useContext(FocusContext);
      mockReact.useEffect(() => (focused ? effect() : undefined), [effect, focused]);
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FocusContext } = require('expo-router') as { FocusContext: React.Context<boolean> };

let appStateListener: ((s: AppStateStatus) => void) | null = null;
const removeSub = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  appStateListener = null;
  removeSub.mockClear();
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (s: AppStateStatus) => void;
    return { remove: removeSub } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function Probe({ cb, enabled, restartKey }: { cb: () => unknown; enabled?: boolean; restartKey?: string }) {
  useContext(FocusContext);
  useForegroundPoll(cb, { enabled, restartKey });
  return null;
}

async function mount(cb: () => unknown, props: { focused?: boolean; enabled?: boolean; restartKey?: string } = {}) {
  const view = await render(
    <FocusContext.Provider value={props.focused ?? true}>
      <Probe cb={cb} enabled={props.enabled} restartKey={props.restartKey} />
    </FocusContext.Provider>,
  );
  const rerender = (next: { focused?: boolean; enabled?: boolean; restartKey?: string }) =>
    view.rerender(
      <FocusContext.Provider value={next.focused ?? true}>
        <Probe cb={cb} enabled={next.enabled} restartKey={next.restartKey} />
      </FocusContext.Provider>,
    );
  return { ...view, rerenderWith: rerender };
}

const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

describe('useForegroundPoll', () => {
  it('treats only active/unknown as foreground', () => {
    expect(isForegroundState('active')).toBe(true);
    expect(isForegroundState('unknown')).toBe(true);
    expect(isForegroundState(null)).toBe(true);
    expect(isForegroundState('background')).toBe(false);
    expect(isForegroundState('inactive')).toBe(false);
  });

  it('runs on focus, then every 60 s', async () => {
    const cb = jest.fn(async () => {});
    await mount(cb);
    await advance(0);
    expect(cb).toHaveBeenCalledTimes(1);
    await advance(FOREGROUND_POLL_MS - 1);
    expect(cb).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(cb).toHaveBeenCalledTimes(2);
    await advance(FOREGROUND_POLL_MS * 2);
    expect(cb).toHaveBeenCalledTimes(4);
  });

  it('never overlaps calls: the next one waits for the slow one', async () => {
    let finish: () => void = () => {};
    const cb = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await mount(cb);
    await advance(FOREGROUND_POLL_MS * 3);
    expect(cb).toHaveBeenCalledTimes(1);
    // A foreground event while the call runs does not start a second one either.
    await act(async () => appStateListener?.('background'));
    await act(async () => appStateListener?.('active'));
    expect(cb).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    // The foreground event asked for a fresh call: it runs right after the slow one.
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('stops on blur and restarts with an immediate call on focus', async () => {
    const cb = jest.fn(async () => {});
    const view = await mount(cb);
    await advance(0);
    expect(cb).toHaveBeenCalledTimes(1);
    await act(async () => view.rerenderWith({ focused: false }));
    expect(removeSub).toHaveBeenCalled();
    await advance(FOREGROUND_POLL_MS * 5);
    expect(cb).toHaveBeenCalledTimes(1);
    await act(async () => view.rerenderWith({ focused: true }));
    await advance(0);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('a quick blur/focus during a slow call does not start a second one', async () => {
    let finish: () => void = () => {};
    const cb = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = await mount(cb);
    await advance(0);
    await act(async () => view.rerenderWith({ focused: false }));
    await act(async () => view.rerenderWith({ focused: true }));
    await advance(FOREGROUND_POLL_MS);
    expect(cb).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('pauses in the background and calls at once when back in the foreground', async () => {
    const cb = jest.fn(async () => {});
    await mount(cb);
    await advance(0);
    await act(async () => appStateListener?.('background'));
    await advance(FOREGROUND_POLL_MS * 3);
    expect(cb).toHaveBeenCalledTimes(1);
    await act(async () => appStateListener?.('active'));
    await advance(0);
    expect(cb).toHaveBeenCalledTimes(2);
    await advance(FOREGROUND_POLL_MS);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('does not start while the app is in the background', async () => {
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true, writable: true });
    const cb = jest.fn(async () => {});
    await mount(cb);
    await advance(FOREGROUND_POLL_MS * 2);
    expect(cb).not.toHaveBeenCalled();
  });

  it('never runs when disabled', async () => {
    const cb = jest.fn(async () => {});
    await mount(cb, { enabled: false });
    await advance(FOREGROUND_POLL_MS * 3);
    expect(cb).not.toHaveBeenCalled();
  });

  it('calls at once when the restart key changes', async () => {
    const cb = jest.fn(async () => {});
    const view = await mount(cb, { restartKey: 'a' });
    await advance(0);
    expect(cb).toHaveBeenCalledTimes(1);
    await act(async () => view.rerenderWith({ restartKey: 'b' }));
    await advance(0);
    expect(cb).toHaveBeenCalledTimes(2);
    // The schedule restarted from the new call.
    await advance(FOREGROUND_POLL_MS);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('keeps polling after the callback throws', async () => {
    const cb = jest.fn(async () => {
      throw new Error('boom');
    });
    await mount(cb);
    await advance(0);
    await advance(FOREGROUND_POLL_MS);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('stops all timers on unmount', async () => {
    const cb = jest.fn(async () => {});
    const view = await mount(cb);
    await advance(0);
    await act(async () => view.unmount());
    await advance(FOREGROUND_POLL_MS * 3);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
