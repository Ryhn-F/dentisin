import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import BrushingSession from '@/app/brushing/session';
import { useAccount } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import { DEFAULT_LIMITS, emptyConsentState, type MyAccount } from '@/domain/models';

// ---------------------------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------------------------

const granted = { granted: true, canAskAgain: true, status: 'granted', expires: 'never' };
const mockCam = {
  permission: granted as Record<string, unknown> | null,
  request: jest.fn(),
  recordAsync: jest.fn(),
  stopRecording: jest.fn(),
  toggle: jest.fn(async () => {}),
  pauseSupported: false,
  resolve: null as null | ((v: unknown) => void),
};

jest.mock('expo-camera', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mockReact = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  const CameraView = mockReact.forwardRef(function CameraView(props: Record<string, unknown> & { onCameraReady?: () => void }, ref: unknown) {
    mockReact.useImperativeHandle(ref, () => {
      const handle: Record<string, unknown> = {
        recordAsync: (opts: unknown) => mockCam.recordAsync(opts),
        stopRecording: () => mockCam.stopRecording(),
      };
      if (mockCam.pauseSupported) {
        handle.toggleRecordingAsync = () => mockCam.toggle();
        handle.getSupportedFeatures = () => ({ toggleRecordingAsyncAvailable: true, isModernBarcodeScannerAvailable: false });
      }
      return handle;
    });
    mockReact.useEffect(() => {
      props.onCameraReady?.();
    }, []);
    const { facing, mode, mute, videoQuality, videoBitrate } = props;
    return mockReact.createElement(View, { testID: 'camera-view', facing, mode, mute, videoQuality, videoBitrate });
  });
  return { CameraView, useCameraPermissions: () => [mockCam.permission, mockCam.request] };
});

jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(cb, [cb]);
  },
}));

const mockFinish = jest.fn();
jest.mock('@/features/brushing/finish-session', () => ({
  finishBrushingSession: (...a: unknown[]) => mockFinish(...a),
}));

let mockUpload: Record<string, unknown> | null = null;
let mockUploadItems: Record<string, unknown>[] = [];
jest.mock('@/features/brushing/proof-uploads', () => ({
  startProofUploads: jest.fn(() => () => {}),
  useProofUpload: () => mockUpload,
  useProofUploadStore: (select: (s: { items: Record<string, unknown>[] }) => unknown) => select({ items: mockUploadItems }),
  isActiveUpload: (i: { state: string }) => ['waiting', 'uploading', 'retrying'].includes(i.state),
}));

const mockRemove = jest.fn();
jest.mock('@/features/brushing/proof-files', () => ({
  expoProofFiles: { remove: (...a: unknown[]) => mockRemove(...a), size: jest.fn(() => 1) },
}));

// ---------------------------------------------------------------------------------------------

const t = id.brushing;
const r = id.recording;
const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

const PARENT = '22222222-2222-4222-8222-222222222222';
const CHILD = '33333333-3333-4333-8333-333333333333';
const CHILD_USER = '44444444-4444-4444-8444-444444444444';
const TEEN = '55555555-5555-4555-8555-555555555555';
const SELF = '66666666-6666-4666-8666-666666666666';
const CLIP = 'file:///cache/Camera/clip.mp4';

function childAccount(proofAllowed = true): MyAccount {
  return {
    userId: CHILD_USER,
    accountType: 'child',
    roles: ['child'],
    selfChildId: null,
    childAccounts: null,
    childAccount: { childId: CHILD, guardianId: PARENT, username: 'si.budi', disabled: false, syncAllowed: true, proofAllowed },
    flags: { brushingProofVideo: true },
    capabilities: { createChildAccounts: false, registerProofs: proofAllowed },
    limits: DEFAULT_LIMITS,
  };
}

function teenAccount(): MyAccount {
  return {
    userId: TEEN,
    accountType: 'teen',
    roles: ['guardian'],
    selfChildId: SELF,
    childAccounts: 0,
    childAccount: null,
    flags: { brushingProofVideo: true },
    capabilities: { createChildAccounts: false, registerProofs: true },
    limits: DEFAULT_LIMITS,
  };
}

