// ChildAccountScreen (src/features/child-accounts): gating, the "child is on the server"
// prerequisite, the create form (validation, error mapping, one-time card), and managing an
// existing login (reset, disable, delete with confirmation). API calls are mocked.
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { useAccount } from '@/core/account/account-store';
import { childAccounts, listChildren } from '@/core/account/api';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import { DEFAULT_LIMITS, consentTextVersions, type ChildSummary, type MyAccount } from '@/domain/models';
import { ChildAccountScreen } from '@/features/child-accounts/child-account-screen';

jest.mock('@/core/auth/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { refreshSession: jest.fn(), signOut: jest.fn(), getSession: jest.fn(), onAuthStateChange: jest.fn() },
  },
}));
jest.mock('@/core/account/api', () => ({
  ...jest.requireActual('@/core/account/api'),
  listChildren: jest.fn(),
  childAccounts: { create: jest.fn(), resetPassword: jest.fn(), setDisabled: jest.fn(), remove: jest.fn() },
}));
jest.mock('expo-router', () => {
  const mockReact = jest.requireActual('react');
  return {
    router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
    Stack: { Screen: () => null },
    useLocalSearchParams: () => ({ id: 'c0c0c0c0-0000-4000-8000-000000000001' }),
    useFocusEffect: (cb: () => void) => mockReact.useEffect(cb, [cb]),
  };
});

const GUARDIAN = '0b0b0b0b-0000-4000-8000-000000000001';
const CHILD = 'c0c0c0c0-0000-4000-8000-000000000001';
const refreshSession = (jest.requireMock('@/core/auth/supabase') as { supabase: { auth: { refreshSession: jest.Mock } } }).supabase
  .auth.refreshSession;
const list = listChildren as jest.Mock;
const create = childAccounts.create as jest.Mock;
const resetPassword = childAccounts.resetPassword as jest.Mock;
const setDisabled = childAccounts.setDisabled as jest.Mock;
const remove = childAccounts.remove as jest.Mock;
const t = id.childAccounts;

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

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
async function renderScreen() {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ChildAccountScreen />
    </SafeAreaProvider>,
  );
}

function ok<T>(data: T) {
  return { ok: true as const, data };
}

beforeEach(() => {
  jest.clearAllMocks();
  list.mockReset().mockResolvedValue(ok([row()]));
  create.mockReset();
  resetPassword.mockReset();
  setDisabled.mockReset();
  remove.mockReset();
  refreshSession.mockReset().mockResolvedValue({ data: { session: {} }, error: null });
  useSession.setState({ status: 'signedIn', userId: GUARDIAN, email: 'ortu@contoh.com' });
  useAccount.setState({ userId: GUARDIAN, me: account(), status: 'ready', lastError: null });
  useLocalData.setState({
    scope: null,
    ready: true,
    kids: [{ id: CHILD, nickname: 'Budi', birthYear: 2016, birthMonth: 3, allergies: [] }],
    activeChildId: CHILD,
    consentRecords: { [CHILD]: { b: { value: true, textVersion: consentTextVersions.guardian.b, at: '2026-10-18T00:00:00Z', synced: true } } },
    consents: {},
    unsyncedChildren: [],
    syncBlocked: {},
  });
});

async function fillCreate(username: string, password: string, confirm = password) {
  await fireEvent.changeText(screen.getByTestId('create-username'), username);
  await fireEvent.changeText(screen.getByTestId('create-password'), password);
  await fireEvent.changeText(screen.getByTestId('create-confirm'), confirm);
}

describe('gating', () => {
  it('says "belum tersedia" on a legacy backend instead of crashing', async () => {
    useAccount.setState({ me: { ...account({ capabilities: { createChildAccounts: false, registerProofs: false } }), legacy: true } });
    await renderScreen();
    expect(screen.getByText(t.screen.unavailableTitle)).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
  });

  it('says "belum tersedia" when list_children is not deployed', async () => {
    list.mockResolvedValue({ ok: false, code: 'not_deployed' });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('child-account-unavailable')).toBeTruthy());
  });

  it('asks guests to sign in and refuses teens', async () => {
    useSession.setState({ status: 'guest', userId: null, email: null });
    await renderScreen();
    expect(screen.getByTestId('child-account-guest')).toBeTruthy();
  });

  it('refuses a teen account', async () => {
    useAccount.setState({ me: account({ accountType: 'teen', capabilities: { createChildAccounts: false, registerProofs: true } }) });
    await renderScreen();
    expect(screen.getByTestId('child-account-not-allowed')).toBeTruthy();
  });

  it('offers a retry when the status cannot be loaded', async () => {
    list.mockResolvedValue({ ok: false, code: 'network' });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('child-account-load-failed')).toBeTruthy());
    expect(screen.getByText(t.screen.offlineNote)).toBeTruthy();
  });
});

