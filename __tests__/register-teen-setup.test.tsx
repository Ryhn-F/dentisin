// Teen first-run setup (src/features/auth/teen-setup-screen.tsx): birth prefill, teen consents
// (all off, (d) behind the flag and (b)), ensure_self_profile with the returned id, errors.
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { useAccount } from '@/core/account/account-store';
import { ensureSelfProfile } from '@/core/account/api';
import { clearPendingTeenBirth, getPendingTeenBirth } from '@/core/auth/auth-service';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import { DEFAULT_LIMITS, consentTextVersions, type MyAccount } from '@/domain/models';
import { TeenSetupScreen } from '@/features/auth/teen-setup-screen';

jest.mock('@/core/account/api', () => ({ ...jest.requireActual('@/core/account/api'), ensureSelfProfile: jest.fn() }));
jest.mock('@/core/auth/auth-service', () => ({
  getPendingTeenBirth: jest.fn(),
  clearPendingTeenBirth: jest.fn(),
}));
jest.mock('@/core/auth/supabase', () => ({ supabase: null }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() }, useFocusEffect: jest.fn() }));

const NOW = new Date('2026-10-18T05:00:00Z');
const USER = '0b0b0b0b-0000-4000-8000-000000000001';
const SERVER_CHILD = 'c0c0c0c0-0000-4000-8000-0000000000aa';
const t = id.teenSetup;

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
async function renderScreen() {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <TeenSetupScreen now={NOW} />
    </SafeAreaProvider>,
  );
}

function teenAccount(videoFlag: boolean, selfChildId: string | null = null): MyAccount {
  return {
    userId: USER,
    accountType: 'teen',
    roles: ['guardian'],
    selfChildId,
    childAccounts: null,
    childAccount: null,
    flags: { brushingProofVideo: videoFlag },
    capabilities: { createChildAccounts: false, registerProofs: videoFlag },
    limits: DEFAULT_LIMITS,
  };
}

const ensure = ensureSelfProfile as jest.Mock;
const refresh = jest.fn();

function switchOf(testId: string) {
  return screen.getByTestId(`${testId}-switch`);
}
function isOn(testId: string): boolean {
  return switchOf(testId).props.accessibilityState?.checked === true || switchOf(testId).props['aria-checked'] === true;
}
function submitDisabled(): boolean {
  return screen.getByTestId('teen-setup-submit').props.accessibilityState?.disabled === true;
}

beforeEach(() => {
  ensure.mockReset();
  // Like the real refresh after ensure_self_profile: my_account() now has the self profile.
  refresh.mockReset().mockImplementation(async () => {
    useAccount.setState({ me: teenAccount(useAccount.getState().me?.flags.brushingProofVideo ?? true, SERVER_CHILD) });
  });
  (getPendingTeenBirth as jest.Mock).mockReset().mockResolvedValue({ year: 2009, month: 5 });
  (clearPendingTeenBirth as jest.Mock).mockReset().mockResolvedValue(undefined);
  useAccount.setState({ userId: USER, me: teenAccount(true), status: 'ready', lastError: null, refresh });
  useLocalData.setState({
    scope: null,
    kids: [],
    activeChildId: null,
    consentRecords: {},
    consents: {},
    unsyncedChildren: [],
  });
});