function signIn(me: MyAccount, childId: string, consents = { ...emptyConsentState }) {
  useSession.setState({ status: 'signedIn', userId: me.userId });
  useAccount.setState({ me, userId: me.userId, status: 'ready' });
  useLocalData.setState({
    activeChildId: childId,
    kids: [{ id: childId, nickname: 'Budi', birthYear: null, birthMonth: null, allergies: [], isSelf: me.accountType === 'teen' }],
    consents: { [childId]: consents },
    syncBlocked: {},
  });
}

function guest() {
  useSession.setState({ status: 'guest', userId: null });
  useAccount.setState({ me: null, userId: null, status: 'idle' });
  useLocalData.setState({
    activeChildId: CHILD,
    kids: [{ id: CHILD, nickname: 'Budi', birthYear: null, birthMonth: null, allergies: [] }],
    consents: { [CHILD]: { ...emptyConsentState } },
    syncBlocked: {},
  });
}

async function renderScreen() {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <BrushingSession />
    </SafeAreaProvider>,
  );
}

// Advances the fake clock in a few big steps (not one act per second): fast enough to stay far
// below the test timeout under the parallel load of the full suite.
const TICK_CHUNK_S = 30;
async function tick(seconds: number) {
  for (let left = seconds; left > 0; left -= TICK_CHUNK_S) {
    const step = Math.min(TICK_CHUNK_S, left);
    await act(async () => {
      jest.advanceTimersByTime(step * 1000);
    });
  }
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-18T07:00:00Z') });
  mockCam.permission = granted;
  mockCam.pauseSupported = false;
  mockCam.request.mockReset().mockResolvedValue(granted);
  mockCam.toggle.mockClear();
  mockCam.recordAsync.mockReset().mockImplementation(
    () =>
      new Promise((resolve) => {
        mockCam.resolve = resolve;
      }),
  );
  mockCam.stopRecording.mockReset().mockImplementation(() => mockCam.resolve?.({ uri: CLIP }));
  mockFinish.mockReset().mockResolvedValue({ brushing: null, proof: { kind: 'none' } });
  mockRemove.mockReset();
  mockUpload = null;
  mockUploadItems = [];
  useLocalData.setState({ brushing: [] });
});

afterEach(async () => {
  // Unmount and drop pending timers before the real clock returns, so a slow or failed test can
  // never leak its interval into the next one.
  await cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('BrushingSession: timer mode (unchanged)', () => {
  it('guest: ring + zone guide, no camera, records the finished session', async () => {
    guest();
    await renderScreen();
    expect(screen.getByText('2:00')).toBeTruthy();
    expect(screen.getByText(`${t.zoneNow} ${t.zones[0]}`)).toBeTruthy();
    expect(screen.getByText(t.noCamera)).toBeTruthy();
    expect(screen.queryByTestId('record-toggle')).toBeNull();

    await fireEvent.press(screen.getByText(t.start));
    expect(screen.getByText(t.pause)).toBeTruthy();
    await tick(31);
    expect(screen.getByText('1:29')).toBeTruthy();
    expect(screen.getByText(`${t.zoneNow} ${t.zones[1]}`)).toBeTruthy();
    expect(screen.queryByTestId('camera-view')).toBeNull();

    await tick(89);
    await flush();
    expect(screen.getByText(t.doneTitle)).toBeTruthy();
    expect(mockFinish).toHaveBeenCalledTimes(1);
    expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ childId: CHILD, elapsedS: 120, clip: null, target: null }));
  });

  it('pause, resume and finish early behave as before', async () => {
    guest();
    await renderScreen();
    await fireEvent.press(screen.getByText(t.start));
    await tick(12);
    await fireEvent.press(screen.getByText(t.pause));
    await tick(5);
    expect(screen.getByText('1:48')).toBeTruthy();
    expect(screen.getByText(t.resume)).toBeTruthy();
    await fireEvent.press(screen.getByText(t.finishEarly));
    await flush();
    expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ elapsedS: 12, clip: null }));
    expect(screen.getByText(t.doneTitle)).toBeTruthy();
  });
});

