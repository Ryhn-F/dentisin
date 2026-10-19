// History screens: adult list (server pages + local unsynced, pagination, local-only banners,
// segments per account type), child list (never screening), and the detail screen.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { brushingStreak, childHistory } from '@/core/account/api';
import { useAccount } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import { DEFAULT_LIMITS, type BrushingRecord, type HistoryItem, type MyAccount } from '@/domain/models';
import { clearHistoryCache, setHistoryScope } from '@/features/history/history-model';
import { HistoryDetailScreen } from '@/features/history/history-detail-screen';
import { HistoryScreen } from '@/features/history/history-screen';
import { KidHistoryScreen } from '@/features/history/kid-history-screen';

jest.mock('@/core/account/api', () => ({
  ...jest.requireActual('@/core/account/api'),
  childHistory: jest.fn(),
  brushingStreak: jest.fn(),
}));
const mockParams: { current: Record<string, string | undefined> } = { current: {} };
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => mockParams.current,
  // Run the focus callback once on mount, like a focused screen.
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(cb, [cb]);
  },
}));
jest.mock('@/core/auth/supabase', () => ({
  supabase: { rpc: jest.fn(), auth: { refreshSession: jest.fn(), signOut: jest.fn(), getSession: jest.fn(), onAuthStateChange: jest.fn() } },
}));

const history = childHistory as jest.Mock;
const streak = brushingStreak as jest.Mock;

const GUARDIAN = '0b0b0b0b-0000-4000-8000-000000000001';
const KID_USER = '0b0b0b0b-0000-4000-8000-000000000003';
const CHILD = 'c0c0c0c0-0000-4000-8000-000000000001';
const t = id.timeline;

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const wrap = (ui: React.ReactElement) => <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>;

function account(over: Partial<MyAccount>): MyAccount {
  return {
    userId: GUARDIAN,
    accountType: 'guardian',
    roles: ['guardian'],
    selfChildId: null,
    childAccounts: 1,
    childAccount: null,
    flags: { brushingProofVideo: true },
    capabilities: { createChildAccounts: true, registerProofs: false },
    limits: DEFAULT_LIMITS,
    ...over,
  };
}
const childMe = () =>
  account({
    userId: KID_USER,
    accountType: 'child',
    roles: ['child'],
    childAccounts: null,
    childAccount: { childId: CHILD, guardianId: GUARDIAN, username: 'budi', disabled: false, syncAllowed: true, proofAllowed: true },
    capabilities: { createChildAccounts: false, registerProofs: true },
  });

function as(me: MyAccount | null, status: 'signedIn' | 'guest' = 'signedIn') {
  useSession.setState({ status, userId: me?.userId ?? null, email: null });
  useAccount.setState({ userId: me?.userId ?? null, me, status: me ? 'ready' : 'idle', lastError: null });
}

const NOW = Date.now();
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3600 * 1000).toISOString();
const brushing = (n: number, hoursAgo: number): HistoryItem => ({
  kind: 'brushing',
  id: `b${n}`,
  occurredAt: iso(hoursAgo),
  data: { durationS: 125, spiritScore: null, slot: 'morning', cameraMode: false, countsForStreak: true, hasProof: false },
});
const screeningServer = (n: number, hoursAgo: number, redFlag = false): HistoryItem => ({
  kind: 'screening',
  id: `s${n}`,
  occurredAt: iso(hoursAgo),
  data: { level: redFlag ? 'red' : 'orange', redFlag, modelVersion: null, rulesVersion: 'rules-1', findingsCount: 1, requestId: null },
});
const referralServer = (n: number, hoursAgo: number): HistoryItem => ({
  kind: 'referral',
  id: `r${n}`,
  occurredAt: iso(hoursAgo),
  data: { level: 'orange', reasonCodes: ['x'], facilityCode: null, screeningId: null },
});
const requestServer = (n: number, hoursAgo: number, reasonCode: 'toothache' | 'swelling' = 'toothache'): HistoryItem => ({
  kind: 'screening_request',
  id: `q${n}`,
  occurredAt: iso(hoursAgo),
  data: { reasonCode, painLevel: 3, status: 'pending', seenAt: null, respondedAt: null, screeningId: null, expiresAt: iso(-24 * 5) },
});
const proofServer = (n: number, hoursAgo: number): HistoryItem => ({
  kind: 'brushing_proof',
  id: `p${n}`,
  occurredAt: iso(hoursAgo),
  data: { brushingEventId: 'b1', status: 'uploaded', mime: 'video/mp4', sizeBytes: 100, durationS: 61, viewedAt: null, expiresAt: iso(-24 * 5) },
});

