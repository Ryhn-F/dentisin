// Deletion screens: the Pengaturan rows per account type, the guardian's child picker with the
// deletion_pending state, the two-step confirmation (acknowledge, then confirm), the teen's
// self profile, the account deletion (sign-out + welcome notice) and child accounts refused.
// request_deletion / list_children are mocked at the API layer; the flow and stores are real.
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import Welcome from '@/app/(entry)/welcome';
import Settings from '@/app/(tabs)/profile/settings';
import { useAccount } from '@/core/account/account-store';
import { listChildren, requestDeletion } from '@/core/account/api';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import { DEFAULT_LIMITS, type ChildSummary, type MyAccount } from '@/domain/models';
import { DeletionScreen } from '@/features/deletion/deletion-screen';
import { useDeletionNotice } from '@/features/deletion/notice';

jest.mock('@/core/auth/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { refreshSession: jest.fn(), signOut: jest.fn(async () => ({ error: null })), getSession: jest.fn(), onAuthStateChange: jest.fn() },
  },
}));
jest.mock('@/core/account/api', () => ({
  ...jest.requireActual('@/core/account/api'),
  listChildren: jest.fn(),
  requestDeletion: jest.fn(),
}));
const mockParams: { scope?: string; child?: string } = {};
jest.mock('expo-router', () => {
  const mockReact = jest.requireActual('react');
  return {
    router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
    Stack: { Screen: () => null },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void) => mockReact.useEffect(cb, [cb]),
  };
});

const GUARDIAN = '0b0b0b0b-0000-4000-8000-000000000001';
const TEEN = '0b0b0b0b-0000-4000-8000-000000000002';
const CHILD = 'c0c0c0c0-0000-4000-8000-000000000001';
const CHILD2 = 'c0c0c0c0-0000-4000-8000-000000000002';
const SELF = 'c0c0c0c0-0000-4000-8000-0000000000ff';
const REQUEST = 'd0d0d0d0-0000-4000-8000-000000000001';
const t = id.deletion;
const list = listChildren as jest.Mock;
const request = requestDeletion as jest.Mock;
const push = router.push as jest.Mock;
const back = router.back as jest.Mock;

function account(over: Partial<MyAccount> = {}): MyAccount {
  return {
    userId: GUARDIAN,
    accountType: 'guardian',
    roles: ['guardian'],
    selfChildId: null,
    childAccounts: 0,
    childAccount: null,
    flags: { brushingProofVideo: true },
    capabilities: { createChildAccounts: true, registerProofs: false },
    limits: DEFAULT_LIMITS,
    ...over,
  };
}
const teen = account({ userId: TEEN, accountType: 'teen', selfChildId: SELF, capabilities: { createChildAccounts: false, registerProofs: true } });

function row(over: Partial<ChildSummary> = {}): ChildSummary {
  return {
    childId: CHILD,
    isSelf: false,
    birthYear: 2016,
    birthMonth: 3,
    consents: ['b'],
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

const ok = <T,>(data: T) => ({ ok: true as const, data });
const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const wrap = (node: React.ReactNode) => <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>;

function signIn(me: MyAccount) {
  useSession.setState({ status: 'signedIn', userId: me.userId, email: 'ortu@contoh.com' });
  useAccount.setState({ userId: me.userId, me, status: 'ready', lastError: null });
}

function setKids(kids: { id: string; nickname: string; isSelf?: boolean }[]) {
  useLocalData.setState({
    scope: null,
    ready: true,
    kids: kids.map((k) => ({ birthYear: 2016, birthMonth: 3, allergies: [], ...k })),
    activeChildId: kids[0]?.id ?? null,
    brushing: [],
    screenings: [],
    referrals: [],
    consentRecords: {},
    consents: {},
    unsyncedChildren: [],
    syncBlocked: {},
  });
}

async function acknowledgeAndConfirm(confirmLabel: string) {
  await fireEvent.press(screen.getByTestId('deletion-ack'));
  await fireEvent.press(screen.getByTestId('deletion-next'));
  expect(screen.getByText(confirmLabel)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('deletion-confirm-confirm'));
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockParams)) delete mockParams[key as keyof typeof mockParams];
  list.mockReset().mockResolvedValue(ok([row(), row({ childId: CHILD2, deletionPending: true })]));
  request.mockReset().mockResolvedValue(ok(REQUEST));
  useDeletionNotice.getState().dismiss();
  signIn(account());
  setKids([
    { id: CHILD, nickname: 'Budi' },
    { id: CHILD2, nickname: 'Sari' },
  ]);
});

