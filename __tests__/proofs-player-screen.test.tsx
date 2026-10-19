import { router } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { legacyGuardianAccount, useAccount } from '@/core/account/account-store';
import { deleteBrushingProof, listBrushingProofs, markProofViewed, proofSignedUrl } from '@/core/account/api';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import type { BrushingProof } from '@/domain/models';
import { URL_MAX_AGE_MS } from '@/features/proofs/proof-flow';
import { ProofPlayerScreen } from '@/features/proofs/proof-player-screen';

jest.mock('@/core/account/api', () => ({
  ...jest.requireActual('@/core/account/api'),
  listBrushingProofs: jest.fn(),
  deleteBrushingProof: jest.fn(),
  markProofViewed: jest.fn(),
  proofSignedUrl: jest.fn(),
}));

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(cb, [cb]);
  },
}));

// One shared fake player so a test can emit the native player events (playingChange, statusChange).
const mockPlayer = {
  play: jest.fn(),
  pause: jest.fn(),
  replaceAsync: jest.fn(async () => {}),
  currentTime: 0,
  loop: false,
  handlers: {} as Record<string, ((payload: Record<string, unknown>) => void)[]>,
  addListener: jest.fn((name: string, cb: (payload: Record<string, unknown>) => void) => {
    (mockPlayer.handlers[name] ??= []).push(cb);
    return {
      remove: jest.fn(() => {
        mockPlayer.handlers[name] = (mockPlayer.handlers[name] ?? []).filter((h) => h !== cb);
      }),
    };
  }),
};
jest.mock('expo-video', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mockReact = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    VideoView: (props: Record<string, unknown>) => mockReact.createElement(View, { testID: 'video-view', ...props }),
    useVideoPlayer: () => mockPlayer,
  };
});

async function emit(name: string, payload: Record<string, unknown>) {
  await act(async () => {
    for (const h of mockPlayer.handlers[name] ?? []) h(payload);
  });
}

const t = id.proofs.player;
const list = listBrushingProofs as jest.Mock;
const del = deleteBrushingProof as jest.Mock;
const viewed = markProofViewed as jest.Mock;
const signed = proofSignedUrl as jest.Mock;

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const PATH = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.mp4';

function proof(over: Partial<BrushingProof> & { id: string }): BrushingProof {
  return {
    childId: 'c1',
    brushingEventId: 'b1',
    objectPath: PATH,
    mime: 'video/mp4',
    sizeBytes: 3 * 1024 * 1024,
    durationS: 90,
    status: 'uploaded',
    uploadedAt: '2026-10-17T06:45:00.000Z',
    expiresAt: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
    viewedAt: null,
    objectPresent: true,
    ...over,
  };
}

async function renderPlayer() {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ProofPlayerScreen />
    </SafeAreaProvider>,
  );
  await act(async () => {});
}