const localBrushing = (n: number, hoursAgo: number, synced: boolean): BrushingRecord => ({
  id: `lb${n}`,
  childId: CHILD,
  startedAt: iso(hoursAgo),
  durationS: 130,
  spiritScore: null,
  slot: 'evening',
  cameraMode: false,
  synced,
  proofId: null,
});

const page = (items: HistoryItem[], nextBefore: string | null = null) => ({ ok: true, data: { items, nextBefore } });
const fail = (code: string) => ({ ok: false, code });

async function flush() {
  await act(async () => {});
}

beforeEach(() => {
  history.mockReset();
  streak.mockReset();
  streak.mockResolvedValue(fail('not_deployed'));
  (router.push as jest.Mock).mockClear();
  mockParams.current = {};
  setHistoryScope(null);
  clearHistoryCache();
  useLocalData.setState({
    kids: [{ id: CHILD, nickname: 'Adik', birthYear: 2018, birthMonth: 3, allergies: [] }],
    activeChildId: CHILD,
    brushing: [],
    screenings: [],
    referrals: [],
  });
});

describe('HistoryScreen (guardian)', () => {
  it('asks the server for all kinds of the active child, newest first, with 30 per page', async () => {
    as(account({}));
    history.mockResolvedValue(page([brushing(1, 2), screeningServer(1, 5)]));
    await render(wrap(<HistoryScreen />));
    await flush();
    expect(history).toHaveBeenCalledTimes(1);
    expect(history).toHaveBeenCalledWith({
      childId: CHILD,
      kinds: ['screening', 'brushing', 'referral', 'screening_request', 'brushing_proof'],
      limit: 30,
    });
    expect(screen.getByTestId('history-row-brushing:b1')).toBeTruthy();
    expect(screen.getByTestId('history-row-screening:s1')).toBeTruthy();
    // The old sample-data note is gone for good (its string was removed with the mock store).
    expect(screen.queryByText(/data contoh/i)).toBeNull();
    expect(screen.queryByTestId('history-local-banner')).toBeNull();
  });

  it('merges local unsynced records, tagged "Belum sinkron", and leaves synced local ones out', async () => {
    as(account({}));
    useLocalData.setState({ brushing: [localBrushing(1, 1, false), localBrushing(2, 3, true)] });
    history.mockResolvedValue(page([brushing(1, 2)]));
    await render(wrap(<HistoryScreen />));
    await flush();
    const unsynced = screen.getByTestId('history-row-brushing:lb1');
    expect(unsynced).toBeTruthy();
    expect(screen.getAllByText(new RegExp(t.unsynced)).length).toBe(1);
    expect(screen.queryByTestId('history-row-brushing:lb2')).toBeNull();
  });

  it('loads the next page with next_before and does not show a record twice', async () => {
    as(account({}));
    const cursor = iso(10);
    history.mockResolvedValueOnce(page([brushing(1, 2), brushing(2, 5)], cursor));
    history.mockResolvedValueOnce(page([brushing(2, 5), brushing(3, 12)], null));
    await render(wrap(<HistoryScreen />));
    await flush();
    expect(screen.queryByTestId('history-row-brushing:b3')).toBeNull();
    await fireEvent.press(screen.getByTestId('history-load-more'));
    await flush();
    expect(history).toHaveBeenLastCalledWith(expect.objectContaining({ before: cursor, limit: 30 }));
    expect(screen.getByTestId('history-row-brushing:b3')).toBeTruthy();
    expect(screen.getAllByTestId('history-row-brushing:b2')).toHaveLength(1);
    // The list ended: no more "load more".
    expect(screen.queryByTestId('history-load-more')).toBeNull();
  });

  it('shows the guardian segments and requests the right kinds for each', async () => {
    as(account({}));
    history.mockResolvedValue(page([]));
    await render(wrap(<HistoryScreen />));
    await flush();
    for (const s of ['all', 'brushing', 'screening', 'requests', 'video']) {
      expect(screen.getByTestId(`history-segment-${s}`)).toBeTruthy();
    }
    await fireEvent.press(screen.getByTestId('history-segment-video'));
    await flush();
    expect(history).toHaveBeenLastCalledWith(expect.objectContaining({ kinds: ['brushing_proof'] }));
    await fireEvent.press(screen.getByTestId('history-segment-screening'));
    await flush();
    expect(history).toHaveBeenLastCalledWith(expect.objectContaining({ kinds: ['screening', 'referral'] }));
    await fireEvent.press(screen.getByTestId('history-segment-requests'));
    await flush();
    expect(history).toHaveBeenLastCalledWith(expect.objectContaining({ kinds: ['screening_request'] }));
  });

  it('serves a revisited segment from the first-page cache at once', async () => {
    as(account({}));
    history.mockImplementation(async ({ kinds }: { kinds: string[] }) =>
      kinds.length === 1 && kinds[0] === 'brushing_proof' ? page([proofServer(1, 3)]) : page([brushing(1, 2)]),
    );
    await render(wrap(<HistoryScreen />));
    await flush();
    await fireEvent.press(screen.getByTestId('history-segment-video'));
    await flush();
    expect(screen.getByTestId('history-row-brushing_proof:p1')).toBeTruthy();
    // Back to "Semua": the cached page is on screen before any request answers.
    history.mockImplementation(() => new Promise(() => {}));
    await fireEvent.press(screen.getByTestId('history-segment-all'));
    expect(screen.getByTestId('history-row-brushing:b1')).toBeTruthy();
    expect(screen.queryByTestId('history-loading')).toBeNull();
  });

  it('opens a server row with its kind:id key and a local row with its own id', async () => {
    as(account({}));
    useLocalData.setState({ brushing: [localBrushing(1, 1, false)] });
    history.mockResolvedValue(page([screeningServer(1, 5)]));
    await render(wrap(<HistoryScreen />));
    await flush();
    await fireEvent.press(screen.getByTestId('history-row-screening:s1'));
    expect(router.push).toHaveBeenLastCalledWith('/history/screening:s1');
    await fireEvent.press(screen.getByTestId('history-row-brushing:lb1'));
    expect(router.push).toHaveBeenLastCalledWith('/history/lb1');
  });

  it('backend without v2 (not_deployed): local list with a small banner', async () => {
    as(account({}));
    useLocalData.setState({ brushing: [localBrushing(1, 1, true), localBrushing(2, 2, false)] });
    history.mockResolvedValue(fail('not_deployed'));
    await render(wrap(<HistoryScreen />));
    await flush();
    expect(screen.getByText(t.localOnly.notDeployed)).toBeTruthy();
    // Local-only: every local record is listed, synced or not.
    expect(screen.getByTestId('history-row-brushing:lb1')).toBeTruthy();
    expect(screen.getByTestId('history-row-brushing:lb2')).toBeTruthy();
    expect(screen.queryByTestId('history-load-more')).toBeNull();
  });

  it('offline: local list, banner and a retry that asks again', async () => {
    as(account({}));
    useLocalData.setState({ brushing: [localBrushing(1, 1, false)] });
    history.mockResolvedValueOnce(fail('network'));
    await render(wrap(<HistoryScreen />));
    await flush();
    expect(screen.getByText(t.localOnly.offline)).toBeTruthy();
    expect(screen.getByTestId('history-row-brushing:lb1')).toBeTruthy();
    history.mockResolvedValueOnce(page([brushing(1, 2)]));
    await fireEvent.press(screen.getByTestId('history-retry'));
    await flush();
    expect(screen.queryByTestId('history-local-banner')).toBeNull();
    expect(screen.getByTestId('history-row-brushing:b1')).toBeTruthy();
  });

  it('an empty segment shows its empty state', async () => {
    as(account({}));
    history.mockResolvedValue(page([]));
    await render(wrap(<HistoryScreen />));
    await flush();
    expect(screen.getByText(t.empty.all.title)).toBeTruthy();
  });

  it('shows the child switcher for a guardian and keys the request on the chosen child', async () => {
    as(account({}));
    const OTHER = 'c0c0c0c0-0000-4000-8000-000000000002';
    useLocalData.setState({
      kids: [
        { id: CHILD, nickname: 'Adik', birthYear: 2018, birthMonth: 3, allergies: [] },
        { id: OTHER, nickname: '', birthYear: 2016, birthMonth: 1, allergies: [] },
      ],
    });
    history.mockResolvedValue(page([]));
    await render(wrap(<HistoryScreen />));
    await flush();
    await fireEvent.press(screen.getByTestId(`child-chip-${OTHER}`));
    await flush();
    expect(history).toHaveBeenLastCalledWith(expect.objectContaining({ childId: OTHER }));
    expect(screen.getByLabelText(t.childFallback(2))).toBeTruthy();
  });
});