describe('BrushingSession: camera mode', () => {
  it('child account: switch ON by default with the note, records muted 480p video with the same instructions', async () => {
    signIn(childAccount(), CHILD);
    await renderScreen();
    expect(screen.getByText(r.toggleParent)).toBeTruthy();
    expect(screen.getByText(r.noteParent(7))).toBeTruthy();
    expect(screen.getByTestId('record-toggle').props.accessibilityState).toEqual({ checked: true });

    await fireEvent.press(screen.getByText(t.start));
    await flush();
    const camera = screen.getByTestId('camera-view');
    expect(camera.props).toMatchObject({ facing: 'front', mode: 'video', mute: true, videoQuality: '480p', videoBitrate: 400_000 });
    // jest-expo runs as iOS here, where the codec is passed so videoBitrate applies.
    expect(mockCam.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({ maxDuration: 180, maxFileSize: Math.floor(DEFAULT_LIMITS.proofMaxBytes * 0.97) }),
    );
    expect(screen.getByTestId('recording-indicator').props.accessibilityLabel).toBe(r.recordingLabel);
    expect(screen.getByText(`${t.zoneNow} ${t.zones[0]}`)).toBeTruthy();
    // No pause/resume support in this camera: "Selesai" instead of "Jeda".
    expect(screen.queryByText(t.pause)).toBeNull();
    expect(screen.getByTestId('brushing-finish')).toBeTruthy();

    await tick(31);
    expect(screen.getByText(`${t.zoneNow} ${t.zones[1]}`)).toBeTruthy();
    expect(screen.getByText('1:29')).toBeTruthy();

    mockFinish.mockResolvedValue({ brushing: null, proof: { kind: 'queued', proofId: 'p1', audience: 'parent' } });
    mockUpload = { state: 'uploading', progress: 0.42, failure: null };
    await fireEvent.press(screen.getByTestId('brushing-finish'));
    await flush();
    expect(mockCam.stopRecording).toHaveBeenCalled();
    expect(mockFinish).toHaveBeenCalledWith(
      expect.objectContaining({
        elapsedS: 31,
        clip: { uri: CLIP, durationS: 31 },
        target: expect.objectContaining({ childId: CHILD, ownerId: PARENT, audience: 'parent' }),
        userId: CHILD_USER,
      }),
    );
    expect(screen.getByText(t.doneTitle)).toBeTruthy();
    expect(screen.getByText(r.status.uploading(42))).toBeTruthy();
    expect(screen.queryByTestId('camera-view')).toBeNull();
  });

  it('reaching the target stops the recording and hands over the clip', async () => {
    signIn(childAccount(), CHILD);
    await renderScreen();
    await fireEvent.press(screen.getByText(t.start));
    await flush();
    await tick(120);
    await flush();
    expect(mockCam.stopRecording).toHaveBeenCalledTimes(1);
    expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ elapsedS: 120, clip: { uri: CLIP, durationS: 120 } }));
  });

  it('switch OFF -> timer mode', async () => {
    signIn(childAccount(), CHILD);
    await renderScreen();
    await fireEvent.press(screen.getByTestId('record-toggle'));
    expect(screen.getByText(t.noCamera)).toBeTruthy();
    await fireEvent.press(screen.getByText(t.start));
    expect(screen.queryByTestId('camera-view')).toBeNull();
    expect(mockCam.recordAsync).not.toHaveBeenCalled();
  });

  it('teen without consent (d): explains how to turn it on and brushes with the timer', async () => {
    signIn(teenAccount(), SELF, { a: true, b: true, c: false, d: false });
    await renderScreen();
    expect(screen.queryByTestId('record-toggle')).toBeNull();
    expect(screen.getByText(r.unavailable.noConsent)).toBeTruthy();
  });

  it('teen with consents (b) and (d): the switch says the video is for themself', async () => {
    signIn(teenAccount(), SELF, { a: true, b: true, c: false, d: true });
    await renderScreen();
    expect(screen.getByText(r.toggleSelf)).toBeTruthy();
    expect(screen.getByText(r.noteSelf(7))).toBeTruthy();
  });

  it('child account without proof_allowed: no switch, a hint for the parent', async () => {
    signIn(childAccount(false), CHILD);
    await renderScreen();
    expect(screen.queryByTestId('record-toggle')).toBeNull();
    expect(screen.getByText(r.unavailable.proofNotAllowed)).toBeTruthy();
    await fireEvent.press(screen.getByText(t.start));
    expect(screen.getByText(t.pause)).toBeTruthy();
    expect(screen.queryByTestId('camera-view')).toBeNull();
  });

  it('daily clip limit reached: no switch, friendly note, timer brushing still works', async () => {
    signIn(childAccount(), CHILD);
    // Three proofs of this child today (WIB), recorded earlier on this phone.
    useLocalData.setState({
      brushing: [1, 2, 3].map((n) => ({
        id: `b${n}`,
        childId: CHILD,
        startedAt: '2026-10-18T01:00:00Z',
        durationS: 120,
        spiritScore: null,
        slot: 'morning',
        cameraMode: true,
        synced: false,
        proofId: `aaaaaaaa-0000-4000-8000-00000000000${n}`,
      })),
    });
    await renderScreen();
    expect(screen.queryByTestId('record-toggle')).toBeNull();
    expect(screen.getByText(r.unavailable.dailyLimit(DEFAULT_LIMITS.proofMaxPerChildPerDay))).toBeTruthy();
    await fireEvent.press(screen.getByText(t.start));
    expect(screen.queryByTestId('camera-view')).toBeNull();
    expect(mockCam.recordAsync).not.toHaveBeenCalled();
  });

  it('guardians never get the switch', async () => {
    const me: MyAccount = { ...teenAccount(), userId: PARENT, accountType: 'guardian', selfChildId: null };
    signIn(me, CHILD, { a: true, b: true, c: false, d: true });
    await renderScreen();
    expect(screen.queryByTestId('record-toggle')).toBeNull();
    expect(screen.getByText(t.noCamera)).toBeTruthy();
  });

  it('guardians use front-camera mirror mode without recording proof', async () => {
    const me: MyAccount = { ...teenAccount(), userId: PARENT, accountType: 'guardian', selfChildId: null };
    signIn(me, CHILD, { a: true, b: true, c: false, d: true });
    await renderScreen();
    await fireEvent.press(screen.getByText(t.start));
    await flush();
    expect(screen.getByTestId('camera-view')).toBeTruthy();
    expect(mockCam.recordAsync).not.toHaveBeenCalled();
    expect(screen.queryByTestId('recording-indicator')).toBeNull();
    expect(screen.getByText(t.pause)).toBeTruthy();

    await tick(120);
    await flush();
    expect(screen.getByText(t.doneTitle)).toBeTruthy();
    expect(mockFinish).toHaveBeenCalledWith(
      expect.objectContaining({
        childId: CHILD,
        elapsedS: 120,
        clip: null,
        target: null,
        cameraMode: true,
      }),
    );
  });

  it('asks for the camera with an explanation; "timer only" never blocks brushing', async () => {
    mockCam.permission = { granted: false, canAskAgain: true, status: 'undetermined', expires: 'never' };
    signIn(childAccount(), CHILD);
    await renderScreen();
    await fireEvent.press(screen.getByText(t.start));
    expect(screen.getByText(r.permissionBody)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('camera-permission-skip'));
    expect(screen.getByText(t.pause)).toBeTruthy();
    expect(screen.queryByTestId('camera-view')).toBeNull();
  });

  it('permission denied in the system prompt -> timer mode with a note', async () => {
    mockCam.permission = { granted: false, canAskAgain: true, status: 'undetermined', expires: 'never' };
    mockCam.request.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied', expires: 'never' });
    signIn(childAccount(), CHILD);
    await renderScreen();
    await fireEvent.press(screen.getByText(t.start));
    await fireEvent.press(screen.getByTestId('camera-permission-allow'));
    await flush();
    expect(screen.getByText(r.permissionDenied)).toBeTruthy();
    expect(screen.getByText(t.pause)).toBeTruthy();
    expect(mockCam.recordAsync).not.toHaveBeenCalled();
  });

  it('permission granted in the system prompt -> camera mode', async () => {
    mockCam.permission = { granted: false, canAskAgain: true, status: 'undetermined', expires: 'never' };
    signIn(childAccount(), CHILD);
    await renderScreen();
    await fireEvent.press(screen.getByText(t.start));
    await fireEvent.press(screen.getByTestId('camera-permission-allow'));
    await flush();
    expect(mockCam.request).toHaveBeenCalled();
    expect(screen.getByTestId('camera-view')).toBeTruthy();
  });

  it('a camera error falls back to the timer; the session keeps counting', async () => {
    mockCam.recordAsync.mockImplementation(() => Promise.reject(new Error('camera')));
    signIn(childAccount(), CHILD);
    await renderScreen();
    await fireEvent.press(screen.getByText(t.start));
    await flush();
    expect(screen.queryByTestId('camera-view')).toBeNull();
    expect(screen.getByText(r.cameraFailed)).toBeTruthy();
    await tick(20);
    await fireEvent.press(screen.getByText(t.pause));
    await fireEvent.press(screen.getByText(t.finishEarly));
    await flush();
    expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ elapsedS: 20, clip: null }));
  });

  it('pauses and resumes the recording when the camera supports it', async () => {
    mockCam.pauseSupported = true;
    signIn(childAccount(), CHILD);
    await renderScreen();
    await fireEvent.press(screen.getByText(t.start));
    await flush();
    await tick(15);
    await fireEvent.press(screen.getByText(t.pause));
    await flush();
    expect(mockCam.toggle).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('recording-indicator').props.accessibilityLabel).toBe(r.pausedLabel);
    await tick(10);
    await fireEvent.press(screen.getByText(t.resume));
    await flush();
    expect(mockCam.toggle).toHaveBeenCalledTimes(2);
    await tick(5);
    await fireEvent.press(screen.getByText(t.pause));
    await flush();
    await fireEvent.press(screen.getByText(t.finishEarly));
    await flush();
    // 20 s brushed; the 10 s pause is not part of the clip.
    expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ elapsedS: 20, clip: { uri: CLIP, durationS: 20 } }));
  });

  it('a recording that stopped on its own is deleted when the session is closed early', async () => {
    signIn(childAccount(), CHILD);
    await renderScreen();
    await fireEvent.press(screen.getByText(t.start));
    await flush();
    await tick(10);
    // Size/duration limit or app in the background: the recorder ends by itself with a file.
    await act(async () => {
      mockCam.resolve?.({ uri: CLIP });
      await Promise.resolve();
    });
    expect(screen.getByText(r.recordingStopped)).toBeTruthy();
    expect(screen.queryByTestId('camera-view')).toBeNull();
    expect(mockRemove).not.toHaveBeenCalled();
    // The user closes the session before it is done: finishSession never runs.
    await act(async () => {
      screen.unmount();
    });
    expect(mockRemove).toHaveBeenCalledWith(CLIP);
    expect(mockFinish).not.toHaveBeenCalled();
  });

  it('a clip that stopped on its own is still handed over when the session finishes', async () => {
    signIn(childAccount(), CHILD);
    await renderScreen();
    await fireEvent.press(screen.getByText(t.start));
    await flush();
    await tick(10);
    await act(async () => {
      mockCam.resolve?.({ uri: CLIP });
      await Promise.resolve();
    });
    await tick(110);
    await flush();
    expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ elapsedS: 120, clip: expect.objectContaining({ uri: CLIP }) }));
    await act(async () => {
      screen.unmount();
    });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('leaving mid-session deletes the clip and records nothing', async () => {
    signIn(childAccount(), CHILD);
    await renderScreen();
    await fireEvent.press(screen.getByText(t.start));
    await flush();
    await tick(5);
    await act(async () => {
      screen.unmount();
    });
    // The camera unmount finalizes the recording.
    await act(async () => {
      mockCam.resolve?.({ uri: CLIP });
      await Promise.resolve();
    });
    expect(mockRemove).toHaveBeenCalledWith(CLIP);
    expect(mockFinish).not.toHaveBeenCalled();
  });
});