async function tapPlay() {
  await fireEvent.press(screen.getByTestId('proof-play'));
  await act(async () => {});
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-18T08:00:00Z') });
  list.mockReset();
  del.mockReset();
  viewed.mockReset();
  signed.mockReset();
  mockPlayer.play.mockClear();
  mockPlayer.pause.mockClear();
  mockPlayer.replaceAsync.mockClear();
  mockPlayer.addListener.mockClear();
  mockPlayer.handlers = {};
  mockPlayer.currentTime = 0;
  (router.back as jest.Mock).mockClear();
  mockParams = { id: 'p1', child: 'c1' };
  useAccount.setState({ userId: 'u1', me: legacyGuardianAccount('u1'), status: 'ready' });
  useLocalData.setState({ kids: [{ id: 'c1', nickname: 'Dina', birthYear: null, birthMonth: null, allergies: [] }], activeChildId: 'c1' });
  list.mockResolvedValue({ ok: true, data: [proof({ id: 'p1' })] });
  signed.mockResolvedValue({ ok: true, data: 'https://signed.example/v1' });
  viewed.mockResolvedValue({ ok: true, data: { id: 'p1', status: 'viewed', viewedAt: new Date().toISOString() } });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ProofPlayerScreen: finding the clip', () => {
  it('refetches the child list, shows the retention countdown and asks for no URL yet', async () => {
    await renderPlayer();
    expect(list).toHaveBeenCalledWith({ childId: 'c1', before: undefined, limit: 50 });
    expect(screen.getByTestId('proof-retention').props.children).toBe(id.proofs.list.expiresIn(3));
    expect(screen.getByTestId('proof-play')).toBeTruthy();
    expect(signed).not.toHaveBeenCalled();
    expect(viewed).not.toHaveBeenCalled();
  });

  it('pages on when the clip is not on the first page', async () => {
    const full = Array.from({ length: 50 }, (_, i) => proof({ id: `x${i}`, uploadedAt: `2026-10-17T10:${String(i).padStart(2, '0')}:00.000Z` }));
    list.mockReset();
    list.mockResolvedValueOnce({ ok: true, data: full }).mockResolvedValueOnce({ ok: true, data: [proof({ id: 'p1' })] });
    await renderPlayer();
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith({ childId: 'c1', before: full[49].uploadedAt, limit: 50 });
    expect(screen.getByTestId('proof-play')).toBeTruthy();
  });

  it('shows a friendly state when the clip is gone', async () => {
    list.mockResolvedValue({ ok: true, data: [proof({ id: 'other' })] });
    await renderPlayer();
    expect(screen.getByTestId('proof-missing')).toBeTruthy();
    await fireEvent.press(screen.getByText(t.backToList));
    expect(router.back).toHaveBeenCalled();
  });

  it.each([
    ['not_deployed', 'notDeployed'],
    ['forbidden', 'forbidden'],
    ['network', 'network'],
  ])('shows the %s state', async (code, kind) => {
    list.mockResolvedValue({ ok: false, code });
    await renderPlayer();
    expect(screen.getByTestId(`proof-error-${kind}`)).toBeTruthy();
  });

  it('does not offer playback for a clip whose file has not arrived', async () => {
    list.mockResolvedValue({ ok: true, data: [proof({ id: 'p1', objectPresent: false })] });
    await renderPlayer();
    expect(screen.getByTestId('proof-not-uploaded')).toBeTruthy();
    expect(screen.queryByTestId('proof-play')).toBeNull();
    expect(screen.getByTestId('proof-delete')).toBeTruthy(); // can still be deleted
  });
});