describe('prerequisite', () => {
  it('asks for consent (b) first and records the guardian text version', async () => {
    list.mockResolvedValue(ok([]));
    useLocalData.setState({ consentRecords: {} });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('prerequisite-step')).toBeTruthy());
    expect(screen.queryByTestId('create-account-form')).toBeNull();
    await fireEvent.press(screen.getByTestId('prerequisite-consent-b-switch'));
    const rec = useLocalData.getState().consentRecords[CHILD]?.b;
    expect(rec?.value).toBe(true);
    expect(rec?.textVersion).toBe(consentTextVersions.guardian.b);
  });

  it('waits while the grant is not applied, then opens the form', async () => {
    list.mockResolvedValue(ok([]));
    useLocalData.setState({
      consentRecords: { [CHILD]: { b: { value: true, textVersion: consentTextVersions.guardian.b, at: '2026-10-18T00:00:00Z', synced: false } } },
    });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('prerequisite-waiting')).toBeTruthy());
    expect(screen.queryByTestId('create-account-form')).toBeNull();
    await act(async () => {
      useLocalData.getState().markConsentSynced(CHILD, 'b');
    });
    await waitFor(() => expect(screen.getByTestId('create-account-form')).toBeTruthy());
  });

  it('opens the form when list_children already has the child', async () => {
    useLocalData.setState({ consentRecords: {} });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('create-account-form')).toBeTruthy());
  });
});

