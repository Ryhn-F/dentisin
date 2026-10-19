import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import Home from '@/app/(tabs)/home';
import { brushingStreak, listChildren, listScreeningRequests } from '@/core/account/api';
import { useAccount } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import { DEFAULT_LIMITS, type BrushingStreak, type ChildSummary, type MyAccount, type ScreeningRequest } from '@/domain/models';
import { KidAccountScreen } from '@/features/kid/kid-account-screen';
import { KidHomeScreen } from '@/features/kid/kid-home-screen';

jest.mock('@/core/auth/supabase', () => ({ supabase: null }));
jest.mock('expo-router', () => {
  const mockReact = jest.requireActual('react');
  return {
    router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
    // Focused while mounted.
    useFocusEffect: (effect: () => undefined | (() => void)) => mockReact.useEffect(() => effect(), [effect]),
  };
});
jest.mock('@/core/account/api', () => ({
  ...jest.requireActual('@/core/account/api'),
  deviceTimeZone: () => 'Asia/Jakarta',
  listChildren: jest.fn(),
  brushingStreak: jest.fn(),
  listScreeningRequests: jest.fn(),
}));

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHILD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHILD2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GUARDIAN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const mockListChildren = listChildren as jest.Mock;
const mockStreak = brushingStreak as jest.Mock;
const mockRequests = listScreeningRequests as jest.Mock;
const push = router.push as jest.Mock;

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const wrap = (ui: React.ReactElement) => <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>;

function serverStreak(over: Partial<BrushingStreak> = {}): BrushingStreak {
  const today = new Date();
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - 6 + i);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { date, done: i >= 3 && i < 6, brushings: i >= 3 && i < 6 ? 1 : 0 };
  });
  return { current: 3, longest: 5, lastDay: week[5].date, todayDone: false, week, minDurationS: 60, tz: 'Asia/Jakarta', ...over };
}

function childAccount(over: Partial<NonNullable<MyAccount['childAccount']>> = {}): MyAccount {
  return {
    userId: USER,
    accountType: 'child',
    roles: ['child'],
    selfChildId: null,
    childAccounts: null,
    childAccount: { childId: CHILD, guardianId: GUARDIAN, username: 'si.budi', disabled: false, syncAllowed: true, proofAllowed: false, ...over },
    flags: { brushingProofVideo: true },
    capabilities: { createChildAccounts: false, registerProofs: !!over.proofAllowed },
    limits: DEFAULT_LIMITS,
  };
}

function adult(accountType: 'guardian' | 'teen', over: Partial<MyAccount> = {}): MyAccount {
  return {
    userId: USER,
    accountType,
    roles: ['guardian'],
    selfChildId: accountType === 'teen' ? CHILD : null,
    childAccounts: accountType === 'guardian' ? 0 : null,
    childAccount: null,
    flags: { brushingProofVideo: true },
    capabilities: { createChildAccounts: accountType === 'guardian', registerProofs: accountType === 'teen' },
    limits: DEFAULT_LIMITS,
    ...over,
  };
}

function summary(childId: string, over: Partial<ChildSummary> = {}): ChildSummary {
  return {
    childId,
    isSelf: false,
    birthYear: 2016,
    birthMonth: null,
    consents: ['a', 'b'],
    hasChildAccount: false,
    childAccountDisabled: null,
    username: null,
    lastScreeningAt: null,
    lastScreeningLevel: null,
    lastBrushingAt: null,
    openRequests: 0,
    unseenRequests: 0,
    unviewedProofs: 0,
    deletionPending: false,
    ...over,
  };
}

function req(over: Partial<ScreeningRequest> = {}): ScreeningRequest {
  return {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    childId: CHILD,
    reasonCode: 'toothache',
    painLevel: 5,
    status: 'pending',
    createdAt: '2026-10-18T01:00:00Z',
    seenAt: null,
    respondedAt: null,
    screeningId: null,
    expiresAt: '2026-11-01T01:00:00Z',
    ...over,
  };
}

function signIn(me: MyAccount | null, status: 'signedIn' | 'guest' = 'signedIn') {
  useSession.setState({ status, userId: status === 'signedIn' ? USER : null });
  useAccount.setState({ userId: me ? USER : null, me, status: me ? 'ready' : 'idle', lastError: null });
}