describe('HistoryScreen (teen, guest)', () => {
  it('a teen has no "Permintaan" segment, no child switcher, and uses the self profile', async () => {
    const SELF = 'c0c0c0c0-0000-4000-8000-0000000000aa';
    as(account({ accountType: 'teen', selfChildId: SELF, capabilities: { createChildAccounts: false, registerProofs: true } }));
    useLocalData.setState({
      kids: [{ id: SELF, nickname: '', birthYear: 2010, birthMonth: null, allergies: [], isSelf: true }],
      activeChildId: SELF,
    });
    history.mockResolvedValue(page([]));
    await render(wrap(<HistoryScreen />));
    await flush();
    expect(screen.queryByTestId('history-segment-requests')).toBeNull();
    expect(screen.getByTestId('history-segment-video')).toBeTruthy();
    expect(screen.queryByTestId(`child-chip-${SELF}`)).toBeNull();
    expect(history).toHaveBeenCalledWith({
      childId: SELF,
      kinds: ['screening', 'brushing', 'referral', 'brushing_proof'],
      limit: 30,
    });
  });

  it('no account: never calls the server, lists local records with the guest banner', async () => {
    as(null, 'guest');
    useLocalData.setState({ brushing: [localBrushing(1, 1, false)] });
    await render(wrap(<HistoryScreen />));
    await flush();
    expect(history).not.toHaveBeenCalled();
    expect(screen.getByText(t.localOnly.guest)).toBeTruthy();
    expect(screen.getByTestId('history-row-brushing:lb1')).toBeTruthy();
    expect(screen.queryByTestId('history-segment-requests')).toBeNull();
    expect(screen.queryByTestId('history-segment-video')).toBeNull();
  });
});