describe('create form', () => {
  it('shows the "jangan nama asli" warning and the username rules', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('create-account-form')).toBeTruthy());
    expect(screen.getByText(t.create.nameWarningTitle)).toBeTruthy();
    for (const rule of t.create.usernameRules) expect(screen.getByText(`• ${rule}`)).toBeTruthy();
  });

  it('validates locally and does not call the server', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('create-account-form')).toBeTruthy());
    await fillCreate('x', 'abc', 'abd');
    await fireEvent.press(screen.getByTestId('create-submit'));
    expect(screen.getByText(t.usernameErrors.too_short)).toBeTruthy();
    expect(screen.getByText(t.fieldErrors.passwordWeak)).toBeTruthy();
    expect(screen.getByText(t.fieldErrors.confirmMismatch)).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates the account, shows the one-time sign-in card and never echoes the password', async () => {
    create.mockResolvedValue(ok({ childId: CHILD, username: 'si.budi' }));
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('create-account-form')).toBeTruthy());
    await fillCreate('  Si.Budi ', 'Rahasia123');
    await fireEvent.press(screen.getByTestId('create-submit'));
    await waitFor(() => expect(screen.getByTestId('created-card')).toBeTruthy());
    expect(create).toHaveBeenCalledWith({ childId: CHILD, username: 'si.budi', password: 'Rahasia123' });
    expect(screen.getByTestId('created-email').props.children).toBe('ortu@contoh.com');
    expect(screen.getByTestId('created-username').props.children).toBe('si.budi');
    expect(screen.queryByText('Rahasia123')).toBeNull();
    expect(screen.getByText(t.created.oneTime)).toBeTruthy();
    // Consent (d) was not switched on.
    expect(useLocalData.getState().consentRecords[CHILD]?.d).toBeUndefined();
  });

  it('records consent (d) with the guardian text only after the account exists', async () => {
    create.mockResolvedValue(ok({ childId: CHILD, username: 'si.budi' }));
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('create-video')).toBeTruthy());
    // The full text of that version is shown: where it is stored, who sees it, how long,
    // withdrawal and what declining means.
    const dCopy = id.consentsV2.guardian.d;
    for (const text of [dCopy.title, dCopy.what, dCopy.why, dCopy.where, dCopy.who, dCopy.howLong, dCopy.withdraw, dCopy.ifDeclined]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    await fireEvent.press(screen.getByTestId('create-video-switch'));
    await fillCreate('si.budi', 'Rahasia123');
    await fireEvent.press(screen.getByTestId('create-submit'));
    await waitFor(() => expect(screen.getByTestId('created-card')).toBeTruthy());
    const d = useLocalData.getState().consentRecords[CHILD]?.d;
    expect(d?.value).toBe(true);
    expect(d?.textVersion).toBe(consentTextVersions.guardian.d);
  });

  it('does not offer the video choice when the flag is off', async () => {
    useAccount.setState({ me: account({ flags: { brushingProofVideo: false } }) });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('create-account-form')).toBeTruthy());
    expect(screen.queryByTestId('create-video')).toBeNull();
  });

  it('leaves consent (d) alone when creating fails', async () => {
    create.mockResolvedValue({ ok: false, code: 'child_account_limit' });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('create-video')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('create-video-switch'));
    await fillCreate('si.budi', 'Rahasia123');
    await fireEvent.press(screen.getByTestId('create-submit'));
    await waitFor(() => expect(screen.getByText(t.errors.child_account_limit)).toBeTruthy());
    expect(useLocalData.getState().consentRecords[CHILD]?.d).toBeUndefined();
  });

  it('puts username_taken under the username field', async () => {
    create.mockResolvedValue({ ok: false, code: 'username_taken' });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('create-account-form')).toBeTruthy());
    await fillCreate('si.budi', 'Rahasia123');
    await fireEvent.press(screen.getByTestId('create-submit'));
    await waitFor(() => expect(screen.getByText(t.errors.username_taken)).toBeTruthy());
    expect(screen.queryByTestId('created-card')).toBeNull();
  });

  it('maps child_not_found to the "belum tersinkron" copy and re-checks', async () => {
    create.mockResolvedValue({ ok: false, code: 'child_not_found' });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('create-account-form')).toBeTruthy());
    const before = list.mock.calls.length;
    await fillCreate('si.budi', 'Rahasia123');
    await fireEvent.press(screen.getByTestId('create-submit'));
    await waitFor(() => expect(screen.getByText(t.errors.child_not_found)).toBeTruthy());
    expect(list.mock.calls.length).toBeGreaterThan(before);
  });

  it('refreshes the session once on unauthorized, then retries', async () => {
    create
      .mockResolvedValueOnce({ ok: false, code: 'unauthorized' })
      .mockResolvedValueOnce(ok({ childId: CHILD, username: 'si.budi' }));
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('create-account-form')).toBeTruthy());
    await fillCreate('si.budi', 'Rahasia123');
    await fireEvent.press(screen.getByTestId('create-submit'));
    await waitFor(() => expect(screen.getByTestId('created-card')).toBeTruthy());
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('shows the sign-in message when the refresh does not help', async () => {
    create.mockResolvedValue({ ok: false, code: 'unauthorized' });
    refreshSession.mockResolvedValue({ data: { session: null }, error: { message: 'expired' } });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('create-account-form')).toBeTruthy());
    await fillCreate('si.budi', 'Rahasia123');
    await fireEvent.press(screen.getByTestId('create-submit'));
    await waitFor(() => expect(screen.getByText(t.errors.unauthorized)).toBeTruthy());
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('existing account', () => {
  beforeEach(() => {
    list.mockResolvedValue(ok([row({ hasChildAccount: true, childAccountDisabled: false, username: 'si.budi' })]));
  });

  it('shows the username and status', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('manage-account')).toBeTruthy());
    expect(screen.getByTestId('manage-username').props.children).toBe('si.budi');
    expect(screen.getByTestId('manage-status').props.children).toBe(t.manage.statusActive);
  });

  it('disables the login through the function and reloads the status', async () => {
    setDisabled.mockResolvedValue(ok({ disabled: true }));
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('manage-account')).toBeTruthy());
    list.mockResolvedValue(ok([row({ hasChildAccount: true, childAccountDisabled: true, username: 'si.budi' })]));
    await fireEvent.press(screen.getByTestId('manage-active-switch'));
    await waitFor(() => expect(setDisabled).toHaveBeenCalledWith({ childId: CHILD, disabled: true }));
    await waitFor(() => expect(screen.getByTestId('manage-status').props.children).toBe(t.manage.statusDisabled));
    expect(screen.getByText(t.manage.disabledDone)).toBeTruthy();
  });

  it('resets the password only with a valid, confirmed password', async () => {
    resetPassword.mockResolvedValue(ok(true));
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('manage-account')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('reset-open'));
    await fireEvent.changeText(screen.getByTestId('reset-password'), 'abc');
    await fireEvent.changeText(screen.getByTestId('reset-confirm'), 'abd');
    await fireEvent.press(screen.getByTestId('reset-submit'));
    expect(resetPassword).not.toHaveBeenCalled();
    expect(screen.getByText(t.fieldErrors.passwordWeak)).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('reset-password'), 'Baru12345');
    await fireEvent.changeText(screen.getByTestId('reset-confirm'), 'Baru12345');
    await fireEvent.press(screen.getByTestId('reset-submit'));
    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith({ childId: CHILD, password: 'Baru12345' }));
    await waitFor(() => expect(screen.getByText(t.manage.resetDone)).toBeTruthy());
    expect(screen.queryByTestId('reset-form')).toBeNull();
  });

  it('asks for confirmation before deleting the login and keeps it on cancel', async () => {
    remove.mockResolvedValue(ok(true));
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('manage-account')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('delete-open'));
    expect(screen.getByText(t.manage.deleteConfirmTitle)).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('delete-confirm-cancel'));
    expect(screen.queryByText(t.manage.deleteConfirmTitle)).toBeNull();
    expect(remove).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('delete-open'));
    list.mockResolvedValue(ok([row()]));
    await fireEvent.press(screen.getByTestId('delete-confirm-confirm'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ childId: CHILD }));
    // The status is reloaded: no login any more, so the create form comes back.
    await waitFor(() => expect(screen.getByTestId('create-account-form')).toBeTruthy());
  });

  it('shows a friendly message when a call fails', async () => {
    setDisabled.mockResolvedValue({ ok: false, code: 'network' });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('manage-account')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('manage-active-switch'));
    await waitFor(() => expect(screen.getByText(t.errors.network)).toBeTruthy());
  });

  it('does not offer actions while the child is being deleted', async () => {
    list.mockResolvedValue(ok([row({ hasChildAccount: true, childAccountDisabled: false, username: 'si.budi', deletionPending: true })]));
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('child-account-deleting')).toBeTruthy());
    expect(screen.queryByTestId('manage-account')).toBeNull();
  });
});