describe('TeenSetupScreen', () => {
  it('prefills the birth from sign-up and shows all consents off', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('teen-birth-year-2009').props.accessibilityState?.selected).toBe(true));
    expect(screen.getByTestId('teen-birth-month-5').props.accessibilityState?.selected).toBe(true);
    expect(isOn('teen-consent-a')).toBe(false);
    expect(isOn('teen-consent-b')).toBe(false);
    expect(isOn('teen-consent-d')).toBe(false);
    // Photo upload (c) is not offered.
    expect(screen.queryByTestId('teen-consent-c')).toBeNull();
    expect(screen.getByTestId('teen-setup-signout')).toBeTruthy();
  });

  it('hides the video consent while the server flag is off', async () => {
    useAccount.setState({ me: teenAccount(false) });
    await renderScreen();
    expect(screen.queryByTestId('teen-consent-d')).toBeNull();
    expect(screen.getByTestId('teen-consent-a')).toBeTruthy();
  });

  it('keeps the submit button off until the age fits', async () => {
    (getPendingTeenBirth as jest.Mock).mockResolvedValue(null);
    await renderScreen();
    expect(submitDisabled()).toBe(true);
    await fireEvent.press(screen.getByTestId('teen-birth-year-2013'));
    expect(screen.getByTestId('teen-age-gate-too-young')).toBeTruthy();
    expect(submitDisabled()).toBe(true);
    await fireEvent.press(screen.getByTestId('teen-birth-year-2009'));
    expect(screen.queryByTestId('teen-age-gate-too-young')).toBeNull();
    expect(submitDisabled()).toBe(false);
  });

  it('turns the video consent off again when technical data (b) is withdrawn', async () => {
    await renderScreen();
    await fireEvent.press(switchOf('teen-consent-b'));
    await fireEvent.press(switchOf('teen-consent-d'));
    expect(isOn('teen-consent-d')).toBe(true);
    await fireEvent.press(switchOf('teen-consent-b'));
    expect(isOn('teen-consent-b')).toBe(false);
    expect(isOn('teen-consent-d')).toBe(false);
  });

  it('turning on video (d) never turns on technical data (b): (d) stays locked until (b) is on', async () => {
    await renderScreen();
    const dDisabled = () => switchOf('teen-consent-d').props.accessibilityState?.disabled ?? switchOf('teen-consent-d').props['aria-disabled'];
    expect(dDisabled()).toBe(true);
    await fireEvent.press(switchOf('teen-consent-d'));
    expect(isOn('teen-consent-d')).toBe(false);
    expect(isOn('teen-consent-b')).toBe(false);
    expect(screen.getByText(t.consents.needsB)).toBeTruthy();

    await fireEvent.press(switchOf('teen-consent-b'));
    expect(dDisabled()).toBeFalsy();
    expect(screen.queryByText(t.consents.needsB)).toBeNull();
  });

  it('shows the same teen texts as the consents screen (one text_version, one wording)', async () => {
    await renderScreen();
    for (const type of ['a', 'b', 'd'] as const) {
      expect(screen.getByText(id.consentsV2.teen[type].title)).toBeTruthy();
      expect(screen.getByText(id.consentsV2.teen[type].what)).toBeTruthy();
    }
    expect(screen.getByText(id.consentsV2.teen.d.howLong)).toBeTruthy();
  });

  it('profile created but my_account() not readable: error with retry instead of silence', async () => {
    ensure.mockResolvedValue({ ok: true, data: SERVER_CHILD });
    refresh.mockImplementationOnce(async () => {
      useAccount.setState({ status: 'ready', lastError: 'network' });
    });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('teen-birth-year-2009').props.accessibilityState?.selected).toBe(true));
    await fireEvent.press(screen.getByTestId('teen-setup-submit'));
    await waitFor(() => expect(screen.getByText(t.errors.refreshFailed)).toBeTruthy());
    expect(useLocalData.getState().kids[0]?.id).toBe(SERVER_CHILD);

    await fireEvent.press(screen.getByTestId('teen-setup-retry'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(ensure.mock.calls[1][0]).toBe(ensure.mock.calls[0][0]);
    await waitFor(() => expect(screen.queryByTestId('teen-setup-error')).toBeNull());
  });

  it('happy path: server id, local self profile, teen consents, clear pending, refresh', async () => {
    ensure.mockResolvedValue({ ok: true, data: SERVER_CHILD });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('teen-birth-year-2009').props.accessibilityState?.selected).toBe(true));
    await fireEvent.press(switchOf('teen-consent-a'));
    await fireEvent.press(switchOf('teen-consent-b'));
    await fireEvent.press(switchOf('teen-consent-d'));
    await fireEvent.press(screen.getByTestId('teen-setup-submit'));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [clientId, year, month] = ensure.mock.calls[0];
    expect(clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect([year, month]).toEqual([2009, 5]);

    const local = useLocalData.getState();
    // The id the server returned wins over the client's.
    expect(local.kids).toHaveLength(1);
    expect(local.kids[0]).toMatchObject({ id: SERVER_CHILD, isSelf: true, nickname: t.selfNickname, birthYear: 2009, birthMonth: 5 });
    expect(local.activeChildId).toBe(SERVER_CHILD);
    const records = local.consentRecords[SERVER_CHILD];
    expect(records?.a).toMatchObject({ value: true, textVersion: consentTextVersions.teen.a });
    expect(records?.b).toMatchObject({ value: true, textVersion: consentTextVersions.teen.b });
    expect(records?.d).toMatchObject({ value: true, textVersion: consentTextVersions.teen.d });
    expect(records?.c).toBeUndefined();
    expect(clearPendingTeenBirth).toHaveBeenCalled();
  });

  it('records no consent when everything stays off', async () => {
    ensure.mockResolvedValue({ ok: true, data: SERVER_CHILD });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('teen-birth-year-2009').props.accessibilityState?.selected).toBe(true));
    await fireEvent.press(screen.getByTestId('teen-setup-submit'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(useLocalData.getState().kids[0]?.id).toBe(SERVER_CHILD);
    expect(useLocalData.getState().consentRecords[SERVER_CHILD]).toBeUndefined();
  });

  it('age_out_of_range: shows the fix-the-year message and creates nothing locally', async () => {
    ensure.mockResolvedValue({ ok: false, code: 'age_out_of_range' });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('teen-birth-year-2009').props.accessibilityState?.selected).toBe(true));
    await fireEvent.press(screen.getByTestId('teen-setup-submit'));
    await waitFor(() => expect(screen.getByTestId('teen-setup-error')).toBeTruthy());
    expect(screen.getByText(t.errors.ageOutOfRange(15, 19))).toBeTruthy();
    expect(screen.getByTestId('teen-setup-signout')).toBeTruthy();
    expect(useLocalData.getState().kids).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
    expect(clearPendingTeenBirth).not.toHaveBeenCalled();
    // The year can be corrected and the error goes away.
    await fireEvent.press(screen.getByTestId('teen-birth-year-2010'));
    expect(screen.queryByTestId('teen-setup-error')).toBeNull();
  });

  it('network: retry banner reuses the same client id', async () => {
    ensure.mockResolvedValueOnce({ ok: false, code: 'network' }).mockResolvedValueOnce({ ok: true, data: SERVER_CHILD });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('teen-birth-year-2009').props.accessibilityState?.selected).toBe(true));
    await fireEvent.press(screen.getByTestId('teen-setup-submit'));
    await waitFor(() => expect(screen.getByText(t.errors.network)).toBeTruthy());
    await fireEvent.press(screen.getByTestId('teen-setup-retry'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(ensure.mock.calls[1][0]).toBe(ensure.mock.calls[0][0]);
    expect(screen.queryByTestId('teen-setup-error')).toBeNull();
  });

  it('not_deployed: friendly message, no retry loop', async () => {
    ensure.mockResolvedValue({ ok: false, code: 'not_deployed' });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('teen-birth-year-2009').props.accessibilityState?.selected).toBe(true));
    await fireEvent.press(screen.getByTestId('teen-setup-submit'));
    await waitFor(() => expect(screen.getByText(t.errors.notDeployed)).toBeTruthy());
    expect(screen.queryByTestId('teen-setup-retry')).toBeNull();
  });

  it('offers sign out', async () => {
    const signOut = jest.fn().mockResolvedValue(undefined);
    useSession.setState({ signOut });
    await renderScreen();
    await fireEvent.press(screen.getByTestId('teen-setup-signout'));
    expect(signOut).toHaveBeenCalled();
  });
});
