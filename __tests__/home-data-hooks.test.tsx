// Home data hooks (src/features/home/use-home-data.ts): a 'forbidden' answer for one child (not on
// the server yet, consent (b) still off) must not switch off the server streak of the others;
// only a backend-wide answer (not_deployed / not_configured) stops every call.
import { act, renderHook } from '@testing-library/react-native';

import { brushingStreak } from '@/core/account/api';
import { useLocalData } from '@/data/local-store';
import type { BrushingStreak } from '@/domain/models';
import { REFUSED_CHILD_RETRY_MS, useBrushingStreak } from '@/features/home/use-home-data';

jest.mock('@/core/auth/supabase', () => ({ supabase: null }));
jest.mock('@/core/account/api', () => ({
  ...jest.requireActual('@/core/account/api'),
  deviceTimeZone: () => 'Asia/Jakarta',
  brushingStreak: jest.fn(),
}));

const SYNCED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOCAL_ONLY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const mockStreak = brushingStreak as jest.Mock;

function streak(current: number): BrushingStreak {
  return { current, longest: current, lastDay: '2026-10-18', todayDone: true, week: [], minDurationS: 60, tz: 'Asia/Jakarta' };
}

beforeEach(() => {
  mockStreak.mockReset();
  mockStreak.mockImplementation(async (childId: string) =>
    childId === SYNCED ? { ok: true, data: streak(9) } : { ok: false, code: 'forbidden' },
  );
  useLocalData.setState({ brushing: [] });
});

describe('useBrushingStreak', () => {
  it('a forbidden child does not stop the server streak of another child', async () => {
    const { result, rerender } = await renderHook(({ child }: { child: string }) => useBrushingStreak(child, true), {
      initialProps: { child: LOCAL_ONLY },
    });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.source).toBe('local');
    expect(result.current.stopped).toBe(false);

    await rerender({ child: SYNCED });
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockStreak).toHaveBeenLastCalledWith(SYNCED, 'Asia/Jakarta');
    expect(result.current.source).toBe('server');
    expect(result.current.streak.current).toBe(9);
  });

  it('a refused child is asked again only after a while', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-18T07:00:00Z') });
    try {
      const { result } = await renderHook(() => useBrushingStreak(LOCAL_ONLY, true));
      await act(async () => {
        await result.current.refresh();
      });
      await act(async () => {
        await result.current.refresh();
      });
      expect(mockStreak).toHaveBeenCalledTimes(1);
      jest.setSystemTime(Date.now() + REFUSED_CHILD_RETRY_MS);
      await act(async () => {
        await result.current.refresh();
      });
      expect(mockStreak).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('not_deployed stops the calls for every child', async () => {
    mockStreak.mockResolvedValue({ ok: false, code: 'not_deployed' });
    const { result, rerender } = await renderHook(({ child }: { child: string }) => useBrushingStreak(child, true), {
      initialProps: { child: LOCAL_ONLY },
    });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.stopped).toBe(true);
    await rerender({ child: SYNCED });
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockStreak).toHaveBeenCalledTimes(1);
  });
});
