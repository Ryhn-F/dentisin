import { router } from 'expo-router';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { legacyGuardianAccount, useAccount } from '@/core/account/account-store';
import { deleteBrushingProof, listBrushingProofs } from '@/core/account/api';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import type { BrushingProof, MyAccount } from '@/domain/models';
import { ProofsScreen } from '@/features/proofs/proofs-screen';

jest.mock('@/core/account/api', () => ({
  ...jest.requireActual('@/core/account/api'),
  listBrushingProofs: jest.fn(),
  deleteBrushingProof: jest.fn(),
}));

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
  // Run the focus callback once on mount, like a focused screen.
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(cb, [cb]);
  },
}));

const t = id.proofs.list;
const list = listBrushingProofs as jest.Mock;
const del = deleteBrushingProof as jest.Mock;

const IN_5_DAYS = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();

function proof(over: Partial<BrushingProof> & { id: string }): BrushingProof {
  return {
    childId: 'c1',
    brushingEventId: 'b1',
    objectPath: 'o/c/p.mp4',
    mime: 'video/mp4',
    sizeBytes: 2.5 * 1024 * 1024,
    durationS: 125,
    status: 'uploaded',
    uploadedAt: '2026-10-17T06:45:00.000Z',
    expiresAt: IN_5_DAYS,
    viewedAt: null,
    objectPresent: true,
    ...over,
  };
}

function setKids(kids: { id: string; nickname: string; isSelf?: boolean }[], active: string | null = null) {
  useLocalData.setState({
    kids: kids.map((k) => ({ birthYear: null, birthMonth: null, allergies: [], ...k })),
    activeChildId: active ?? kids[0]?.id ?? null,
  });
}

function setAccount(accountType: 'guardian' | 'teen', selfChildId: string | null = null) {
  const base: MyAccount = { ...legacyGuardianAccount('u1'), accountType, selfChildId };
  useAccount.setState({ userId: 'u1', me: base, status: 'ready' });
}

beforeEach(() => {
  list.mockReset();
  del.mockReset();
  (router.push as jest.Mock).mockClear();
  mockParams = {};
  setAccount('guardian');
  setKids([{ id: 'c1', nickname: 'Dina' }]);
});

