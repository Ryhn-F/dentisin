import { router } from 'expo-router';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ackScreeningRequest, listChildren, listScreeningRequests } from '@/core/account/api';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import type { ChildSummary, ScreeningRequest } from '@/domain/models';
import { RequestsScreen } from '@/features/requests/requests-screen';

jest.mock('@/core/account/api', () => ({
  ...jest.requireActual('@/core/account/api'),
  listScreeningRequests: jest.fn(),
  ackScreeningRequest: jest.fn(),
  listChildren: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  // Run the focus callback once on mount, like a focused screen.
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(cb, [cb]);
  },
}));

const t = id.requests.list;
const list = listScreeningRequests as jest.Mock;
const ack = ackScreeningRequest as jest.Mock;
const children = listChildren as jest.Mock;

const FUTURE = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
function req(over: Partial<ScreeningRequest>): ScreeningRequest {
  return {
    id: 'r1',
    childId: 'child-1',
    reasonCode: 'toothache',
    painLevel: 5,
    status: 'pending',
    createdAt: new Date().toISOString(),
    seenAt: null,
    respondedAt: null,
    screeningId: null,
    expiresAt: FUTURE,
    ...over,
  };
}

function mockLists(open: ScreeningRequest[], closed: ScreeningRequest[] = []) {
  list.mockImplementation(async ({ statuses }: { statuses: string[] }) => ({
    ok: true,
    data: statuses.includes('pending') ? open : closed,
  }));
}

beforeEach(() => {
  list.mockReset();
  ack.mockReset();
  children.mockReset();
  children.mockResolvedValue({ ok: false, code: 'not_deployed' });
  (router.push as jest.Mock).mockClear();
});