describe('ProofPlayerScreen: playback', () => {
  it('makes a signed URL on play, loads it into the player and starts it', async () => {
    await renderPlayer();
    await tapPlay();
    expect(signed).toHaveBeenCalledWith(PATH);
    expect(mockPlayer.replaceAsync).toHaveBeenCalledWith('https://signed.example/v1');
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    const view = screen.getByTestId('video-view');
    expect(view.props.nativeControls).toBe(true);
    expect(view.props.player).toBe(mockPlayer);
  });

  it('marks the clip as viewed once, when playback first starts', async () => {
    await renderPlayer();
    await tapPlay();
    expect(viewed).not.toHaveBeenCalled();
    await emit('playingChange', { isPlaying: true });
    await act(async () => {});
    expect(viewed).toHaveBeenCalledTimes(1);
    expect(viewed).toHaveBeenCalledWith('p1');
    // Pause and play again: still one call.
    await emit('playingChange', { isPlaying: false });
    await emit('playingChange', { isPlaying: true });
    await act(async () => {});
    expect(viewed).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('proof-meta').props.children.join('')).not.toContain(id.proofs.list.isNew);
  });

  it('does not mark a clip that was already watched', async () => {
    list.mockResolvedValue({ ok: true, data: [proof({ id: 'p1', viewedAt: '2026-10-17T09:00:00Z' })] });
    await renderPlayer();
    await tapPlay();
    await emit('playingChange', { isPlaying: true });
    await act(async () => {});
    expect(viewed).not.toHaveBeenCalled();
  });

  it('tries again at the next start when marking failed', async () => {
    viewed.mockResolvedValueOnce({ ok: false, code: 'network' });
    await renderPlayer();
    await tapPlay();
    await emit('playingChange', { isPlaying: true });
    await act(async () => {});
    await emit('playingChange', { isPlaying: true });
    await act(async () => {});
    expect(viewed).toHaveBeenCalledTimes(2);
  });

  it('keeps the same URL when playback resumes before it is old', async () => {
    await renderPlayer();
    await tapPlay();
    await emit('playingChange', { isPlaying: true });
    await emit('playingChange', { isPlaying: false });
    jest.setSystemTime(Date.now() + URL_MAX_AGE_MS - 5_000);
    await emit('playingChange', { isPlaying: true });
    await act(async () => {});
    expect(signed).toHaveBeenCalledTimes(1);
    expect(mockPlayer.replaceAsync).toHaveBeenCalledTimes(1);
  });

  it('makes a new URL when playback restarts after the old one expired, and keeps the position', async () => {
    signed.mockResolvedValueOnce({ ok: true, data: 'https://signed.example/v1' }).mockResolvedValueOnce({ ok: true, data: 'https://signed.example/v2' });
    await renderPlayer();
    await tapPlay();
    await emit('playingChange', { isPlaying: true });
    await emit('playingChange', { isPlaying: false });
    mockPlayer.currentTime = 42;
    jest.setSystemTime(Date.now() + URL_MAX_AGE_MS + 1_000);
    mockPlayer.play.mockClear();
    mockPlayer.pause.mockClear();

    await emit('playingChange', { isPlaying: true });
    await act(async () => {});

    expect(mockPlayer.pause).toHaveBeenCalled();
    expect(signed).toHaveBeenCalledTimes(2);
    expect(mockPlayer.replaceAsync).toHaveBeenLastCalledWith('https://signed.example/v2');
    expect(mockPlayer.currentTime).toBe(42);
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(viewed).toHaveBeenCalledTimes(1); // the refresh is not a second "first start"
  });

  it('makes a new URL when the player fails after the old one expired', async () => {
    signed.mockResolvedValueOnce({ ok: true, data: 'https://signed.example/v1' }).mockResolvedValueOnce({ ok: true, data: 'https://signed.example/v2' });
    await renderPlayer();
    await tapPlay();
    jest.setSystemTime(Date.now() + URL_MAX_AGE_MS + 1_000);
    await emit('statusChange', { status: 'error' });
    await act(async () => {});
    expect(signed).toHaveBeenCalledTimes(2);
    expect(mockPlayer.replaceAsync).toHaveBeenLastCalledWith('https://signed.example/v2');
  });

  it('shows a friendly error and a retry when the URL cannot be made', async () => {
    signed.mockResolvedValue({ ok: false, code: 'not_found' });
    await renderPlayer();
    await tapPlay();
    expect(screen.getByTestId('proof-play-error-gone')).toBeTruthy();
    expect(mockPlayer.replaceAsync).not.toHaveBeenCalled();
    signed.mockResolvedValue({ ok: true, data: 'https://signed.example/v1' });
    await tapPlay();
    expect(mockPlayer.replaceAsync).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('proof-play-error-gone')).toBeNull();
  });

  it('shows the network message when offline', async () => {
    signed.mockResolvedValue({ ok: false, code: 'network' });
    await renderPlayer();
    await tapPlay();
    expect(screen.getByTestId('proof-play-error-network')).toBeTruthy();
  });

  it('never renders the signed URL as text', async () => {
    await renderPlayer();
    await tapPlay();
    expect(screen.queryByText(/signed\.example/)).toBeNull();
  });
});

describe('ProofPlayerScreen: delete', () => {
  it('confirms, deletes and goes back', async () => {
    del.mockResolvedValue({ ok: true, data: { id: 'p1', status: 'deleted', deletedAt: new Date().toISOString() } });
    await renderPlayer();
    await fireEvent.press(screen.getByTestId('proof-delete'));
    expect(del).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('proof-delete-confirm-yes'));
    await act(async () => {});
    expect(del).toHaveBeenCalledWith('p1');
    expect(router.back).toHaveBeenCalled();
  });

  it('stays on the clip when the delete fails', async () => {
    del.mockResolvedValue({ ok: false, code: 'network' });
    await renderPlayer();
    await fireEvent.press(screen.getByTestId('proof-delete'));
    await fireEvent.press(screen.getByTestId('proof-delete-confirm-yes'));
    await act(async () => {});
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByText(id.proofs.list.deleteFailed)).toBeTruthy();
  });

  it('keeps the clip when the user cancels', async () => {
    await renderPlayer();
    await fireEvent.press(screen.getByTestId('proof-delete'));
    await fireEvent.press(screen.getByTestId('proof-delete-confirm-no'));
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByTestId('proof-delete')).toBeTruthy();
  });
});