describe('Pengaturan rows', () => {
  it('guardian: "Hapus data anak" and "Hapus akun" open the deletion screen', async () => {
    await render(wrap(<Settings />));
    await fireEvent.press(screen.getByTestId('settings-delete-child'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/profile/delete', params: { scope: 'child' } });
    await fireEvent.press(screen.getByTestId('settings-delete-account'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/profile/delete', params: { scope: 'account' } });
    expect(screen.getByText(t.settings.footer)).toBeTruthy();
    expect(screen.queryByText(id.common.soon)).toBeNull();
  });

  it('teen: the own profile row; guest: still local only', async () => {
    signIn(teen);
    await render(wrap(<Settings />));
    expect(screen.getByText(t.settings.selfRow)).toBeTruthy();
    expect(screen.getByText(id.settings.deleteAccount)).toBeTruthy();
    await screen.unmount();

    useSession.setState({ status: 'guest', userId: null, email: null });
    useAccount.setState({ userId: null, me: null });
    await render(wrap(<Settings />));
    expect(screen.getByText(id.common.soon)).toBeTruthy();
    expect(screen.queryByTestId('settings-delete-child')).toBeNull();
    expect(screen.queryByTestId('settings-delete-account')).toBeNull();
  });
});

describe('guardian: one child', () => {
  it('lists children, a child being deleted cannot be picked again', async () => {
    mockParams.scope = 'child';
    await render(wrap(<DeletionScreen />));
    await waitFor(() => expect(screen.getByText(t.choose.pendingChip)).toBeTruthy());
    expect(screen.getByText('Budi')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('deletion-pick-1')); // Sari: pending
    expect(screen.queryByTestId('deletion-steps-child')).toBeNull();
  });

  it('explains, needs the acknowledgement, confirms, then deletes the child from this phone', async () => {
    mockParams.scope = 'child';
    await render(wrap(<DeletionScreen />));
    await waitFor(() => expect(list).toHaveBeenCalled());
    await fireEvent.press(screen.getByTestId('deletion-pick-0'));

    expect(screen.getByText(t.explain.heading.child('Budi'))).toBeTruthy();
    for (const line of t.explain.deleted.child) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByText(t.explain.kept.model)).toBeTruthy();
    expect(screen.getByText(t.explain.kept.otherPhonesWithKids)).toBeTruthy();

    // Step 1 refuses without the acknowledgement.
    await fireEvent.press(screen.getByTestId('deletion-next'));
    expect(screen.getByText(t.explain.acknowledgeError)).toBeTruthy();
    expect(screen.queryByTestId('deletion-confirm')).toBeNull();

    await acknowledgeAndConfirm(t.confirm.confirmData);
    await waitFor(() => expect(screen.getByTestId('deletion-done')).toBeTruthy());
    expect(request).toHaveBeenCalledWith({ scope: 'child', childId: CHILD });
    expect(screen.getByText(t.done.child('Budi'))).toBeTruthy();
    expect(useLocalData.getState().kids.map((k) => k.id)).toEqual([CHILD2]);
    expect(useLocalData.getState().syncBlocked[CHILD]).toBe('deletion_pending');

    await fireEvent.press(screen.getByTestId('deletion-finish'));
    expect(back).toHaveBeenCalled();
  });

  it('a failed request shows the reason and keeps the child', async () => {
    mockParams.scope = 'child';
    mockParams.child = CHILD;
    request.mockResolvedValue({ ok: false, code: 'network' });
    await render(wrap(<DeletionScreen />));
    await acknowledgeAndConfirm(t.confirm.confirmData);
    await waitFor(() => expect(screen.getByTestId('deletion-error')).toBeTruthy());
    expect(screen.getByText(t.errors.network)).toBeTruthy();
    expect(useLocalData.getState().kids.map((k) => k.id)).toEqual([CHILD, CHILD2]);
    // Back from the final step keeps the explanation on screen.
    await fireEvent.press(screen.getByTestId('deletion-confirm-cancel'));
    expect(screen.getByTestId('deletion-next')).toBeTruthy();
  });

  it('?child= skips the picker; "Batal" leaves; a pending child only shows its state', async () => {
    mockParams.scope = 'child';
    mockParams.child = CHILD;
    await render(wrap(<DeletionScreen />));
    expect(screen.getByTestId('deletion-steps-child')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('deletion-cancel'));
    expect(back).toHaveBeenCalled();
    await screen.unmount();

    mockParams.child = CHILD2;
    await render(wrap(<DeletionScreen />));
    await waitFor(() => expect(screen.getByTestId('deletion-pending')).toBeTruthy());
    expect(screen.getByText(t.pending.child('Sari'))).toBeTruthy();
  });
});

describe('teen', () => {
  beforeEach(() => {
    signIn(teen);
    setKids([{ id: SELF, nickname: 'Aku', isSelf: true }]);
    list.mockResolvedValue(ok([row({ childId: SELF, isSelf: true })]));
  });

  it('deletes the own profile without a picker; the account stays', async () => {
    mockParams.scope = 'child';
    await render(wrap(<DeletionScreen />));
    expect(screen.getByText(t.explain.heading.self)).toBeTruthy();
    expect(screen.getByText(t.explain.facts.selfKeepsAccount)).toBeTruthy();
    expect(screen.getByText(t.explain.kept.otherPhones)).toBeTruthy();
    await acknowledgeAndConfirm(t.confirm.confirmData);
    await waitFor(() => expect(screen.getByText(t.done.self)).toBeTruthy());
    expect(request).toHaveBeenCalledWith({ scope: 'child', childId: SELF });
    expect(useSession.getState().status).toBe('signedIn');
  });

  it('a pending self deletion only shows its state', async () => {
    list.mockResolvedValue(ok([row({ childId: SELF, isSelf: true, deletionPending: true })]));
    mockParams.scope = 'child';
    await render(wrap(<DeletionScreen />));
    await waitFor(() => expect(screen.getByText(t.pending.self)).toBeTruthy());
  });
});

describe('whole account', () => {
  it('confirms, requests the account deletion, signs out and the welcome screen says why', async () => {
    mockParams.scope = 'account';
    await render(wrap(<DeletionScreen />));
    for (const line of t.explain.deleted.accountGuardian) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByText(t.explain.facts.signOut)).toBeTruthy();
    await acknowledgeAndConfirm(t.confirm.confirmAccount);
    await waitFor(() => expect(useSession.getState().status).toBe('signedOut'));
    expect(request).toHaveBeenCalledWith({ scope: 'account' });
    expect(useDeletionNotice.getState().accountDeleted).toBe(true);
    await screen.unmount();

    await render(wrap(<Welcome />));
    expect(screen.getByTestId('welcome-account-deleted')).toBeTruthy();
    expect(screen.getByText(t.done.account)).toBeTruthy();
    await screen.unmount();
    expect(useDeletionNotice.getState().accountDeleted).toBe(false);
  });

  it('a refused request stays signed in and says so', async () => {
    mockParams.scope = 'account';
    request.mockResolvedValue({ ok: false, code: 'not_deployed' });
    await render(wrap(<DeletionScreen />));
    await acknowledgeAndConfirm(t.confirm.confirmAccount);
    await waitFor(() => expect(screen.getByText(t.errors.not_deployed)).toBeTruthy());
    expect(useSession.getState().status).toBe('signedIn');
  });
});

describe('gating', () => {
  it('child accounts are sent to their parent; guests have nothing on the server', async () => {
    signIn(
      account({
        accountType: 'child',
        roles: ['child'],
        childAccount: { childId: CHILD, guardianId: GUARDIAN, username: 'si.budi', disabled: false, syncAllowed: true, proofAllowed: true },
      }),
    );
    mockParams.scope = 'account';
    await render(wrap(<DeletionScreen />));
    expect(screen.getByTestId('deletion-not-allowed')).toBeTruthy();
    await screen.unmount();

    useSession.setState({ status: 'guest', userId: null, email: null });
    await render(wrap(<DeletionScreen />));
    expect(screen.getByTestId('deletion-guest')).toBeTruthy();
    await act(async () => {});
    expect(request).not.toHaveBeenCalled();
  });
});
