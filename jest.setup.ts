// Reanimated 4 test helpers (fake timers for animations, toHaveAnimatedStyle).
// The worklets resolver in package.json "jest" swaps the native runtime for JS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('react-native-reanimated').setUpTests();

// expo-video: the native player does not exist under Jest. VideoView renders a plain View
// (props are kept so tests can query testID / accessibility), and useVideoPlayer returns a
// stub player whose methods are jest.fn().
jest.mock('expo-video', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mockReact = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  function makePlayer() {
    return {
      play: jest.fn(),
      pause: jest.fn(),
      replace: jest.fn(),
      replaceAsync: jest.fn(async () => {}),
      release: jest.fn(),
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      currentTime: 0,
      duration: 0,
      playing: false,
      muted: false,
      loop: false,
      status: 'idle',
    };
  }
  return {
    VideoView: (props: Record<string, unknown>) => mockReact.createElement(View, { testID: 'video-view', ...props }),
    useVideoPlayer: (_source: unknown, setup?: (player: ReturnType<typeof makePlayer>) => void) => {
      const ref = mockReact.useRef(null);
      if (!ref.current) {
        ref.current = makePlayer();
        setup?.(ref.current);
      }
      return ref.current;
    },
    createVideoPlayer: () => makePlayer(),
    isPictureInPictureSupported: () => false,
  };
});

// expo-audio: no native player under Jest; useAudioPlayer returns one shared stub so tests can
// check which clip was played (require() of a .wav resolves to a number under jest-expo).
jest.mock('expo-audio', () => {
  const player = { replace: jest.fn(), play: jest.fn(), pause: jest.fn(), release: jest.fn() };
  return { useAudioPlayer: () => player, __player: player };
});

// expo-crypto: randomUUID, getRandomValues, and digest from Node (matching native module behaviour).
jest.mock('expo-crypto', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('node:crypto');
  return {
    randomUUID: () => nodeCrypto.randomUUID(),
    getRandomValues: (array: any) => nodeCrypto.getRandomValues(array),
    getRandomBytes: (count: number) => nodeCrypto.randomBytes(count),
    digest: async (algo: string, data: any) => {
      const normalized = algo.replace('-', '').toLowerCase();
      const hash = nodeCrypto.createHash(normalized);
      hash.update(Buffer.from(data.buffer ? data : Buffer.from(data)));
      const buf = hash.digest();
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    digestStringAsync: async (algo: string, str: string) => {
      const normalized = algo.replace('-', '').toLowerCase();
      const hash = nodeCrypto.createHash(normalized);
      hash.update(str);
      return hash.digest('hex');
    },
    CryptoDigestAlgorithm: {
      SHA1: 'SHA-1',
      SHA256: 'SHA-256',
      SHA384: 'SHA-384',
      SHA512: 'SHA-512',
    },
  };
});

// expo-camera: default mock so screens that record video (CameraView ref with recordAsync /
// stopRecording) render under Jest. Test files that need custom behaviour still declare their
// own jest.mock('expo-camera', ...), which replaces this one.
jest.mock('expo-camera', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mockReact = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  const CameraView = mockReact.forwardRef(function CameraView(
    props: { onCameraReady?: () => void } & Record<string, unknown>,
    ref: unknown,
  ) {
    const resolveRecording = mockReact.useRef(null);
    mockReact.useImperativeHandle(ref, () => ({
      takePictureAsync: jest.fn(async () => ({ uri: 'file:///mock/photo.jpg', width: 1080, height: 1440 })),
      recordAsync: jest.fn(
        () =>
          new Promise((resolve) => {
            resolveRecording.current = resolve;
          }),
      ),
      stopRecording: jest.fn(() => {
        const resolve = resolveRecording.current;
        resolveRecording.current = null;
        if (typeof resolve === 'function') resolve({ uri: 'file:///mock/video.mp4' });
      }),
      pausePreview: jest.fn(async () => {}),
      resumePreview: jest.fn(async () => {}),
      // Pause / resume while recording (expo-camera 57; the Android module always reports true).
      toggleRecordingAsync: jest.fn(async () => {}),
      getSupportedFeatures: jest.fn(() => ({ isModernBarcodeScannerAvailable: false, toggleRecordingAsyncAvailable: true })),
    }));
    mockReact.useEffect(() => {
      props.onCameraReady?.();
    }, []);
    return mockReact.createElement(View, { testID: 'camera-view' });
  });
  const granted = { granted: true, canAskAgain: true, status: 'granted', expires: 'never' };
  return {
    CameraView,
    useCameraPermissions: () => [granted, jest.fn(async () => granted)],
    useMicrophonePermissions: () => [granted, jest.fn(async () => granted)],
    Camera: {
      requestCameraPermissionsAsync: jest.fn(async () => granted),
      requestMicrophonePermissionsAsync: jest.fn(async () => granted),
    },
  };
});
