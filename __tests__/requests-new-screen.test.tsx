import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { useAccount } from '@/core/account/account-store';
import { id } from '@/core/i18n/id';
import { NewRequestScreen } from '@/features/requests/new-request-screen';
import { PAIN_URGENT_MIN_SCORE } from '@/features/requests/request-flow';

const mockRecord = jest.fn();
const mockWait = jest.fn();

jest.mock('@/core/sync/bridge', () => ({ recordScreeningRequest: (...a: unknown[]) => mockRecord(...a) }));
jest.mock('@/core/sync/outbox', () => ({
  outbox: {
    flush: jest.fn().mockResolvedValue({}),
    waitForEvent: (...a: unknown[]) => mockWait(...a),
    dismiss: jest.fn(),
  },
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => false },
}));

const t = id.requests.kidFlow;
const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

const account = (syncAllowed: boolean) =>
  ({
    childAccount: { childId: 'child-1', guardianId: 'g', username: 'u', disabled: false, syncAllowed, proofAllowed: true },
  }) as never;

async function renderScreen() {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <NewRequestScreen />
    </SafeAreaProvider>,
  );
}

async function pick(reason: string, pain: number | 'unknown') {
  await fireEvent.press(screen.getByTestId(`reason-${reason}`));
  await fireEvent.press(screen.getByTestId(`pain-${pain}`));
  await fireEvent.press(screen.getByTestId('request-next'));
}

async function answerAll(flags: Record<string, boolean>) {
  for (const [flag, yes] of Object.entries(flags)) {
    await fireEvent.press(screen.getByTestId(`flag-${flag}-${yes ? 'yes' : 'no'}`));
  }
}

const allNo = { swelling: false, fever: false, pus: false, trauma: false };

beforeEach(() => {
  mockRecord.mockReset().mockReturnValue('evt-1');
  mockWait.mockReset();
  useAccount.setState({ me: account(true) });
});

describe('NewRequestScreen', () => {
  it('sends only reason code and pain level, and shows the applied status', async () => {
    mockWait.mockResolvedValue({ state: 'applied' });
    await renderScreen();
    // No red flag and a pain below the rules' "segera" threshold: no local advice.
    await pick('toothache', 0);
    await answerAll(allNo);
    await fireEvent.press(screen.getByTestId('request-send'));
    await act(async () => {});
    expect(mockRecord).toHaveBeenCalledWith({ childId: 'child-1', reasonCode: 'toothache', painLevel: 0 });
    expect(screen.getByText(t.status.sent)).toBeTruthy();
    expect(screen.queryByTestId('request-red-flag-advice')).toBeNull();
  });

  it('sends "tidak tahu" as a null pain level', async () => {
    mockWait.mockResolvedValue({ state: 'applied' });
    await renderScreen();
    await pick('other', 'unknown');
    await answerAll(allNo);
    await fireEvent.press(screen.getByTestId('request-send'));
    expect(mockRecord).toHaveBeenCalledWith({ childId: 'child-1', reasonCode: 'other', painLevel: null });
  });

  it('shows the red-flag advice immediately, before the server answers, and still sends', async () => {
    mockWait.mockReturnValue(new Promise(() => {})); // server never answers (offline)
    await renderScreen();
    await pick('toothache', 6);
    await answerAll({ ...allNo, fever: true });
    await fireEvent.press(screen.getByTestId('request-send'));
    expect(screen.getByTestId('request-red-flag-advice')).toBeTruthy();
    expect(screen.getByText(t.advice.title)).toBeTruthy();
    expect(screen.getByText(t.advice.body)).toBeTruthy();
    expect(screen.getByText(t.status.sending)).toBeTruthy();
    expect(mockRecord).toHaveBeenCalledTimes(1);
    // The yes/no answers never reach the bridge.
    expect(JSON.stringify(mockRecord.mock.calls)).not.toContain('fever');
  });

  it.each([10, PAIN_URGENT_MIN_SCORE])('severe pain (%i) shows the local advice too, even with every answer "Tidak"', async (pain) => {
    mockWait.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    await pick('toothache', pain);
    await answerAll(allNo);
    await fireEvent.press(screen.getByTestId('request-send'));
    expect(screen.getByTestId('request-red-flag-advice')).toBeTruthy();
    expect(screen.getByText(t.advice.title)).toBeTruthy();
    expect(mockRecord).toHaveBeenCalledWith({ childId: 'child-1', reasonCode: 'toothache', painLevel: pain });
  });

  it('"tidak tahu" pain alone shows no advice', async () => {
    mockWait.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    await pick('toothache', 'unknown');
    await answerAll(allNo);
    await fireEvent.press(screen.getByTestId('request-send'));
    expect(screen.queryByTestId('request-red-flag-advice')).toBeNull();
  });

  it('treats the swelling reason as a red flag and does not ask about swelling again', async () => {
    mockWait.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    await fireEvent.press(screen.getByTestId('reason-swelling'));
    expect(screen.getByTestId('request-swelling-notice')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('pain-2'));
    await fireEvent.press(screen.getByTestId('request-next'));
    expect(screen.queryByTestId('flag-swelling')).toBeNull();
    await answerAll({ fever: false, pus: false, trauma: false });
    await fireEvent.press(screen.getByTestId('request-send'));
    expect(screen.getByTestId('request-red-flag-advice')).toBeTruthy();
    expect(mockRecord).toHaveBeenCalledWith({ childId: 'child-1', reasonCode: 'swelling', painLevel: 2 });
  });

  it('does not send before every question is answered', async () => {
    await renderScreen();
    await pick('toothache', 1);
    await fireEvent.press(screen.getByTestId('request-send'));
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('tells the child to inform the parent when the daily limit is reached', async () => {
    mockWait.mockResolvedValue({ state: 'rejected', code: 'limit_exceeded' });
    await renderScreen();
    await pick('other', 0);
    await answerAll(allNo);
    await fireEvent.press(screen.getByTestId('request-send'));
    await act(async () => {});
    expect(screen.getByText(t.status.limit)).toBeTruthy();
  });

  it('says "akan terkirim saat ada internet" while the event stays queued', async () => {
    mockWait.mockResolvedValueOnce({ state: 'timeout' }).mockReturnValue(new Promise(() => {}));
    await renderScreen();
    await pick('other', 0);
    await answerAll(allNo);
    await fireEvent.press(screen.getByTestId('request-send'));
    await act(async () => {});
    expect(screen.getByText(t.status.queued)).toBeTruthy();
  });

  it('asks the parent to activate the account when the bridge queues nothing', async () => {
    mockRecord.mockReturnValue(null);
    useAccount.setState({ me: account(false) });
    await renderScreen();
    await pick('other', 3);
    await answerAll(allNo);
    await fireEvent.press(screen.getByTestId('request-send'));
    expect(screen.getByText(t.status.syncOff)).toBeTruthy();
  });

  it('asks the parent to turn on data sending on consent_required', async () => {
    mockWait.mockResolvedValue({ state: 'rejected', code: 'consent_required' });
    await renderScreen();
    await pick('other', 3);
    await answerAll(allNo);
    await fireEvent.press(screen.getByTestId('request-send'));
    await act(async () => {});
    expect(screen.getByText(t.status.consent)).toBeTruthy();
  });
});
