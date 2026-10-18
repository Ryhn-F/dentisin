import { CameraView } from 'expo-camera';
import { forwardRef, memo, useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';

import { PROOF_VIDEO_BITRATE, PROOF_VIDEO_QUALITY } from '../brushing-session';
import { BrushingInstructions } from './brushing-guide';

const r = id.recording;

// Constant so a re-render never sends new props to the native view: on Android any prop update
// recreates the CameraX session, which would end a running recording.
const PREVIEW_STYLE = { flex: 1 } as const;

// Memoized with stable callbacks: the timer re-renders the stage every second, the preview never.
const Preview = memo(
  forwardRef<CameraView, { onReady: () => void; onError: () => void }>(function Preview({ onReady, onError }, ref) {
    return (
      <CameraView
        ref={ref}
        style={PREVIEW_STYLE}
        facing="front"
        mode="video"
        mute
        videoQuality={PROOF_VIDEO_QUALITY}
        videoBitrate={PROOF_VIDEO_BITRATE}
        onCameraReady={onReady}
        onMountError={onError}
      />
    );
  }),
);

/**
 * Live front-camera preview filling the brushing stage, with the same instructions as timer
 * mode on top (smaller ring + zone guide) and a visible recording indicator. Records muted
 * (the app never asks for the microphone), ~480p at a low bitrate (see ../brushing-session.ts).
 */
export const CameraStage = forwardRef<
  CameraView,
  {
    /** Height covered by the transparent header (safe area + bar). */
    topInset: number;
    elapsed: number;
    running: boolean;
    starting: boolean;
    recording: boolean;
    paused: boolean;
    onReady: () => void;
    onError: () => void;
  }
>(function CameraStage({ topInset, elapsed, running, starting, recording, paused, onReady, onError }, ref) {
  const latest = useRef({ onReady, onError });
  useEffect(() => {
    latest.current = { onReady, onError };
  });
  const handleReady = useCallback(() => latest.current.onReady(), []);
  const handleError = useCallback(() => latest.current.onError(), []);
  return (
    <View className="absolute inset-0" style={{ backgroundColor: palette.cameraBg }}>
      <View className="flex-1" accessible accessibilityLabel={r.previewLabel}>
        <Preview ref={ref} onReady={handleReady} onError={handleError} />
      </View>

      {/* Veil behind the transparent header so the close arrow stays visible. */}
      <View className="absolute left-0 right-0 top-0" style={{ height: topInset, backgroundColor: palette.scrim }} pointerEvents="none" />

      {recording ? (
        <View
          testID="recording-indicator"
          accessible
          accessibilityLabel={paused ? r.pausedLabel : r.recordingLabel}
          accessibilityLiveRegion="polite"
          className="absolute flex-row items-center gap-2 rounded-full py-1.5 pl-3 pr-4"
          style={{ top: topInset + 10, left: 16, backgroundColor: palette.scrimStrong }}
        >
          {paused ? (
            <Icon name="pause" size={16} color={palette.onPrimary} />
          ) : (
            <View className="size-3.5 rounded-full border-2 border-card bg-danger" />
          )}
          <Text variant="label">{paused ? r.pausedBadge : r.recordingBadge}</Text>
        </View>
      ) : starting ? (
        <View
          accessible
          accessibilityLabel={r.starting}
          accessibilityLiveRegion="polite"
          className="absolute flex-row items-center gap-2 rounded-full px-4 py-1.5"
          style={{ top: topInset + 10, left: 16, backgroundColor: palette.scrimStrong }}
        >
          <ActivityIndicator size="small" color={palette.onPrimary} />
          <Text variant="label">{r.starting}</Text>
        </View>
      ) : null}

      <View className="absolute bottom-0 left-0 right-0 items-center px-4 pb-5" pointerEvents="none">
        <View className="items-center rounded-tile px-5 pb-4 pt-3" style={{ backgroundColor: palette.scrimStrong, borderCurve: 'continuous' }}>
          <BrushingInstructions elapsed={elapsed} running={running} compact />
        </View>
      </View>
    </View>
  );
});
