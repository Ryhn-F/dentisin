// Home slot cards and "last brushing" row use the sessions of this phone AND today's sessions
// the server has (e.g. brushed on the child's own phone).
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import Home from '@/app/(tabs)/home';
import { brushingStreak, childHistory, listChildren } from '@/core/account/api';
import { useAccount } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import { DEFAULT_LIMITS, type BrushingRecord, type BrushingStreak, type HistoryItem, type MyAccount } from '@/domain/models';
import { clearHistoryCache } from '@/features/history/history-model';
import { latestBrushing, mergeBrushing, serverBrushingRecords, startOfTodayIso } from '@/features/home/today-brushing';
import { REFUSED_CHILD_RETRY_MS, useTodayBrushing } from '@/features/home/use-home-data';

jest.mock('@/core/auth/supabase', () => ({ supabase: null }));
jest.mock('expo-router', () => {
  const mockReact = jest.requireActual('react');
  return {
    router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
    useFocusEffect: (effect: () => undefined | (() => void)) => mockReact.useEffect(() => effect(), [effect]),
  };
});
jest.mock('@/core/account/api', () => ({
  ...jest.requireActual('@/core/account/api'),
  deviceTimeZone: () => 'Asia/Jakarta',
  listChildren: jest.fn(),
  brushingStreak: jest.fn(),
  childHistory: jest.fn(),
}));

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHILD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';

const mockHistory = childHistory as jest.Mock;
const mockStreak = brushingStreak as jest.Mock;
const mockChildren = listChildren as jest.Mock;
const push = router.push as jest.Mock;

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const wrap = (ui: React.ReactElement) => <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>;

/** Today at the given local hour (device zone). */
function todayAt(hour: number): string {
  const d = new Date();
  d.setHours(hour, 5, 0, 0);
  return d.toISOString();
}

function serverItem(sessionId: string, occurredAt: string, slot: 'morning' | 'evening' | 'other', durationS = 120): HistoryItem {
  return {
    kind: 'brushing',
    id: sessionId,
    occurredAt,
    data: { durationS, spiritScore: null, slot, cameraMode: false, countsForStreak: durationS >= 60, hasProof: false },
  };
}

function page(items: HistoryItem[]) {
  return { ok: true, data: { items, nextBefore: null } };
}

function localRecord(over: Partial<BrushingRecord> = {}): BrushingRecord {
  return {
    id: SESSION_A,
    childId: CHILD,
    startedAt: todayAt(7),
    durationS: 120,
    spiritScore: null,
    slot: 'morning',
    cameraMode: false,
    synced: false,
    proofId: null,
    ...over,
  };
}

function guardian(): MyAccount {
  return {
    userId: USER,
    accountType: 'guardian',
    roles: ['guardian'],
    selfChildId: null,
    childAccounts: 1,
    childAccount: null,
    flags: { brushingProofVideo: true },
    capabilities: { createChildAccounts: true, registerProofs: false },
    limits: DEFAULT_LIMITS,
  };
}

function serverStreak(): BrushingStreak {
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { date, done: i >= 5, brushings: i >= 5 ? 1 : 0 };
  });
  return { current: 2, longest: 2, lastDay: week[6].date, todayDone: true, week, minDurationS: 60, tz: 'Asia/Jakarta' };
}

