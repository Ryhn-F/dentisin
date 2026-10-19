// Integration fixes after the parallel account-v2 tasks: shared components that now serve
// children without a nickname and teen accounts, the guardian's permanent entry points to
// requests / proof videos, and the sync status screen (outbox attention list).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import Home from '@/app/(tabs)/home';
import Settings from '@/app/(tabs)/profile/settings';
import { ChildSwitcher } from '@/components/child-switcher';
import { ScreeningCard } from '@/components/screening-card';
import { brushingStreak, listChildren } from '@/core/account/api';
import { useAccount } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { outbox, useOutboxStatus, type OutboxEntry } from '@/core/sync/outbox';
import { useLocalData } from '@/data/local-store';
import { DEFAULT_LIMITS, type ChildSummary, type MyAccount } from '@/domain/models';
import { SyncScreen } from '@/features/sync/sync-screen';

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
  listScreeningRequests: jest.fn(async () => ({ ok: true, data: [] })),
}));
jest.mock('@/core/sync/outbox', () => {
  const actual = jest.requireActual('@/core/sync/outbox');
  const listeners = new Set<() => void>();
  let entries: unknown[] = [];
  return {
    ...actual,
    outbox: {
      needsAttention: jest.fn(() => entries.map((e) => ({ ...(e as object) }))),
      subscribe: jest.fn((l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      }),
      dismiss: jest.fn((eventId: string) => {
        entries = entries.filter((e) => (e as { eventId: string }).eventId !== eventId);
        listeners.forEach((l) => l());
        return true;
      }),
      flush: jest.fn(async () => ({})),
      pendingCount: jest.fn(() => 0),
      __setEntries: (next: unknown[]) => {
        entries = next;
      },
    },
  };
});

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHILD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHILD2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EVENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const mockListChildren = listChildren as jest.Mock;
const mockStreak = brushingStreak as jest.Mock;
const push = router.push as jest.Mock;
const fakeOutbox = outbox as unknown as {
  dismiss: jest.Mock;
  flush: jest.Mock;
  __setEntries: (e: OutboxEntry[]) => void;
};

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const wrap = (ui: React.ReactElement) => <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>;

