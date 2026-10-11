import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Text, TextClassContext } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { palette, useIsScreenFocused, useLightStatusBar, useTheme } from '@/core/theme';
import { CameraOverlay } from '@/features/screening/components/camera-overlay';
import { FRAME_ASPECT, type FrameRect } from '@/features/screening/components/mouth-guide';
import { recordQualityCheck } from '@/features/screening/quality-log';
import { useScreeningSession } from '@/features/screening/session-store';
import { choosePictureSize, frameToCrop, preparePhoto } from '@/ml/photo';
import { evaluateQuality } from '@/ml/quality-gate';
import { cn } from '@/lib/utils';

const t = id.screening.camera;
const COUNTDOWN_S = 3;
const TOP_BAR = 64;
const CONTROLS = 156;

function KeepScreenOn() {
  useKeepAwake('screening-camera');
  return null;
}

// Round control with a text label under it (icon + text, never icon alone).
function CamButton({
  icon,
  label,
  a11yLabel,
  onPress,
  on = false,
  disabled = false,
  testID,
}: {
  icon: IconName;
  label: string;
  a11yLabel?: string;
  onPress: () => void;
  on?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const { touch } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={{ disabled, selected: on }}
      disabled={disabled}
      onPress={onPress}
      className={cn('items-center gap-1', disabled && 'opacity-40')}
      style={{ minWidth: touch.large + 16 }}
    >
      <View
        className={cn('items-center justify-center rounded-full', on && 'bg-sun')}
        style={{ width: touch.large, height: touch.large, backgroundColor: on ? undefined : palette.scrimStrong }}
      >
        <Icon name={icon} size={26} color={on ? palette.onAccent : palette.onPrimary} />
      </View>
      <Text variant="label" style={{ color: palette.onPrimary }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function Pill({ icon, label, warn = false }: { icon: IconName; label: string; warn?: boolean }) {
  return (
    <View
      className="flex-row items-center gap-1.5 rounded-full py-1.5 pl-2.5 pr-3"
      style={{ backgroundColor: warn ? palette.accent : palette.scrimStrong }}
    >
      <Icon name={icon} size={16} color={warn ? palette.onAccent : palette.onPrimary} />
      <Text variant="label" style={{ color: warn ? palette.onAccent : palette.onPrimary, fontSize: 13, lineHeight: 18 }}>
        {label}
      </Text>
    </View>
  );
}

function PermissionGate({ canAskAgain, onRequest }: { canAskAgain: boolean; onRequest: () => void }) {
  return (
    <View className="flex-1 justify-center gap-4 px-6">
      <Icon name="photo-camera" size={48} color={palette.onPrimary} />
      <Text variant="title" accessibilityRole="header">
        {t.permissionTitle}
      </Text>
      <Text variant="body">{canAskAgain ? t.permissionBody : t.permissionDenied}</Text>
      {canAskAgain ? (
        <Button testID="camera-permission" title={t.permissionAction} variant="accent" onPress={onRequest} />
      ) : (
        <Button title={t.permissionSettings} variant="accent" onPress={() => Linking.openSettings().catch(() => {})} />
      )}
      <Button title={id.common.back} variant="ghost" className="self-center" onPress={() => router.back()} />
    </View>
  );
}

// Step 3b: guided capture. Preview in an exact 3:4 box so the on-screen frame maps onto photo
// pixels (the stored photo is cropped to the mouth region: no eyes or face kept). Torch on by
// default (rear camera), optional 3-second countdown so pressing the button does not shake
// the picture. The camera is unmounted whenever this screen is not focused (Android has no
// `active` prop), which also switches the torch off.
export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const focused = useIsScreenFocused();
  useLightStatusBar();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const countdownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [torch, setTorch] = useState(true);
  const [timerOn, setTimerOn] = useState(true);
  const [ready, setReady] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mountFailed, setMountFailed] = useState(false);
  const setCapture = useScreeningSession((s) => s.setCapture);

  // Geometry: 3:4 preview under the top bar; the frame sits in the part not covered by controls.
  const view = { x: 0, y: insets.top + TOP_BAR, width, height: Math.round((width * 4) / 3) };
  const controlsTop = height - insets.bottom - CONTROLS;
  const visibleBottom = Math.min(view.y + view.height, controlsTop);
  const frameW = Math.round(Math.min(width * 0.84, 440));
  const frameH = Math.round(frameW * FRAME_ASPECT);
  const frame: FrameRect = {
    x: Math.round((width - frameW) / 2),
    y: Math.round(view.y + (visibleBottom - view.y - frameH) / 2 - 16),
    width: frameW,
    height: frameH,
  };
  const back = facing === 'back';

  // Leaving the screen (review pushed, back gesture, unmount) cancels a running countdown; the
  // camera remounts on return, so it is not ready until it reports ready again.
  useFocusEffect(
    useCallback(
      () => () => {
        if (countdownTimer.current) clearTimeout(countdownTimer.current);
        countdownTimer.current = null;
        setCount(null);
        setReady(false);
      },
      [],
    ),
  );

  async function onCameraReady() {
    setReady(true);
    if (pictureSize) return;
    try {
      const sizes = (await camera.current?.getAvailablePictureSizesAsync()) ?? [];
      setPictureSize(choosePictureSize(sizes));
    } catch {
      // Keep the default size (web, or devices that do not report sizes).
    }
  }

  async function capture() {
    const cam = camera.current;
    if (!cam || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const raw = await cam.takePictureAsync({ quality: 0.9, exif: false });
      const prepared = await preparePhoto(raw, frameToCrop(raw, view, frame));
      const quality = evaluateQuality(prepared.pixels);
      void recordQualityCheck(quality.reasons);
      setCapture(prepared, quality);
      router.push('/screening/review');
    } catch {
      setError(t.captureFailed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function cancelCountdown() {
    if (countdownTimer.current) clearTimeout(countdownTimer.current);
    countdownTimer.current = null;
    setCount(null);
  }

  function onShutter() {
    if (count !== null) {
      cancelCountdown();
      return;
    }
    if (!timerOn) {
      void capture();
      return;
    }
    let n = COUNTDOWN_S;
    setCount(n);
    const tick = () => {
      n -= 1;
      if (n <= 0) {
        countdownTimer.current = null;
        setCount(null);
        void capture();
      } else {
        setCount(n);
        countdownTimer.current = setTimeout(tick, 1000);
      }
    };
    countdownTimer.current = setTimeout(tick, 1000);
  }

  const granted = permission?.granted ?? false;

  return (
    <TextClassContext.Provider value="text-primary-on">
      <View testID="screening-camera" className="flex-1" style={{ backgroundColor: palette.cameraBg }}>
        {focused ? <KeepScreenOn /> : null}

        {!permission ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={palette.onPrimary} />
          </View>
        ) : !granted ? (
          <PermissionGate canAskAgain={permission.canAskAgain} onRequest={() => void requestPermission()} />
        ) : mountFailed ? (
          <View className="flex-1 justify-center gap-4 px-6">
            <Text variant="title">{t.unavailable}</Text>
            <Button title={id.common.back} variant="accent" onPress={() => router.back()} />
          </View>
        ) : (
          <>
            <View style={{ position: 'absolute', left: view.x, top: view.y, width: view.width, height: view.height }}>
              {focused ? (
                <CameraView
                  ref={camera}
                  style={{ flex: 1 }}
                  facing={facing}
                  mode="picture"
                  ratio="4:3"
                  pictureSize={pictureSize}
                  enableTorch={back && torch && ready}
                  animateShutter
                  onCameraReady={() => void onCameraReady()}
                  onMountError={() => setMountFailed(true)}
                />
              ) : null}
            </View>
            <CameraOverlay width={width} height={height} frame={frame} highlight={count !== null} />

            {/* Reminders: the torch pill reflects the real torch state. */}
            <View
              accessible
              accessibilityLabel={`${t.checklistLabel}: ${back ? (torch ? t.checkTorchOn : t.checkTorchOff) : t.checkFront}, ${t.checkLips}, ${t.checkSteady}`}
              className="absolute flex-row flex-wrap justify-center gap-2 px-4"
              style={{ top: view.y + 12, left: 0, right: 0 }}
            >
              {back ? (
                <Pill icon={torch ? 'flashlight-on' : 'flashlight-off'} label={torch ? t.checkTorchOn : t.checkTorchOff} warn={!torch} />
              ) : (
                <Pill icon="wb-sunny" label={t.checkFront} warn />
              )}
              <Pill icon="mood" label={t.checkLips} />
              <Pill icon="pan-tool" label={t.checkSteady} />
            </View>

            {count !== null ? (
              <View
                className="absolute items-center justify-center"
                style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
                pointerEvents="none"
              >
                <View
                  className="size-24 items-center justify-center rounded-full"
                  style={{ backgroundColor: palette.scrimStrong }}
                  accessible
                  accessibilityLabel={t.countdownLabel(count)}
                  accessibilityLiveRegion="assertive"
                >
                  <Text variant="hero">{count}</Text>
                </View>
              </View>
            ) : null}

            <View className="absolute items-center gap-2 px-6" style={{ top: frame.y + frame.height + 12, left: 0, right: 0 }}>
              <View className="rounded-full px-4 py-2" style={{ backgroundColor: palette.scrimStrong }}>
                <Text variant="bodyStrong" className="text-center">
                  {count !== null ? t.countdownLabel(count) : t.frameHint}
                </Text>
              </View>
              {!back ? (
                <Text variant="caption" className="text-center" style={{ color: palette.onPrimary }}>
                  {t.frontNote}
                </Text>
              ) : null}
              {error ? (
                <View
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  className="rounded-full px-4 py-2"
                  style={{ backgroundColor: palette.accent }}
                >
                  <Text variant="label" tone="onAccent">
                    {error}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Bottom controls on a solid panel so labels stay readable over any preview. */}
            <View
              className="absolute left-0 right-0 flex-row items-start justify-around px-4 pt-3"
              style={{ top: controlsTop, height: CONTROLS + insets.bottom, paddingBottom: insets.bottom, backgroundColor: palette.scrimStrong }}
            >
              <CamButton
                testID="camera-timer"
                icon={timerOn ? 'timer' : 'timer-off'}
                label={t.timer}
                a11yLabel={timerOn ? t.timerOn : t.timerOff}
                on={timerOn}
                disabled={busy || count !== null}
                onPress={() => setTimerOn((v) => !v)}
              />
              <Pressable
                testID="camera-shutter"
                accessibilityRole="button"
                accessibilityLabel={count !== null ? t.cancelCountdown : t.shutter}
                accessibilityState={{ disabled: !ready || busy, busy }}
                disabled={!ready || busy}
                onPress={onShutter}
                className={cn('items-center gap-1', (!ready || busy) && 'opacity-50')}
              >
                <View
                  className="size-20 items-center justify-center rounded-full border-4 border-card"
                  style={{ backgroundColor: count !== null ? palette.coral : palette.accent }}
                >
                  <Icon name={count !== null ? 'close' : 'photo-camera'} size={34} color={palette.onAccent} />
                </View>
                <Text variant="label" style={{ color: palette.onPrimary }}>
                  {count !== null ? id.common.cancel : t.shutter}
                </Text>
              </Pressable>
              <CamButton
                testID="camera-flip"
                icon="flip-camera-android"
                label={t.flip}
                disabled={busy || count !== null}
                onPress={() => {
                  setReady(false);
                  setFacing((f) => (f === 'back' ? 'front' : 'back'));
                }}
              />
            </View>

            {busy ? (
              <View
                className="absolute inset-0 items-center justify-center gap-3"
                style={{ backgroundColor: palette.scrimStrong }}
                accessibilityLiveRegion="polite"
              >
                <ActivityIndicator size="large" color={palette.onPrimary} />
                <Text variant="headline">{t.processing}</Text>
              </View>
            ) : null}
          </>
        )}

        {/* Top bar: close and torch, always reachable. */}
        <View
          className="absolute left-0 right-0 flex-row items-center justify-between px-3"
          style={{ top: insets.top, height: TOP_BAR }}
        >
          <Pressable
            testID="camera-close"
            accessibilityRole="button"
            accessibilityLabel={t.close}
            onPress={() => router.back()}
            className="size-12 items-center justify-center rounded-full"
            style={{ backgroundColor: palette.scrimStrong }}
          >
            <Icon name="close" size={26} color={palette.onPrimary} />
          </Pressable>
          {granted && back ? (
            <Pressable
              testID="camera-torch"
              accessibilityRole="switch"
              accessibilityLabel={t.torch}
              accessibilityHint={torch ? t.torchOn : t.torchOff}
              accessibilityState={{ checked: torch }}
              onPress={() => setTorch((v) => !v)}
              className={cn('h-12 flex-row items-center gap-1.5 rounded-full px-4', torch && 'bg-sun')}
              style={{ backgroundColor: torch ? undefined : palette.scrimStrong }}
            >
              <Icon name={torch ? 'flashlight-on' : 'flashlight-off'} size={22} color={torch ? palette.onAccent : palette.onPrimary} />
              <Text variant="label" style={{ color: torch ? palette.onAccent : palette.onPrimary }}>
                {t.torch}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </TextClassContext.Provider>
  );
}
