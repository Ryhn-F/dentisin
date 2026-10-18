// Screening tab (request params, teen subject) and the result screen's sync line.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import Screening from '@/app/(tabs)/screening';
import Result from '@/app/screening/result';
import { useAccount } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import { DEFAULT_LIMITS, type ChildProfile, type MyAccount } from '@/domain/models';
import { triageRules, type Answer } from '@/domain/triage';
import { useScreeningSession } from '@/features/screening/session-store';

const mockParams: { current: Record<string, string | undefined> } = { current: {} };
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => mockParams.current,
  useFocusEffect: jest.fn(),
}));
jest.mock('@/core/flags', () => ({
  ...jest.requireActual('@/core/flags'),
  flags: { medical_modules: true, dataset_contribution: false },
}));
jest.mock('@/core/auth/supabase', () => ({
  supabase: { rpc: jest.fn(), auth: { refreshSession: jest.fn(), signOut: jest.fn(), getSession: jest.fn(), onAuthStateChange: jest.fn() } },
}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));

const GUARDIAN = '0b0b0b0b-0000-4000-8000-000000000001';
const TEEN = '0b0b0b0b-0000-4000-8000-000000000002';
const CHILD = 'c0c0c0c0-0000-4000-8000-000000000001';
const CHILD2 = 'c0c0c0c0-0000-4000-8000-000000000002';
const SELF = 'c0c0c0c0-0000-4000-8000-0000000000ff';
const REQUEST = '77777777-7777-4777-8777-777777777701';
const ts = id.screeningSync;

function account(over: Partial<MyAccount>): MyAccount {
  return {
    userId: GUARDIAN,
    accountType: 'guardian',
    roles: ['guardian'],
    selfChildId: null,
    childAccounts: 0,
    childAccount: null,
    flags: { brushingProofVideo: false },
    capabilities: { createChildAccounts: true, registerProofs: false },
    limits: DEFAULT_LIMITS,
    ...over,
  };
}

const kid = (id: string, nickname: string, extra: Partial<ChildProfile> = {}): ChildProfile => ({
  id,
  nickname,
  birthYear: 2018,
  birthMonth: 3,
  allergies: [],
  ...extra,
});

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const wrap = (ui: React.ReactElement) => <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>;

function as(me: MyAccount | null, status: 'signedIn' | 'guest' = 'signedIn') {
  useSession.setState({ status, userId: me?.userId ?? null, email: null });
  useAccount.setState({ userId: me?.userId ?? null, me, status: me ? 'ready' : 'idle', lastError: null });
}

beforeEach(() => {
  mockParams.current = {};
  useLocalData.setState({ kids: [], activeChildId: null, screenings: [], referrals: [], consentRecords: {}, consents: {} });
  useScreeningSession.getState().reset();
});

describe('screening tab', () => {
  it('preselects the request child, shows the banner and carries the request id', async () => {
    as(account({}));
    useLocalData.setState({ kids: [kid(CHILD, 'Adik'), kid(CHILD2, '')], activeChildId: CHILD2 });
    mockParams.current = { child: CHILD, request: REQUEST };
    await render(wrap(<Screening />));
    expect(useLocalData.getState().activeChildId).toBe(CHILD);
    expect(screen.getByText(ts.request.title('Adik'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('screening-start'));
    expect(useScreeningSession.getState()).toMatchObject({ child: { id: CHILD }, requestId: REQUEST });
  });

  it('drops the request when another child is chosen, and labels unnamed children', async () => {
    as(account({}));
    useLocalData.setState({ kids: [kid(CHILD, 'Adik'), kid(CHILD2, '')], activeChildId: CHILD });
    mockParams.current = { child: CHILD, request: REQUEST };
    await render(wrap(<Screening />));
    await act(async () => useLocalData.getState().setActiveChild(CHILD2));
    expect(screen.queryByTestId('screening-request-banner')).toBeNull();
    expect(screen.getByTestId('screening-start')).toHaveTextContent(id.screening.startFor(ts.childFallback(1)), { exact: false });
    await fireEvent.press(screen.getByTestId('screening-start'));
    expect(useScreeningSession.getState()).toMatchObject({ child: { id: CHILD2 }, requestId: null });
  });

  it('teen accounts always screen the self profile, without a switcher', async () => {
    as(account({ userId: TEEN, accountType: 'teen', selfChildId: SELF, capabilities: { createChildAccounts: false, registerProofs: true } }));
    useLocalData.setState({ kids: [kid(CHILD, 'Lain'), kid(SELF, 'Aku', { isSelf: true, birthYear: 2010 })], activeChildId: CHILD });
    mockParams.current = { child: CHILD, request: REQUEST };
    await render(wrap(<Screening />));
    expect(screen.getByText(ts.teen.subject)).toBeOnTheScreen();
    expect(screen.queryByText(id.screening.chooseChild)).toBeNull();
    expect(screen.queryByTestId('screening-request-banner')).toBeNull();
    await fireEvent.press(screen.getByTestId('screening-start'));
    expect(useScreeningSession.getState()).toMatchObject({ child: { id: SELF }, requestId: null });
  });
});

describe('result sync line', () => {
  async function finishFor(childId: string, requestId: string | null) {
    useLocalData.setState({ kids: [kid(childId, 'Adik')], activeChildId: childId });
    useLocalData.getState().setConsent(childId, 'a', true);
    const s = useScreeningSession.getState();
    s.start(useLocalData.getState().kids[0], undefined, { requestId });
    for (const q of triageRules.questions) s.setAnswer(q.id, 'no' as Answer);
    s.setPain(0);
    await useScreeningSession.getState().finish('skip');
  }

  it('guest: local only, no request note', async () => {
    as(null, 'guest');
    await finishFor(CHILD, REQUEST);
    await render(wrap(<Result />));
    expect(screen.getByText(ts.status.guest)).toBeOnTheScreen();
    expect(screen.queryByTestId('save-state-request')).toBeNull();
    // Disclaimer and referral CTA stay on the result screen.
    expect(screen.getAllByText(/bukan diagnosis/i).length).toBeGreaterThan(0);
  });

  it('signed in without consent (b): saved on this phone only, request note shown', async () => {
    as(account({}));
    await finishFor(CHILD, REQUEST);
    await render(wrap(<Result />));
    expect(screen.getByText(ts.status.localOnly)).toBeOnTheScreen();
    expect(screen.getByText(ts.requestNote)).toBeOnTheScreen();
  });

  it('synced records say so', async () => {
    as(account({}));
    await finishFor(CHILD, null);
    const recordId = useScreeningSession.getState().record!.id;
    await render(wrap(<Result />));
    await act(async () => useLocalData.getState().markSynced('screening', recordId));
    expect(screen.getByText(ts.status.synced)).toBeOnTheScreen();
    expect(screen.queryByTestId('save-state-request')).toBeNull();
  });
});
