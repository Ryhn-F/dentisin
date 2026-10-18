// Consent screen v2 (src/features/child-accounts/consents-screen.tsx): toggles go through the
// local store with the right text version (guardian vs teen wording), (c) is locked, (d) needs
// the server flag, and withdrawing (b) / (d) asks for confirmation first.
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { useAccount } from '@/core/account/account-store';
import { listChildren } from '@/core/account/api';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import { DEFAULT_LIMITS, consentTextVersions, type MyAccount } from '@/domain/models';
import { ConsentsScreen } from '@/features/child-accounts/consents-screen';

jest.mock('@/core/auth/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { refreshSession: jest.fn(), signOut: jest.fn(), getSession: jest.fn(), onAuthStateChange: jest.fn() },
  },
}));
jest.mock('@/core/account/api', () => ({
  ...jest.requireActual('@/core/account/api'),
  listChildren: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() }, Stack: { Screen: () => null } }));


const USER = '0b0b0b0b-0000-4000-8000-000000000001';
const KID = 'c0c0c0c0-0000-4000-8000-000000000001';
const KID2 = 'c0c0c0c0-0000-4000-8000-000000000002';
const SELF = 'c0c0c0c0-0000-4000-8000-0000000000ff';
const t = id.consentsV2;

function account(over: Partial<MyAccount> = {}): MyAccount {
  return {
    userId: USER,
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

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
async function renderScreen() {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ConsentsScreen />
    </SafeAreaProvider>,
  );
}

function sw(type: string) {
  return screen.getByTestId(`consent-${type}-switch`);
}
function rec(childId: string, type: 'a' | 'b' | 'c' | 'd') {
  return useLocalData.getState().consentRecords[childId]?.[type];
}

beforeEach(() => {
  (listChildren as jest.Mock).mockReset().mockResolvedValue({ ok: true, data: [] });
  useSession.setState({ status: 'signedIn', userId: USER, email: 'ortu@contoh.com' });
  useAccount.setState({ userId: USER, me: account(), status: 'ready', lastError: null });
  useLocalData.setState({
    scope: null,
    ready: true,
    kids: [
      { id: KID, nickname: 'Budi', birthYear: 2016, birthMonth: 3, allergies: [] },
      { id: KID2, nickname: '', birthYear: 2018, birthMonth: 1, allergies: [] },
    ],
    activeChildId: KID,
    consentRecords: {},
    consents: {},
    unsyncedChildren: [],
    syncBlocked: {},
  });
});

describe('guardian', () => {
  it('starts every consent off and shows a card per type incl. (d) with the flag', async () => {
    await renderScreen();
    for (const type of ['a', 'b', 'c', 'd']) expect(screen.getByTestId(`consent-${type}`)).toBeTruthy();
    for (const type of ['a', 'b', 'c', 'd']) {
      expect(sw(type).props.accessibilityState?.checked ?? sw(type).props['aria-checked']).toBeFalsy();
    }
    expect(screen.getByText(id.consentsV2.guardian.a.title)).toBeTruthy();
  });

  it('hides (d) while the brushing_proof_video flag is off', async () => {
    useAccount.setState({ me: account({ flags: { brushingProofVideo: false } }) });
    await renderScreen();
    expect(screen.queryByTestId('consent-d')).toBeNull();
    expect(screen.getByTestId('consent-c')).toBeTruthy();
  });

  it('records each grant with the guardian text version', async () => {
    await renderScreen();
    await fireEvent.press(sw('a'));
    await fireEvent.press(sw('b'));
    await fireEvent.press(sw('d'));
    expect(rec(KID, 'a')?.value).toBe(true);
    expect(rec(KID, 'a')?.textVersion).toBe(consentTextVersions.guardian.a);
    expect(rec(KID, 'b')?.textVersion).toBe(consentTextVersions.guardian.b);
    expect(rec(KID, 'd')?.textVersion).toBe(consentTextVersions.guardian.d);
    expect(useLocalData.getState().consents[KID]).toEqual({ a: true, b: true, c: false, d: true });
  });

  it('locks (c) as not active yet', async () => {
    await renderScreen();
    expect(sw('c').props.accessibilityState?.disabled ?? sw('c').props['aria-disabled']).toBe(true);
    expect(screen.getByText(t.statusNotActive)).toBeTruthy();
    await fireEvent.press(sw('c'));
    expect(rec(KID, 'c')).toBeUndefined();
  });

  it('keeps (d) locked until (b) is on and says why', async () => {
    await renderScreen();
    expect(sw('d').props.accessibilityState?.disabled ?? sw('d').props['aria-disabled']).toBe(true);
    expect(screen.getByText(t.dNeedsB)).toBeTruthy();
    await fireEvent.press(sw('d'));
    expect(rec(KID, 'd')).toBeUndefined();
  });

  it('asks before withdrawing (b), warns that syncing stops, and withdraws only after yes', async () => {
    useLocalData.getState().setConsent(KID, 'b', true);
    await renderScreen();
    await fireEvent.press(sw('b'));
    expect(screen.getByText(t.withdrawB.title)).toBeTruthy();
    expect(screen.getByText(t.withdrawB.message)).toBeTruthy();
    expect(rec(KID, 'b')?.value).toBe(true);

    await fireEvent.press(screen.getByTestId('consent-withdraw-confirm-cancel'));
    expect(screen.queryByText(t.withdrawB.title)).toBeNull();
    expect(rec(KID, 'b')?.value).toBe(true);

    await fireEvent.press(sw('b'));
    await fireEvent.press(screen.getByTestId('consent-withdraw-confirm-confirm'));
    expect(rec(KID, 'b')?.value).toBe(false);
  });

  it('warns that videos are hidden at once and deleted within 24 hours when withdrawing (d)', async () => {
    useLocalData.getState().setConsent(KID, 'b', true);
    useLocalData.getState().setConsent(KID, 'd', true);
    await renderScreen();
    await fireEvent.press(sw('d'));
    expect(screen.getByText(t.withdrawD.message)).toBeTruthy();
    expect(t.withdrawD.message).toMatch(/24 jam/);
    await fireEvent.press(screen.getByTestId('consent-withdraw-confirm-confirm'));
    expect(rec(KID, 'd')?.value).toBe(false);
  });

  it('withdraws (a) straight away', async () => {
    useLocalData.getState().setConsent(KID, 'a', true);
    await renderScreen();
    await fireEvent.press(sw('a'));
    expect(rec(KID, 'a')?.value).toBe(false);
    expect(screen.queryByTestId('consent-withdraw-confirm')).toBeNull();
  });

  it('switches between children and names a server-only child with a fallback', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId(`child-chip-${KID2}`));
    await waitFor(() => expect(useLocalData.getState().activeChildId).toBe(KID2));
    expect(screen.getAllByText(id.childAccounts.list.fallbackName(2), { exact: false }).length).toBeGreaterThan(1);
    await fireEvent.press(sw('a'));
    expect(rec(KID2, 'a')?.value).toBe(true);
    expect(rec(KID, 'a')).toBeUndefined();
  });

  it('tells about a pending sync after a change while signed in', async () => {
    await renderScreen();
    await fireEvent.press(sw('a'));
    expect(screen.getByText(t.pendingSync)).toBeTruthy();
  });

  it('explains that guest choices stay on the phone', async () => {
    useSession.setState({ status: 'guest', userId: null, email: null });
    useAccount.setState({ me: null, userId: null });
    await renderScreen();
    expect(screen.getByTestId('consents-guest-note')).toBeTruthy();
    expect(screen.queryByTestId('consent-d')).toBeNull();
  });
});