describe('RequestsScreen', () => {
  it('loads open and closed requests with the right status filters', async () => {
    mockLists([req({})], [req({ id: 'r9', status: 'done' })]);
    await render(<RequestsScreen />);
    await act(async () => {});
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ statuses: ['pending', 'seen'] }));
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ statuses: ['done', 'cancelled', 'expired'] }));
    expect(screen.getByTestId('request-card-r1')).toBeTruthy();
    // The "Selesai" section is collapsed by default.
    expect(screen.queryByTestId('request-closed-r9')).toBeNull();
    await fireEvent.press(screen.getByTestId('requests-closed-toggle'));
    expect(screen.getByTestId('request-closed-r9')).toBeTruthy();
  });

  it('marks a pending request as seen when it is opened', async () => {
    mockLists([req({})]);
    ack.mockResolvedValue({
      ok: true,
      data: { id: 'r1', status: 'seen', seenAt: new Date().toISOString(), respondedAt: null },
    });
    await render(<RequestsScreen />);
    await act(async () => {});
    expect(ack).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('request-toggle-r1'));
    await act(async () => {});
    expect(ack).toHaveBeenCalledWith('r1', 'seen');
    expect(screen.queryByTestId('request-new-tag')).toBeNull();
  });

  it('does not ack a request that was already seen', async () => {
    mockLists([req({ status: 'seen', seenAt: new Date().toISOString() })]);
    await render(<RequestsScreen />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('request-toggle-r1'));
    await act(async () => {});
    expect(ack).not.toHaveBeenCalled();
  });

  it('opens the screening tab with child and request params', async () => {
    mockLists([req({ id: 'r7', childId: 'child-7', status: 'seen' })]);
    await render(<RequestsScreen />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('request-toggle-r7'));
    await fireEvent.press(screen.getByTestId('request-check-r7'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/screening', params: { child: 'child-7', request: 'r7' } });
  });

  it('adopts server children so the screening tab can find a child added on another phone', async () => {
    const CHILD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    useLocalData.setState({ kids: [], activeChildId: null });
    const row: ChildSummary = {
      childId: CHILD,
      isSelf: false,
      birthYear: 2016,
      birthMonth: null,
      consents: ['a', 'b'],
      hasChildAccount: true,
      childAccountDisabled: false,
      username: 'si.budi',
      lastScreeningAt: null,
      lastScreeningLevel: null,
      lastBrushingAt: null,
      openRequests: 1,
      unseenRequests: 1,
      unviewedProofs: 0,
      deletionPending: false,
    };
    children.mockResolvedValue({ ok: true, data: [row] });
    mockLists([req({ id: 'r8', childId: CHILD })]);
    await render(<RequestsScreen />);
    await act(async () => {});
    expect(useLocalData.getState().kids.map((k) => k.id)).toContain(CHILD);
  });

  it('asks for confirmation before closing a request, then acks cancel', async () => {
    mockLists([req({ status: 'seen' })]);
    ack.mockResolvedValue({
      ok: true,
      data: { id: 'r1', status: 'cancelled', seenAt: null, respondedAt: new Date().toISOString() },
    });
    await render(<RequestsScreen />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('request-toggle-r1'));
    await fireEvent.press(screen.getByTestId('request-cancel-r1'));
    expect(ack).not.toHaveBeenCalled();
    expect(screen.getByText(t.confirmTitle)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('request-confirm-r1'));
    await act(async () => {});
    expect(ack).toHaveBeenCalledWith('r1', 'cancel');
    expect(screen.queryByTestId('request-card-r1')).toBeNull();
  });

  it('shows the urgent tag and local advice for the swelling reason', async () => {
    mockLists([req({ reasonCode: 'swelling' })]);
    await render(<RequestsScreen />);
    await act(async () => {});
    expect(screen.getByTestId('request-urgent-tag')).toBeTruthy();
    expect(screen.getByText(t.urgentAdvice)).toBeTruthy();
  });

  it('marks severe pain as urgent with the triage advice (PAIN_HIGH), but not an unknown pain level', async () => {
    mockLists([req({ id: 'p1', painLevel: 10 }), req({ id: 'p2', painLevel: null, childId: 'child-2' })]);
    await render(<RequestsScreen />);
    await act(async () => {});
    expect(screen.getAllByTestId('request-urgent-tag')).toHaveLength(1);
    expect(screen.getByText(t.urgentPainAdvice)).toBeTruthy();
    expect(screen.queryByText(t.urgentAdvice)).toBeNull();
  });

  it('closing never says the child needs no examination; an urgent request repeats the urgent advice', async () => {
    mockLists([req({ id: 's1', reasonCode: 'swelling' }), req({ id: 'o1', reasonCode: 'other', painLevel: null, childId: 'child-2' })]);
    ack.mockResolvedValue({ ok: true, data: { id: 's1', status: 'seen', seenAt: new Date().toISOString(), respondedAt: null } });
    await render(<RequestsScreen />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('request-toggle-s1'));
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('request-cancel-s1'));
    expect(screen.getByText(t.confirmBodyUrgent)).toBeTruthy();
    expect(screen.queryByText(t.confirmBody)).toBeNull();

    await fireEvent.press(screen.getByTestId('request-toggle-o1'));
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('request-cancel-o1'));
    expect(screen.getByText(t.confirmBody)).toBeTruthy();
    for (const text of [t.notNeeded, t.confirmBody, t.confirmBodyUrgent]) {
      expect(text.toLowerCase()).not.toMatch(/tidak perlu (menunggu )?(pemeriksaan|diperiksa|ke dokter)/);
    }
  });

  it('groups requests by child with a fallback label', async () => {
    mockLists([req({ id: 'a', childId: 'c1' }), req({ id: 'b', childId: 'c2' })]);
    await render(<RequestsScreen />);
    await act(async () => {});
    expect(screen.getByText('Anak')).toBeTruthy();
    expect(screen.getByText('Anak 2')).toBeTruthy();
  });

  it.each([
    ['not_deployed', 'notDeployed'],
    ['forbidden', 'forbidden'],
    ['network', 'network'],
  ])('shows a friendly state for %s instead of crashing', async (code, kind) => {
    list.mockResolvedValue({ ok: false, code });
    await render(<RequestsScreen />);
    await act(async () => {});
    expect(screen.getByTestId(`requests-error-${kind}`)).toBeTruthy();
  });
});