describe('KidHistoryScreen (child account)', () => {
  it('lists brushing, own requests and proof metadata, and never screening or referral', async () => {
    as(childMe());
    // A page that wrongly contains results: the screen must drop them.
    history.mockResolvedValue(
      page([brushing(1, 2), screeningServer(1, 3), referralServer(1, 4), requestServer(1, 5), proofServer(1, 6)]),
    );
    await render(wrap(<KidHistoryScreen />));
    await flush();
    expect(history).toHaveBeenCalledWith({
      childId: CHILD,
      kinds: ['brushing', 'screening_request', 'brushing_proof'],
      limit: 30,
    });
    expect(screen.getByTestId('history-row-brushing:b1')).toBeTruthy();
    expect(screen.getByTestId('history-row-screening_request:q1')).toBeTruthy();
    expect(screen.getByTestId('history-row-brushing_proof:p1')).toBeTruthy();
    expect(screen.queryByTestId('history-row-screening:s1')).toBeNull();
    expect(screen.queryByTestId('history-row-referral:r1')).toBeNull();
    expect(screen.queryByText(new RegExp(id.levels.urgent.label))).toBeNull();
    expect(screen.queryByText(new RegExp(id.levels.scheduled.label))).toBeNull();
    // Grade-4 wording for the child's own request and video.
    expect(screen.getByText(new RegExp(id.timeline.kid.requestStatus.pending))).toBeTruthy();
    expect(screen.getByText(new RegExp(id.timeline.kid.proof.sent))).toBeTruthy();
  });

  it('rows are not tappable (no detail screens for a child account)', async () => {
    as(childMe());
    history.mockResolvedValue(page([brushing(1, 2)]));
    await render(wrap(<KidHistoryScreen />));
    await flush();
    await fireEvent.press(screen.getByTestId('history-row-brushing:b1'));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows the streak header and keeps the red-flag advice on top for an open swelling request', async () => {
    as(childMe());
    history.mockResolvedValue(page([requestServer(1, 2, 'swelling')]));
    await render(wrap(<KidHistoryScreen />));
    await flush();
    expect(screen.getByTestId('history-streak')).toBeTruthy();
    expect(screen.getByText(id.timeline.kid.swellingTitle)).toBeTruthy();
  });

  it('local only (server cannot answer): own local sessions, never screening records', async () => {
    as(childMe());
    useLocalData.setState({
      brushing: [localBrushing(1, 1, false)],
      screenings: [
        {
          id: 'ls1',
          childId: CHILD,
          screenedAt: iso(2),
          level: 'urgent',
          redFlag: false,
          reasons: [],
          adviceIds: [],
          referralTemplateId: 'x',
          rulesVersion: 'v1',
          modelVersion: null,
          photoTaken: false,
          photoStatus: 'not_taken',
          findings: [],
          answers: {},
          pain: null,
          ageMonths: null,
          synced: false,
          requestId: null,
          referralId: null,
        },
      ],
    });
    history.mockResolvedValue(fail('network'));
    await render(wrap(<KidHistoryScreen />));
    await flush();
    expect(screen.getByTestId('history-row-brushing:lb1')).toBeTruthy();
    expect(screen.queryByTestId('history-row-screening:ls1')).toBeNull();
    expect(screen.getByTestId('kid-history-local')).toBeTruthy();
  });

  it('empty list: friendly message', async () => {
    as(childMe());
    history.mockResolvedValue(page([]));
    await render(wrap(<KidHistoryScreen />));
    await flush();
    expect(screen.getByText(id.timeline.kid.emptyTitle)).toBeTruthy();
  });
});