function setKids(kids: { id: string; nickname: string; isSelf?: boolean }[], activeChildId: string | null) {
  useLocalData.setState({
    kids: kids.map((k) => ({ birthYear: 2016, birthMonth: null, allergies: [], ...k })),
    activeChildId,
    brushing: [],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListChildren.mockResolvedValue({ ok: true, data: [] });
  mockStreak.mockResolvedValue({ ok: true, data: serverStreak() });
  mockRequests.mockResolvedValue({ ok: true, data: [] });
  setKids([], null);
});

describe('KidHomeScreen', () => {
  it('greets the child, shows the server streak and the two big buttons', async () => {
    signIn(childAccount());
    setKids([{ id: CHILD, nickname: 'si.budi' }], CHILD);
    await render(wrap(<KidHomeScreen />));
    expect(screen.getByText(id.kid.home.hello('si.budi'))).toBeTruthy();
    await waitFor(() => expect(mockStreak).toHaveBeenCalledWith(CHILD, 'Asia/Jakarta'));
    expect(mockRequests).toHaveBeenCalledWith({ childId: CHILD, limit: 5 });
    await waitFor(() => expect(screen.getByLabelText(`3 ${id.components.streak.daysInARow}`)).toBeTruthy());
    expect(screen.getByText(id.kid.home.todayNotYet)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('kid-brush-now'));
    expect(push).toHaveBeenCalledWith('/brushing/session');
    await fireEvent.press(screen.getByTestId('kid-toothache'));
    expect(push).toHaveBeenCalledWith('/requests/new');
  });

  it('never shows screening content: no results, levels, photos, referrals, settings or delete', async () => {
    signIn(childAccount({ proofAllowed: true }));
    mockRequests.mockResolvedValue({ ok: true, data: [req({ status: 'done', screeningId: CHILD2 })] });
    await render(wrap(<KidHomeScreen />));
    await waitFor(() => expect(screen.getByTestId('kid-request-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).toBeTruthy());

    expect(screen.queryByTestId('home-screening')).toBeNull();
    const forbidden = [
      id.home.screeningCardTitle,
      id.common.disclaimer,
      ...Object.values(id.levels).flatMap((l) => [l.label, l.advice]),
      id.profile.title,
    ];
    for (const text of forbidden) expect(screen.queryByText(text)).toBeNull();
    // Row text is reason + status only.
    expect(screen.getByText(id.kid.requests.reasons.toothache)).toBeTruthy();
    expect(screen.getByText(new RegExp(id.kid.requests.statuses.done))).toBeTruthy();
    expect(screen.queryByText(new RegExp(CHILD2))).toBeNull();
    // Proof hint: the video goes to the parent.
    expect(screen.getByText(id.kid.home.proofHint)).toBeTruthy();
  });

  it('asks to have the account enabled when sync is not allowed', async () => {
    signIn(childAccount({ syncAllowed: false }));
    await render(wrap(<KidHomeScreen />));
    expect(screen.getByText(id.kid.home.syncOffTitle)).toBeTruthy();
    expect(screen.queryByText(id.kid.home.proofHint)).toBeNull();
  });

  it('keeps the local red-flag advice on top for an open swelling request', async () => {
    signIn(childAccount());
    mockRequests.mockResolvedValue({ ok: true, data: [req({ reasonCode: 'swelling', status: 'seen' })] });
    await render(wrap(<KidHomeScreen />));
    await waitFor(() => expect(screen.getByTestId('kid-swelling')).toBeTruthy());
    expect(screen.getByText(id.kid.requests.swellingBody)).toBeTruthy();
  });

  it('degrades to the local streak and a friendly state when v2 is not deployed', async () => {
    signIn(childAccount());
    mockStreak.mockResolvedValue({ ok: false, code: 'not_deployed' });
    mockRequests.mockResolvedValue({ ok: false, code: 'not_deployed' });
    await render(wrap(<KidHomeScreen />));
    await waitFor(() => expect(screen.getByText(id.kid.requests.unavailable)).toBeTruthy());
    expect(screen.getByLabelText(`0 ${id.components.streak.daysInARow}`)).toBeTruthy();
  });
});

describe('KidAccountScreen', () => {
  it('shows the username and signs out only after confirming', async () => {
    const signOut = jest.fn(async () => {});
    signIn(childAccount());
    useSession.setState({ signOut });
    await render(wrap(<KidAccountScreen />));
    expect(screen.getByText('si.budi')).toBeTruthy();
    expect(screen.getByText(id.kid.account.forgotTitle)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('kid-signout'));
    expect(signOut).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('kid-signout-no'));
    expect(screen.queryByTestId('kid-signout-confirm')).toBeNull();

    await fireEvent.press(screen.getByTestId('kid-signout'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('kid-signout-yes'));
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe('Home (guardian / teen / guest)', () => {
  it('guardian: polls list_children, merges unknown children and shows the badges', async () => {
    signIn(adult('guardian'));
    setKids([{ id: CHILD, nickname: 'Budi' }], CHILD);
    mockListChildren.mockResolvedValue({
      ok: true,
      data: [summary(CHILD, { unseenRequests: 1 }), summary(CHILD2, { unviewedProofs: 2 })],
    });
    await render(wrap(<Home />));
    await waitFor(() => expect(screen.getByTestId('home-banner-requests')).toBeTruthy());
    // The old "Data contoh" badge is gone (its string was removed with the mock store).
    expect(screen.queryByText(/data contoh/i)).toBeNull();
    // The unknown child was merged locally without a nickname -> "Anak 1".
    expect(useLocalData.getState().kids.map((k) => k.id)).toEqual([CHILD, CHILD2]);
    expect(screen.getByText(id.homeV2.banners.requestsBody('Budi'))).toBeTruthy();
    expect(screen.getByText(id.homeV2.banners.proofsBody(2, 'Anak 1'))).toBeTruthy();
    expect(screen.getByTestId('home-banner-unnamed')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(id.homeV2.banners.requestsAction));
    expect(push).toHaveBeenCalledWith('/requests');
    await fireEvent.press(screen.getByLabelText(id.homeV2.banners.proofsAction));
    expect(push).toHaveBeenCalledWith({ pathname: '/proofs', params: { child: CHILD2 } });

    expect(mockStreak).toHaveBeenCalledWith(CHILD, 'Asia/Jakarta');
    expect(screen.getByText(id.homeV2.keepStreak)).toBeTruthy();
  });

  it('legacy guardian (v2 not deployed): local only, no server calls', async () => {
    signIn({ ...adult('guardian'), legacy: true });
    setKids([{ id: CHILD, nickname: 'Budi' }], CHILD);
    await render(wrap(<Home />));
    expect(screen.getByTestId('streak-card')).toBeTruthy();
    expect(mockListChildren).not.toHaveBeenCalled();
    expect(mockStreak).not.toHaveBeenCalled();
  });

  it('guest: local only and the add-child empty state', async () => {
    signIn(null, 'guest');
    await render(wrap(<Home />));
    expect(screen.getByText(id.home.emptyTitle)).toBeTruthy();
    expect(mockListChildren).not.toHaveBeenCalled();
  });

  it('teen: no child switcher or add-child, own streak and "Video sikat gigiku" with a badge', async () => {
    signIn(adult('teen'));
    setKids([{ id: CHILD, nickname: '', isSelf: true }], CHILD);
    mockListChildren.mockResolvedValue({ ok: true, data: [summary(CHILD, { isSelf: true, unviewedProofs: 2 })] });
    await render(wrap(<Home />));
    await waitFor(() => expect(screen.getByTestId('home-teen-proofs-badge')).toBeTruthy());
    expect(screen.getByText(id.homeV2.teen.subtitle)).toBeTruthy();
    expect(screen.queryByTestId(`child-chip-${CHILD}`)).toBeNull();
    expect(screen.queryByText(id.home.emptyAction)).toBeNull();
    expect(screen.queryByTestId('home-banner-unnamed')).toBeNull();
    expect(screen.queryByTestId(`home-banner-proofs-${CHILD}`)).toBeNull();
    expect(mockStreak).toHaveBeenCalledWith(CHILD, 'Asia/Jakarta');

    await fireEvent.press(screen.getByTestId('home-teen-proofs'));
    expect(push).toHaveBeenCalledWith({ pathname: '/proofs', params: { child: CHILD } });
  });
});
