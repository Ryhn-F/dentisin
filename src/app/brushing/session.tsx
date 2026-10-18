import { CameraView, useCameraPermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import { Stack, router } from 'expo-router';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '@/components/banner';
import { Blob, Ring, Sparkle } from '@/components/decor';
import { Mascot } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { Text, TextClassContext } from '@/components/ui/text';
import { useLimits, useMe } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { onPrimaryHeaderOptions, palette, useLightStatusBar } from '@/core/theme';
import { useLocalData } from '@/data/local-store';
import { TARGET_DURATION_S, clipSeconds, proofRecordingLimits } from '@/features/brushing/brushing-session';
import { cameraAvailability, type CameraUnavailableReason } from '@/features/brushing/camera-availability';
import { BrushingInstructions } from '@/features/brushing/components/brushing-guide';
import { CameraStage } from '@/features/brushing/components/camera-stage';
import { ProofStatus } from '@/features/brushing/components/proof-status';
import { RecordToggle } from '@/features/brushing/components/record-toggle';
import { finishBrushingSession, type FinishResult, type ProofTarget, type RecordedClip } from '@/features/brushing/finish-session';
import { expoProofFiles } from '@/features/brushing/proof-files';
import { proofCountsToday } from '@/features/brushing/proof-quota';
import { startProofUploads, useProofUploadStore } from '@/features/brushing/proof-uploads';

const t = id.brushing;
const r = id.recording;
const HEADER_BAR = 56;
/** The camera must report ready within this time, otherwise the session goes on as a timer. */
const CAMERA_START_TIMEOUT_MS = 10_000;
/** Waiting for the recorder to write the file after stop. */
const STOP_TIMEOUT_MS = 5_000;

type Phase = 'idle' | 'permission' | 'starting' | 'running' | 'paused' | 'done';
type Mode = 'timer' | 'camera';
type Notice = 'cameraFailed' | 'recordingStopped' | 'permissionDenied';

/** One recording (camera mode). Lives in a ref: the native promise outlives renders. */
type Recording = {
  promise: Promise<void>;
  startedAt: number;
  pausedMs: number;
  pausedAt: number | null;
  maxDuration: number;
  clip: RecordedClip | null;
  ended: boolean;
  /** finish() stopped waiting for it: a late file is deleted. */
  abandoned: boolean;
};

const noticeText: Record<Notice, string> = {
  cameraFailed: r.cameraFailed,
  recordingStopped: r.recordingStopped,
  permissionDenied: r.permissionDenied,
};

/** Reasons worth telling the person why there is no video switch (they can act on them). */
const unavailableHint: Partial<Record<CameraUnavailableReason, string>> = {
  proof_not_allowed: r.unavailable.proofNotAllowed,
  no_consent: r.unavailable.noConsent,
  permission_denied: r.unavailable.permissionDenied,
  camera_error: r.unavailable.cameraError,
};

// A 2-minute session must not be cut off by the phone's screen timeout.
function KeepScreenOn() {
  useKeepAwake('brushing-session');
  return null;
}

function supportsPause(cam: CameraView): boolean {
  // expo-camera 57: pause/resume via toggleRecordingAsync (Android: CameraX pause/resume;
  // iOS 18+ only). Unsupported -> no pause button in camera mode, "Selesai" stays.
  if (typeof cam.toggleRecordingAsync !== 'function' || typeof cam.getSupportedFeatures !== 'function') return false;
  try {
    return cam.getSupportedFeatures().toggleRecordingAsyncAvailable === true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Brushing session: the same instructions (remaining-time ring + four 30-second mouth zones) in
// timer mode and in camera mode. Camera mode records a muted proof video for the parent (child
// account) or for the teen themself (ACCOUNTS_AND_FLOWS.md §2.4, §2.8; consent d) and is only
// offered when cameraAvailability() allows it; any camera problem falls back to the timer, so
// brushing and the streak never depend on the camera.
// Layout follows design reference 1's detail screen: bold stage + white sheet.
export default function BrushingSession() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  useLightStatusBar();
  const activeChildId = useLocalData((s) => s.activeChildId);
  const kids = useLocalData((s) => s.kids);
  const consents = useLocalData((s) => s.consents);
  const syncBlocked = useLocalData((s) => s.syncBlocked);
  const brushingRecords = useLocalData((s) => s.brushing);
  const uploadItems = useProofUploadStore((s) => s.items);
  const sessionStatus = useSession((s) => s.status);
  const userId = useSession((s) => s.userId);
  const me = useMe();
  const limits = useLimits();
  const [permission, requestPermission] = useCameraPermissions();

  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<Mode>('timer');
  const [elapsed, setElapsed] = useState(0);
  const [recordChoice, setRecordChoice] = useState<boolean | null>(null);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [recording, setRecording] = useState(false);
  const [recPaused, setRecPaused] = useState(false);
  const [canPause, setCanPause] = useState(false);
  const [clipExpected, setClipExpected] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [result, setResult] = useState<FinishResult | null>(null);

  const cameraRef = useRef<CameraView>(null);
  const recRef = useRef<Recording | null>(null);
  const targetRef = useRef<ProofTarget | null>(null);
  const elapsedRef = useRef(0);
  const finishingRef = useRef(false);
  const unmountedRef = useRef(false);

  const availability = useMemo(
    () =>
      cameraAvailability({
        platform: Platform.OS,
        sessionStatus,
        userId,
        me,
        kids,
        consents,
        syncBlocked,
        permission: permission ? { granted: permission.granted, canAskAgain: permission.canAskAgain } : null,
        proofsToday: proofCountsToday(brushingRecords, uploadItems),
        cameraFailed,
      }),
    [sessionStatus, userId, me, kids, consents, syncBlocked, permission, cameraFailed, brushingRecords, uploadItems],
  );
  // Default ON when available (the switch and its note are shown before starting).
  const recordOn = availability.available && (recordChoice ?? true);

  // "Done" is derived: reaching the target or finishing early.
  const done = phase === 'done' || elapsed >= TARGET_DURATION_S;
  const running = phase === 'running' && !done;
  const cameraActive = mode === 'camera' && (phase === 'starting' || phase === 'running' || phase === 'paused');
  // While the recorder writes the file after "done", the camera stays mounted with the same props.
  const showCamera = (cameraActive && !done) || (mode === 'camera' && recording);

  // Small phones: shrink the ring so ring + zone guide always fit the stage (a bit more while
  // the video switch takes room in the sheet).
  const withSwitch = availability.available && phase === 'idle';
  const ringSize = Math.round(Math.min(260, withSwitch ? Math.max(160, height * 0.26) : Math.max(180, height * 0.3)));

  // The upload queue must follow the signed-in user before a clip is handed to it.
  useEffect(() => {
    startProofUploads();
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed((e) => Math.min(TARGET_DURATION_S, e + 1)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      // Leaving mid-session: unmounting the camera finalizes the recording; its handler deletes
      // the file (nothing is recorded for an unfinished session).
      unmountedRef.current = true;
      // A recording that already stopped on its own (limit, background, camera error) kept its
      // clip for finishSession(), which never runs when the session is closed early. Delete it
      // here: the proof video must not stay in the camera cache (app/CLAUDE.md §3.5).
      const rec = recRef.current;
      if (rec?.ended && rec.clip && !finishingRef.current) {
        expoProofFiles.remove(rec.clip.uri);
        rec.clip = null;
      }
    };
  }, []);

  function fallbackToTimer(reason: Notice | null) {
    setCameraFailed(true);
    setMode('timer');
    setRecording(false);
    setRecPaused(false);
    setNotice(reason);
    setPhase((p) => (p === 'starting' || p === 'permission' ? 'running' : p));
  }

  // The camera did not come up in time: brush with the timer.
  const onCameraTimeout = useEffectEvent(() => {
    if (phase === 'starting') fallbackToTimer('cameraFailed');
  });
  useEffect(() => {
    if (phase !== 'starting') return;
    const timer = setTimeout(onCameraTimeout, CAMERA_START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  function onRecordingEnded(rec: Recording, uri: string | null) {
    rec.ended = true;
    if (uri) rec.clip = { uri, durationS: clipSeconds(rec, Date.now(), rec.maxDuration) };
    if (rec.abandoned || (unmountedRef.current && !finishingRef.current)) {
      if (uri) expoProofFiles.remove(uri);
      rec.clip = null;
      return;
    }
    if (finishingRef.current) return; // finishSession() takes the clip
    // Stopped on its own while brushing goes on (size/duration limit, app in the background,
    // camera error): keep brushing with the timer; a clip that was written is still used.
    setRecording(false);
    setRecPaused(false);
    setMode('timer');
    if (uri) {
      setNotice('recordingStopped');
    } else {
      setCameraFailed(true);
      setClipExpected(false);
      setNotice('cameraFailed');
    }
  }

  function beginRecording() {
    const cam = cameraRef.current;
    if (phase !== 'starting' || recRef.current || !cam) return;
    if (!recordOn || !targetRef.current) {
      setRecording(false);
      setClipExpected(false);
      setCanPause(true);
      setPhase('running');
      return;
    }
    const { maxDuration, maxFileSize } = proofRecordingLimits(limits);
    const rec: Recording = {
      promise: Promise.resolve(),
      startedAt: Date.now(),
      pausedMs: 0,
      pausedAt: null,
      maxDuration,
      clip: null,
      ended: false,
      abandoned: false,
    };
    let started: Promise<{ uri: string } | undefined>;
    try {
      // iOS applies videoBitrate only with an explicit codec; Android ignores `codec`.
      started = cam.recordAsync(Platform.OS === 'ios' ? { maxDuration, maxFileSize, codec: 'avc1' } : { maxDuration, maxFileSize });
    } catch {
      fallbackToTimer('cameraFailed');
      return;
    }
    rec.promise = Promise.resolve(started).then(
      (res) => onRecordingEnded(rec, typeof res?.uri === 'string' ? res.uri : null),
      () => onRecordingEnded(rec, null),
    );
    recRef.current = rec;
    setRecording(true);
    setClipExpected(true);
    setCanPause(supportsPause(cam));
    setPhase('running');
  }

  async function finishSession() {
    if (finishingRef.current) return;
    finishingRef.current = true;
    const rec = recRef.current;
    if (rec && !rec.ended) {
      try {
        cameraRef.current?.stopRecording();
      } catch {
        // The recording already ended.
      }
      const settled = await Promise.race([rec.promise.then(() => true), delay(STOP_TIMEOUT_MS).then(() => false)]);
      if (!settled) rec.abandoned = true;
    }
    const clip = rec && !rec.abandoned ? rec.clip : null;
    if (!unmountedRef.current) setRecording(false);
    const childId = activeChildId ?? (me?.accountType === 'child' ? (me.childAccount?.childId ?? null) : null);
    let outcome: FinishResult;
    try {
      outcome = await finishBrushingSession({
        childId,
        elapsedS: elapsedRef.current,
        clip,
        target: targetRef.current,
        limits,
        userId,
        cameraMode: mode === 'camera',
      });
    } catch {
      // Never expected; the done screen must still close normally.
      if (clip) expoProofFiles.remove(clip.uri);
      outcome = { brushing: null, proof: clip ? { kind: 'skipped', reason: 'not_sent' } : { kind: 'none' } };
    }
    if (!unmountedRef.current) setResult(outcome);
  }

  // Writes to the (external) stores once per session.
  const onDone = useEffectEvent(() => {
    void finishSession();
  });
  useEffect(() => {
    if (done) onDone();
  }, [done]);

  function startTimer() {
    setMode('timer');
    setPhase('running');
  }

  function startCamera() {
    targetRef.current = availability.available && recordOn ? availability : null;
    setNotice(null);
    setMode('camera');
    setPhase('starting');
  }

  function onStart() {
    const cameraEligible =
      Platform.OS !== 'web' && !cameraFailed && !(permission && !permission.granted && !permission.canAskAgain);

    if (availability.available) {
      if (recordChoice === false) {
        startTimer();
        return;
      }
      if (availability.needsPermission) {
        setPhase('permission');
        return;
      }
      if (cameraEligible) {
        startCamera();
        return;
      }
      startTimer();
      return;
    }

    if (me?.accountType === 'guardian') {
      if (!cameraEligible) {
        startTimer();
        return;
      }
      if (!permission?.granted) {
        setPhase('permission');
        return;
      }
      startCamera();
      return;
    }

    startTimer();
  }

  async function onAllowCamera() {
    let granted = false;
    try {
      granted = (await requestPermission()).granted;
    } catch {
      granted = false;
    }
    if (granted) {
      startCamera();
    } else {
      setNotice('permissionDenied');
      startTimer();
    }
  }

  async function onPause() {
    const rec = recRef.current;
    if (mode === 'camera' && rec && !rec.ended) {
      const cam = cameraRef.current;
      if (!cam || !canPause || toggling) return;
      setToggling(true);
      try {
        await cam.toggleRecordingAsync();
        rec.pausedAt = Date.now();
        setRecPaused(true);
      } catch {
        // Pausing failed: keep recording and brushing; no pause in this session.
        setCanPause(false);
        return;
      } finally {
        setToggling(false);
      }
    }
    setPhase('paused');
  }

  async function onResume() {
    const rec = recRef.current;
    if (mode === 'camera' && rec && !rec.ended && rec.pausedAt !== null) {
      if (toggling) return;
      setToggling(true);
      try {
        await cameraRef.current?.toggleRecordingAsync();
      } catch {
        // The recording ended meanwhile; its handler switches to timer mode.
      } finally {
        setToggling(false);
      }
      rec.pausedMs += Date.now() - rec.pausedAt;
      rec.pausedAt = null;
      setRecPaused(false);
    }
    setPhase('running');
  }

  const active = !done && (phase === 'running' || phase === 'paused' || phase === 'starting');
  const cameraPauseHidden = mode === 'camera' && recording && !canPause;
  const hint = availability.available
    ? undefined
    : availability.reason === 'daily_limit'
      ? r.unavailable.dailyLimit(availability.limit ?? limits.proofMaxPerChildPerDay)
      : unavailableHint[availability.reason];

  function renderControls() {
    if (done) return <Button title={t.close} variant="accent" size="large" onPress={() => router.back()} />;
    switch (phase) {
      case 'idle':
        return <Button testID="brushing-start" title={t.start} icon="play-arrow" variant="accent" size="large" onPress={onStart} />;
      case 'permission':
        return (
          <>
            <View className="gap-1">
              <Text variant="headline" accessibilityRole="header">
                {r.permissionTitle}
              </Text>
              <Text variant="body" tone="secondary">
                {r.permissionBody}
              </Text>
            </View>
            <Button testID="camera-permission-allow" title={r.permissionAllow} icon="videocam" variant="accent" size="large" onPress={() => void onAllowCamera()} />
            <Button testID="camera-permission-skip" title={r.permissionSkip} variant="ghost" onPress={startTimer} />
          </>
        );
      case 'starting':
        return (
          <>
            <Button title={r.starting} variant="accent" size="large" loading disabled />
            <Button testID="camera-skip" title={r.permissionSkip} variant="ghost" onPress={() => fallbackToTimer(null)} />
          </>
        );
      case 'running':
        return cameraPauseHidden ? (
          <Button testID="brushing-finish" title={t.finishEarly} icon="check" size="large" onPress={() => setPhase('done')} />
        ) : (
          <Button testID="brushing-pause" title={t.pause} icon="pause" size="large" loading={toggling} onPress={() => void onPause()} />
        );
      default:
        return (
          <>
            <Button testID="brushing-resume" title={t.resume} icon="play-arrow" variant="accent" size="large" loading={toggling} onPress={() => void onResume()} />
            <Button testID="brushing-finish" title={t.finishEarly} variant="ghost" onPress={() => setPhase('done')} />
          </>
        );
    }
  }

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={onPrimaryHeaderOptions} />
      {active || recording ? <KeepScreenOn /> : null}
      <TextClassContext.Provider value="text-primary-on">
        <View
          className="flex-1 items-center justify-center overflow-hidden rounded-b-sheet bg-primary"
          style={{ paddingTop: insets.top + HEADER_BAR, paddingBottom: 24, borderCurve: 'continuous' }}
        >
          {showCamera ? (
            <CameraStage
              ref={cameraRef}
              topInset={insets.top + HEADER_BAR}
              elapsed={elapsed}
              running={running}
              starting={phase === 'starting'}
              recording={recording}
              paused={recPaused}
              onReady={beginRecording}
              onError={() => fallbackToTimer('cameraFailed')}
            />
          ) : (
            <>
              {/* Coral stays clear of the close arrow and the timer text. */}
              <Blob color={palette.coral} size={170} variant={0} style={{ left: -80, bottom: -60 }} />
              <Blob color={palette.primaryDeep} size={260} variant={2} opacity={0.7} style={{ right: -120, bottom: -90 }} />
              <Ring color={palette.accent} size={60} thickness={10} style={{ right: 26, top: insets.top + HEADER_BAR + 4 }} />
              {done ? (
                <View className="items-center gap-3">
                  <Sparkle color={palette.accent} size={34} style={{ left: -40, top: 10 }} />
                  <Sparkle color={palette.card} size={22} style={{ right: -30, top: 60 }} />
                  {/* Celebration: the one place the mascot floats (rare moment). */}
                  <Mascot size={200} float />
                  <Text variant="display" accessibilityRole="header" className="text-center">
                    {t.doneTitle}
                  </Text>
                </View>
              ) : (
                <BrushingInstructions elapsed={elapsed} running={running} ringSize={ringSize} />
              )}
            </>
          )}
        </View>
      </TextClassContext.Provider>

      <View className="gap-3 px-6 pt-6" style={{ paddingBottom: insets.bottom + 20 }}>
        {phase !== 'permission' || done ? (
          <Text variant="body" tone="secondary" className="text-center">
            {done ? t.doneBody : t.intro}
          </Text>
        ) : null}
        {done ? <ProofStatus outcome={result?.proof ?? null} preparing={clipExpected} /> : null}
        {!done && notice ? <Banner testID="brushing-notice" tone="warning" message={noticeText[notice]} /> : null}
        {phase === 'idle' && availability.available ? (
          <RecordToggle
            audience={availability.audience}
            value={recordOn}
            onChange={setRecordChoice}
            retentionDays={limits.proofRetentionDays}
          />
        ) : null}
        {renderControls()}
        {!done && phase !== 'permission' ? (
          <Text variant="caption" tone="secondary" className="text-center">
            {cameraActive || (phase === 'idle' && recordOn) ? r.noSound : phase === 'idle' && hint ? hint : t.noCamera}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