describe('ProofsScreen: list', () => {
  it('lists clips with date, length, size, "Baru" and the retention countdown', async () => {
    list.mockResolvedValue({ ok: true, data: [proof({ id: 'p1' }), proof({ id: 'p2', viewedAt: '2026-10-17T07:00:00Z' })] });
    await render(<ProofsScreen />);
    await act(async () => {});
    expect(list).toHaveBeenCalledWith({ childId: 'c1', limit: 20 });
    expect(screen.getByTestId('proof-card-p1')).toBeTruthy();
    expect(screen.getAllByText(`${t.duration(125)} · ${t.size('2,5')}`)).toHaveLength(2);
    expect(screen.getAllByTestId('proof-new-tag')).toHaveLength(1); // only p1 is unwatched
    expect(screen.getByTestId('proof-note-p1').props.children).toBe(t.expiresIn(5));
    expect(screen.getByTestId('proofs-privacy')).toBeTruthy();
  });

  it('shows "Belum selesai diunggah" for a clip whose file has not arrived, and does not open it', async () => {
    list.mockResolvedValue({ ok: true, data: [proof({ id: 'p1', objectPresent: false })] });
    await render(<ProofsScreen />);
    await act(async () => {});
    expect(screen.getByTestId('proof-note-p1').props.children).toBe(t.notUploaded);
    expect(screen.queryByTestId('proof-new-tag')).toBeNull();
    await fireEvent.press(screen.getByTestId('proof-open-p1'));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('opens the player with the clip id and its child', async () => {
    list.mockResolvedValue({ ok: true, data: [proof({ id: 'p1' })] });
    await render(<ProofsScreen />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('proof-open-p1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/proofs/[id]', params: { id: 'p1', child: 'c1' } });
  });

  it('shows the empty state', async () => {
    list.mockResolvedValue({ ok: true, data: [] });
    await render(<ProofsScreen />);
    await act(async () => {});
    expect(screen.getByTestId('proofs-empty')).toBeTruthy();
    expect(screen.getByText(t.emptyGuardian)).toBeTruthy();
  });

  it.each([
    ['not_deployed', 'notDeployed'],
    ['forbidden', 'forbidden'],
    ['network', 'network'],
  ])('shows the friendly %s state', async (code, kind) => {
    list.mockResolvedValue({ ok: false, code });
    await render(<ProofsScreen />);
    await act(async () => {});
    expect(screen.getByTestId(`proofs-error-${kind}`)).toBeTruthy();
    if (kind === 'forbidden') expect(screen.queryByText(t.retry)).toBeNull();
    else expect(screen.getByText(t.retry)).toBeTruthy();
  });

  it('retries after a network error', async () => {
    list.mockResolvedValueOnce({ ok: false, code: 'network' }).mockResolvedValueOnce({ ok: true, data: [proof({ id: 'p1' })] });
    await render(<ProofsScreen />);
    await act(async () => {});
    await fireEvent.press(screen.getByText(t.retry));
    await act(async () => {});
    expect(screen.getByTestId('proof-card-p1')).toBeTruthy();
  });

  it('pages with "Muat lagi" using the last uploaded_at as before, then hides the button', async () => {
    const first = Array.from({ length: 20 }, (_, i) =>
      proof({ id: `p${i}`, uploadedAt: new Date(Date.UTC(2026, 9, 17, 10, 0, 0) - i * 3600_000).toISOString() }),
    );
    list.mockResolvedValueOnce({ ok: true, data: first }).mockResolvedValueOnce({ ok: true, data: [proof({ id: 'last' })] });
    await render(<ProofsScreen />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('proofs-load-more'));
    await act(async () => {});
    expect(list).toHaveBeenLastCalledWith({ childId: 'c1', before: first[19].uploadedAt, limit: 20 });
    expect(screen.getByTestId('proof-card-last')).toBeTruthy();
    expect(screen.queryByTestId('proofs-load-more')).toBeNull();
  });

  it('keeps the loaded clips and shows a notice when "Muat lagi" fails', async () => {
    const first = Array.from({ length: 20 }, (_, i) =>
      proof({ id: `p${i}`, uploadedAt: `2026-10-17T10:${String(59 - i).padStart(2, '0')}:00.000Z` }),
    );
    list.mockResolvedValueOnce({ ok: true, data: first }).mockResolvedValueOnce({ ok: false, code: 'network' });
    await render(<ProofsScreen />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('proofs-load-more'));
    await act(async () => {});
    expect(screen.getByTestId('proofs-more-failed')).toBeTruthy();
    expect(screen.getByTestId('proof-card-p0')).toBeTruthy();
  });
});

describe('ProofsScreen: delete', () => {
  it('asks first, then deletes and removes the row', async () => {
    list.mockResolvedValue({ ok: true, data: [proof({ id: 'p1' }), proof({ id: 'p2' })] });
    del.mockResolvedValue({ ok: true, data: { id: 'p1', status: 'deleted', deletedAt: new Date().toISOString() } });
    await render(<ProofsScreen />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('proof-delete-p1'));
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByText(t.deleteTitle)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('proof-delete-confirm-p1-yes'));
    await act(async () => {});
    expect(del).toHaveBeenCalledWith('p1');
    expect(screen.queryByTestId('proof-card-p1')).toBeNull();
    expect(screen.getByTestId('proof-card-p2')).toBeTruthy();
  });

  it('keeps the clip when the user changes their mind', async () => {
    list.mockResolvedValue({ ok: true, data: [proof({ id: 'p1' })] });
    await render(<ProofsScreen />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('proof-delete-p1'));
    await fireEvent.press(screen.getByTestId('proof-delete-confirm-p1-no'));
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByTestId('proof-card-p1')).toBeTruthy();
    expect(screen.queryByText(t.deleteTitle)).toBeNull();
  });

  it('keeps the row and says so when the delete fails', async () => {
    list.mockResolvedValue({ ok: true, data: [proof({ id: 'p1' })] });
    del.mockResolvedValue({ ok: false, code: 'network' });
    await render(<ProofsScreen />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('proof-delete-p1'));
    await fireEvent.press(screen.getByTestId('proof-delete-confirm-p1-yes'));
    await act(async () => {});
    expect(screen.getByTestId('proof-card-p1')).toBeTruthy();
    expect(screen.getByText(t.deleteFailed)).toBeTruthy();
  });
});

describe('ProofsScreen: who is shown', () => {
  it('lets a guardian pick a child and reloads for that child', async () => {
    setKids([
      { id: 'c1', nickname: 'Dina' },
      { id: 'c2', nickname: 'Eko' },
    ]);
    list.mockResolvedValue({ ok: true, data: [] });
    await render(<ProofsScreen />);
    await act(async () => {});
    expect(list).toHaveBeenLastCalledWith({ childId: 'c1', limit: 20 });
    await fireEvent.press(screen.getByTestId('child-chip-c2'));
    await act(async () => {});
    expect(list).toHaveBeenLastCalledWith({ childId: 'c2', limit: 20 });
  });

  it('uses the child param and hides the picker', async () => {
    setKids([
      { id: 'c1', nickname: 'Dina' },
      { id: 'c2', nickname: 'Eko' },
    ]);
    mockParams = { child: 'c2' };
    list.mockResolvedValue({ ok: true, data: [] });
    await render(<ProofsScreen />);
    await act(async () => {});
    expect(list).toHaveBeenCalledWith({ childId: 'c2', limit: 20 });
    expect(screen.queryByTestId('proofs-picker')).toBeNull();
    expect(screen.getByTestId('proofs-child-title')).toBeTruthy();
  });

  it('shows a teen only the self profile, without a picker, with the teen wording', async () => {
    setAccount('teen', 's1');
    setKids([
      { id: 's1', nickname: '', isSelf: true },
      { id: 'other', nickname: 'Lain' },
    ]);
    list.mockResolvedValue({ ok: true, data: [] });
    await render(<ProofsScreen />);
    await act(async () => {});
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({ childId: 's1', limit: 20 });
    expect(screen.queryByTestId('proofs-picker')).toBeNull();
    expect(screen.getByText(t.emptyTeen)).toBeTruthy();
    expect(screen.getByText(t.privacyTeen(7))).toBeTruthy();
  });

  it('asks a guardian without children to add one', async () => {
    setKids([]);
    await render(<ProofsScreen />);
    await act(async () => {});
    expect(list).not.toHaveBeenCalled();
    expect(screen.getByTestId('proofs-no-child')).toBeTruthy();
  });
});