function account(accountType: 'guardian' | 'teen', over: Partial<MyAccount> = {}): MyAccount {
  return {
    userId: USER,
    accountType,
    roles: ['guardian'],
    selfChildId: accountType === 'teen' ? CHILD : null,
    childAccounts: accountType === 'guardian' ? 1 : null,
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

function entry(over: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    eventId: EVENT,
    type: 'brushing_recorded',
    childId: CHILD,
    payloadJson: '{}',
    createdAt: '2026-10-18T01:00:00.000Z',
    attempts: 1,
    state: 'rejected',
    code: 'consent_required',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListChildren.mockResolvedValue({ ok: true, data: [] });
  mockStreak.mockResolvedValue({ ok: false, code: 'not_deployed' });
  fakeOutbox.__setEntries([]);
  setKids([], null);
});

describe('ChildSwitcher', () => {
  it('gives a child with a blank nickname a readable chip instead of an empty one', async () => {
    await render(
      wrap(
        <ChildSwitcher
          kids={[
            { id: CHILD, nickname: 'Budi' },
            { id: CHILD2, nickname: '  ' },
          ]}
          activeId={CHILD}
          onChange={() => {}}
        />,
      ),
    );
    expect(screen.getByRole('button', { name: 'Budi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: id.components.childSwitcher.unnamed })).toBeTruthy();
  });
});

describe('ScreeningCard', () => {
  it('uses the teen wording when photo screening is active', async () => {
    await render(wrap(<ScreeningCard soon={false} activeBody={id.homeV2.teen.screeningCardBody} onPress={() => {}} />));
    expect(screen.getByText(id.homeV2.teen.screeningCardBody)).toBeTruthy();
    expect(screen.queryByText(id.home.screeningCardBodyActive)).toBeNull();
  });

  it('keeps the explanation text while the feature waits for sign-off', async () => {
    await render(wrap(<ScreeningCard activeBody={id.homeV2.teen.screeningCardBody} onPress={() => {}} />));
    expect(screen.getByText(id.home.screeningCardBody)).toBeTruthy();
  });
});

describe('Home: guardian entry points', () => {
  // Lets the list_children / streak promises settle inside act before the next assertion.
  const settle = () => act(async () => {});

  it('always links to the requests list and the proof videos once a child has an account', async () => {
    signIn(account('guardian'));
    setKids([{ id: CHILD, nickname: 'Budi' }], CHILD);
    mockListChildren.mockResolvedValue({
      ok: true,
      data: [summary(CHILD, { hasChildAccount: true, unseenRequests: 0, unviewedProofs: 2 })],
    });
    await render(wrap(<Home />));
    await waitFor(() => expect(screen.getByTestId('home-guardian-requests')).toBeTruthy());
    expect(screen.getByLabelText(id.homeV2.guardian.requestsLabel(0))).toBeTruthy();
    expect(screen.getByLabelText(id.homeV2.guardian.proofsLabel(2))).toBeTruthy();

    await fireEvent.press(screen.getByTestId('home-guardian-requests'));
    expect(push).toHaveBeenCalledWith('/requests');
    await fireEvent.press(screen.getByTestId('home-guardian-proofs'));
    expect(push).toHaveBeenCalledWith('/proofs');
    await settle();
  });

  it('hides them while no child has an account', async () => {
    signIn(account('guardian'));
    setKids([{ id: CHILD, nickname: 'Budi' }], CHILD);
    mockListChildren.mockResolvedValue({ ok: true, data: [summary(CHILD)] });
    await render(wrap(<Home />));
    await waitFor(() => expect(mockListChildren).toHaveBeenCalled());
    await settle();
    expect(screen.queryByTestId('home-guardian-requests')).toBeNull();
    expect(screen.queryByTestId('home-guardian-proofs')).toBeNull();
  });

  it('hides them on a legacy backend (no server calls)', async () => {
    signIn(account('guardian', { legacy: true }));
    setKids([{ id: CHILD, nickname: 'Budi' }], CHILD);
    await render(wrap(<Home />));
    await settle();
    expect(mockListChildren).not.toHaveBeenCalled();
    expect(screen.queryByTestId('home-guardian-requests')).toBeNull();
    expect(screen.queryByTestId('home-guardian-proofs')).toBeNull();
  });

  it('hides them for a teen (the teen has its own "Video sikat gigiku" row)', async () => {
    signIn(account('teen'));
    setKids([{ id: CHILD, nickname: 'Saya', isSelf: true }], CHILD);
    mockListChildren.mockResolvedValue({ ok: true, data: [summary(CHILD, { isSelf: true, hasChildAccount: true })] });
    await render(wrap(<Home />));
    await waitFor(() => expect(screen.getByTestId('home-teen-proofs')).toBeTruthy());
    await settle();
    expect(screen.queryByTestId('home-guardian-requests')).toBeNull();
    expect(screen.queryByTestId('home-guardian-proofs')).toBeNull();
  });
});

describe('Settings', () => {
  it('shows the live sync status, opens the sync screen and states the server streak rule', async () => {
    signIn(account('guardian'));
    useOutboxStatus.setState({ ready: true, pending: 0, rejected: 0, held: 0, pauseReason: null, backoffReason: null });
    await render(wrap(<Settings />));
    expect(screen.getByText(id.components.sync.synced)).toBeTruthy();
    expect(screen.getByText(id.settings.streakRuleValue(1))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('settings-sync'));
    expect(push).toHaveBeenCalledWith('/profile/sync');
  });
});

describe('SyncScreen', () => {
  it('lists refused events with the reason in plain words and dismisses them', async () => {
    signIn(account('guardian'));
    setKids([{ id: CHILD, nickname: 'Budi' }], CHILD);
    useOutboxStatus.setState({ ready: true, pending: 0, rejected: 1, held: 0, pauseReason: null, backoffReason: null, lastSuccessAt: null });
    fakeOutbox.__setEntries([entry()]);
    await render(wrap(<SyncScreen />));
    expect(screen.getByText(id.syncV2.messages.needsAttention)).toBeTruthy();
    expect(screen.getByText(id.syncV2.types.brushing_recorded)).toBeTruthy();
    expect(screen.getByText(new RegExp(id.syncV2.codes.consent_required.replace(/[.()]/g, '\\$&')))).toBeTruthy();
    expect(screen.getByText(id.syncV2.neverSynced)).toBeTruthy();

    await fireEvent.press(screen.getByTestId(`sync-dismiss-${EVENT}`));
    expect(fakeOutbox.dismiss).toHaveBeenCalledWith(EVENT, { giveUp: true });
    await waitFor(() => expect(screen.getByTestId('sync-attention-empty')).toBeTruthy());
  });

  it('a held event explains it waits for another refused one; "send now" ignores the backoff', async () => {
    signIn(account('guardian'));
    useOutboxStatus.setState({ ready: true, pending: 2, rejected: 0, held: 1, pauseReason: null, backoffReason: 'network' });
    fakeOutbox.__setEntries([entry({ state: 'held', code: 'dependency_rejected', type: 'screening_recorded' })]);
    await render(wrap(<SyncScreen />));
    expect(screen.getByText(new RegExp(id.syncV2.codes.dependency_rejected))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sync-now'));
    expect(fakeOutbox.flush).toHaveBeenCalledWith({ ignoreBackoff: true });
  });

  it('guest: local-only note, no send button and no attention list', async () => {
    signIn(null, 'guest');
    await render(wrap(<SyncScreen />));
    expect(screen.getByText(id.syncV2.messages.localOnly)).toBeTruthy();
    expect(screen.queryByTestId('sync-now')).toBeNull();
    expect(screen.queryByTestId('sync-attention-empty')).toBeNull();
  });
});