describe('HistoryDetailScreen', () => {
  function openFromList(items: HistoryItem[]) {
    // The list fills the in-memory cache that the detail screen reads.
    return (async () => {
      as(account({}));
      history.mockResolvedValue(page(items));
      const view = await render(wrap(<HistoryScreen />));
      await flush();
      await view.unmount();
    })();
  }

  it('server screening: level label, red flag advice first, disclaimer and referral advice', async () => {
    await openFromList([screeningServer(1, 5, true)]);
    mockParams.current = { id: 'screening:s1' };
    await render(wrap(<HistoryDetailScreen />));
    expect(screen.getByTestId('detail-screening')).toBeTruthy();
    expect(screen.getByTestId('detail-red-flag')).toBeTruthy();
    expect(screen.getAllByText(id.levels.emergency.label).length).toBeGreaterThan(0);
    expect(screen.getByText('rules-1')).toBeTruthy();
    expect(screen.getByTestId('result-disclaimer')).toBeTruthy();
    expect(screen.getByText(id.common.disclaimer)).toBeTruthy();
    expect(screen.getByTestId('detail-local-hint')).toBeTruthy();
  });

  it('server screening without red flag has the level advice, disclaimer and no red-flag card', async () => {
    await openFromList([screeningServer(1, 5)]);
    mockParams.current = { id: 'screening:s1' };
    await render(wrap(<HistoryDetailScreen />));
    expect(screen.queryByTestId('detail-red-flag')).toBeNull();
    expect(screen.getByText(id.common.disclaimer)).toBeTruthy();
  });

  it('referral: level, reason count, disclaimer', async () => {
    await openFromList([referralServer(1, 5)]);
    mockParams.current = { id: 'referral:r1' };
    await render(wrap(<HistoryDetailScreen />));
    expect(screen.getByTestId('detail-referral')).toBeTruthy();
    expect(screen.getByText(id.common.disclaimer)).toBeTruthy();
  });

  it('request: reason, pain, status; a swelling request shows the local advice', async () => {
    await openFromList([requestServer(1, 5, 'swelling')]);
    mockParams.current = { id: 'screening_request:q1' };
    await render(wrap(<HistoryDetailScreen />));
    expect(screen.getByTestId('detail-request')).toBeTruthy();
    expect(screen.getByTestId('detail-red-flag')).toBeTruthy();
    expect(screen.getByText(id.timeline.detail.requestPainValue(3))).toBeTruthy();
    expect(screen.getByText(t.requestStatus.pending)).toBeTruthy();
    expect(screen.getByTestId('detail-open-requests')).toBeTruthy();
  });

  it('proof: status, duration, expiry and "Tonton" opens the player for the child', async () => {
    await openFromList([proofServer(1, 5)]);
    mockParams.current = { id: 'brushing_proof:p1' };
    await render(wrap(<HistoryDetailScreen />));
    expect(screen.getByTestId('detail-proof')).toBeTruthy();
    expect(screen.getByText(t.detail.proofDurationValue(61))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('detail-watch'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/proofs/[id]', params: { id: 'p1', child: CHILD } });
  });

  it('server brushing: duration, slot, proof and streak flags', async () => {
    await openFromList([brushing(1, 5)]);
    mockParams.current = { id: 'brushing:b1' };
    await render(wrap(<HistoryDetailScreen />));
    expect(screen.getByTestId('detail-brushing')).toBeTruthy();
    expect(screen.getByText(t.detail.brushingCounts)).toBeTruthy();
    expect(screen.getByText(t.detail.brushingHasProof)).toBeTruthy();
  });

  it('a local record shows its full local view', async () => {
    as(account({}));
    useLocalData.setState({ brushing: [localBrushing(1, 1, false)] });
    mockParams.current = { id: 'lb1' };
    await render(wrap(<HistoryDetailScreen />));
    expect(screen.getByTestId('detail-local-brushing')).toBeTruthy();
    expect(screen.getByText(id.history.notSynced)).toBeTruthy();
  });

  it('an unknown or evicted record: "Catatan tidak ditemukan"', async () => {
    as(account({}));
    mockParams.current = { id: 'screening:nope' };
    await render(wrap(<HistoryDetailScreen />));
    expect(screen.getByText(t.detail.notFound)).toBeTruthy();
  });
});