describe('teen', () => {
  beforeEach(() => {
    useAccount.setState({
      me: account({
        accountType: 'teen',
        selfChildId: SELF,
        childAccounts: null,
        capabilities: { createChildAccounts: false, registerProofs: true },
      }),
    });
    useLocalData.setState({
      kids: [
        { id: SELF, nickname: '', birthYear: 2009, birthMonth: 5, allergies: [], isSelf: true },
        { id: KID, nickname: 'Budi', birthYear: 2016, birthMonth: 3, allergies: [] },
      ],
      activeChildId: SELF,
    });
  });

  it('shows only the own profile, with the first-person texts', async () => {
    await renderScreen();
    expect(screen.queryByTestId(`child-chip-${KID}`)).toBeNull();
    expect(screen.getByText(t.introSelf)).toBeTruthy();
    expect(screen.getByText(t.teen.d.title)).toBeTruthy();
    expect(screen.queryByText(t.guardian.d.title)).toBeNull();
  });

  it('records grants with the teen text versions', async () => {
    await renderScreen();
    await fireEvent.press(sw('a'));
    await fireEvent.press(sw('b'));
    await fireEvent.press(sw('d'));
    expect(rec(SELF, 'a')?.textVersion).toBe(consentTextVersions.teen.a);
    expect(rec(SELF, 'b')?.textVersion).toBe(consentTextVersions.teen.b);
    expect(rec(SELF, 'd')?.textVersion).toBe(consentTextVersions.teen.d);
    expect(rec(KID, 'a')).toBeUndefined();
  });
});