function setup(account: MyAccount | null, status: 'signedIn' | 'guest' = 'signedIn', brushing: BrushingRecord[] = []) {
  useSession.setState({ status, userId: status === 'signedIn' ? USER : null });
  useAccount.setState({ userId: account ? USER : null, me: account, status: account ? 'ready' : 'idle', lastError: null });
  useLocalData.setState({
    kids: [{ id: CHILD, nickname: 'Budi', birthYear: 2016, birthMonth: null, allergies: [] }],
    activeChildId: CHILD,
    brushing,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearHistoryCache();
  mockChildren.mockResolvedValue({ ok: true, data: [] });
  mockStreak.mockResolvedValue({ ok: true, data: serverStreak() });
  mockHistory.mockResolvedValue(page([]));
});

const morningLabel = () => screen.getByLabelText(new RegExp(`^${id.home.todayMorning}:`)).props.accessibilityLabel as string;
const eveningLabel = () => screen.getByLabelText(new RegExp(`^${id.home.todayEvening}:`)).props.accessibilityLabel as string;

describe('today-brushing helpers', () => {
  it('startOfTodayIso is local midnight of the given day', () => {
    const now = new Date(2026, 9, 18, 15, 30, 10);
    expect(new Date(startOfTodayIso(now)).getTime()).toBe(new Date(2026, 9, 18, 0, 0, 0, 0).getTime());
  });

  it('maps brushing history items to synced records and skips other kinds', () => {
    const other: HistoryItem = {
      kind: 'screening_request',
      id: SESSION_B,
      occurredAt: todayAt(8),
      data: {
        reasonCode: 'toothache',
        painLevel: null,
        status: 'pending',
        seenAt: null,
        respondedAt: null,
        screeningId: null,
        expiresAt: todayAt(9),
      },
    };
    const records = serverBrushingRecords(CHILD, [serverItem(SESSION_A, todayAt(19), 'evening', 90), other]);
    expect(records).toEqual([
      {
        id: SESSION_A,
        childId: CHILD,
        startedAt: todayAt(19),
        durationS: 90,
        spiritScore: null,
        slot: 'evening',
        cameraMode: false,
        synced: true,
        proofId: null,
      },
    ]);
  });

  it('merges local first and dedupes by brushing id', () => {
    const local = [localRecord({ id: SESSION_A, synced: false })];
    const server = serverBrushingRecords(CHILD, [
      serverItem(SESSION_A, todayAt(7), 'morning'),
      serverItem(SESSION_B, todayAt(19), 'evening'),
    ]);
    const merged = mergeBrushing(local, server);
    expect(merged.map((r) => r.id)).toEqual([SESSION_A, SESSION_B]);
    expect(merged[0].synced).toBe(false); // the local copy wins
    expect(mergeBrushing(local, [])).toEqual(local);
    expect(latestBrushing(merged)?.id).toBe(SESSION_B);
    expect(latestBrushing([])).toBeNull();
  });
});

describe('Home slot cards with server sessions', () => {
  it('shows a slot brushed on another phone as done, and asks child_history for today only', async () => {
    setup(guardian());
    mockHistory.mockResolvedValue(page([serverItem(SESSION_B, todayAt(19), 'evening')]));
    await render(wrap(<Home />));

    await waitFor(() => expect(eveningLabel()).toBe(`${id.home.todayEvening}: ${id.home.slotDone}`));
    expect(morningLabel()).not.toContain(id.home.slotDone);

    expect(mockHistory).toHaveBeenCalledTimes(1);
    const q = mockHistory.mock.calls[0][0];
    expect(q.childId).toBe(CHILD);
    expect(q.kinds).toEqual(['brushing']);
    expect(q.limit).toBe(20);
    expect(new Date(q.from).getTime()).toBe(new Date(startOfTodayIso()).getTime());
  });

  it('combines local and server slots, and the last row opens the cached server item', async () => {
    setup(guardian(), 'signedIn', [localRecord({ id: SESSION_A, slot: 'morning', startedAt: todayAt(7) })]);
    mockHistory.mockResolvedValue(page([serverItem(SESSION_B, todayAt(20), 'evening')]));
    await render(wrap(<Home />));

    await waitFor(() => expect(eveningLabel()).toContain(id.home.slotDone));
    expect(morningLabel()).toContain(id.home.slotDone);

    await fireEvent.press(screen.getByText(id.home.lastBrushing));
    expect(push).toHaveBeenCalledWith(`/history/brushing:${SESSION_B}`);
  });

  it('a session on both sources counts once and keeps the local detail route', async () => {
    setup(guardian(), 'signedIn', [localRecord({ id: SESSION_A, slot: 'morning' })]);
    mockHistory.mockResolvedValue(page([serverItem(SESSION_A, todayAt(7), 'morning')]));
    await render(wrap(<Home />));
    await waitFor(() => expect(mockHistory).toHaveBeenCalled());
    expect(morningLabel()).toContain(id.home.slotDone);
    expect(eveningLabel()).not.toContain(id.home.slotDone);
    await fireEvent.press(screen.getByText(id.home.lastBrushing));
    expect(push).toHaveBeenCalledWith(`/history/${SESSION_A}`);
  });

  it('stays local when the backend is not deployed', async () => {
    setup(guardian(), 'signedIn', [localRecord({ slot: 'morning' })]);
    mockHistory.mockResolvedValue({ ok: false, code: 'not_deployed' });
    await render(wrap(<Home />));
    await waitFor(() => expect(mockHistory).toHaveBeenCalled());
    expect(morningLabel()).toContain(id.home.slotDone);
    expect(eveningLabel()).not.toContain(id.home.slotDone);
  });

  it('never calls child_history for a guest', async () => {
    setup(null, 'guest', [localRecord({ slot: 'evening', startedAt: todayAt(20) })]);
    await render(wrap(<Home />));
    expect(eveningLabel()).toContain(id.home.slotDone);
    expect(mockHistory).not.toHaveBeenCalled();
  });
});

describe('useTodayBrushing', () => {
  it('does not call when not remote and hides another child answer', async () => {
    const { result, rerender } = await renderHook(
      ({ child, remote }: { child: string; remote: boolean }) => useTodayBrushing(child, remote),
      { initialProps: { child: CHILD, remote: false } },
    );
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockHistory).not.toHaveBeenCalled();

    mockHistory.mockResolvedValue(page([serverItem(SESSION_A, todayAt(7), 'morning')]));
    await rerender({ child: CHILD, remote: true });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.records).toHaveLength(1);
    await rerender({ child: OTHER, remote: true });
    expect(result.current.records).toEqual([]);
  });

  it('a forbidden child is asked again only after a while; not_deployed stops for good', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-18T07:00:00Z') });
    try {
      mockHistory.mockResolvedValue({ ok: false, code: 'forbidden' });
      const { result } = await renderHook(() => useTodayBrushing(CHILD, true));
      await act(async () => {
        await result.current.refresh();
        await result.current.refresh();
      });
      expect(mockHistory).toHaveBeenCalledTimes(1);
      jest.setSystemTime(Date.now() + REFUSED_CHILD_RETRY_MS);
      mockHistory.mockResolvedValue({ ok: false, code: 'not_deployed' });
      await act(async () => {
        await result.current.refresh();
        await result.current.refresh();
      });
      expect(mockHistory).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the last answer when a refresh fails on the network', async () => {
    mockHistory.mockResolvedValueOnce(page([serverItem(SESSION_A, todayAt(7), 'morning')]));
    const { result } = await renderHook(() => useTodayBrushing(CHILD, true));
    await act(async () => {
      await result.current.refresh();
    });
    mockHistory.mockResolvedValue({ ok: false, code: 'network' });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.records.map((r) => r.id)).toEqual([SESSION_A]);
  });
});
