// Pure helpers shared by timer mode and camera mode of the brushing session, so both give the
// same instructions with the same timing: TARGET_DURATION_S split into the four mouth zones of
// id.brushing.zones (30 s each at 2 minutes), plus the proof-video recording settings.

import { TARGET_DURATION_S } from '@/domain/brushing-windows';
import type { AccountLimits, ProofMime } from '@/domain/models';

export { TARGET_DURATION_S };

/** Shorter sessions are not recorded (an accidental tap is not a brushing). */
export const MIN_RECORD_S = 10;
/** Shorter clips are not sent as proof. */
export const MIN_PROOF_S = 10;
export const ZONE_COUNT = 4;

/** Zone index (0..ZONE_COUNT-1) for the seconds brushed so far. */
export function zoneForElapsed(elapsedS: number, totalS: number = TARGET_DURATION_S, zones: number = ZONE_COUNT): number {
  if (!(totalS > 0) || !(elapsedS > 0)) return 0;
  return Math.min(zones - 1, Math.floor((elapsedS / totalS) * zones));
}

/** Spoken instruction clips (assets/audio/script.csv, Gemini TTS at build time — ADR 012). */
export type VoiceCue = 'start' | 'zone2' | 'zone3' | 'zone4' | 'done';
const ZONE_CUES: readonly VoiceCue[] = ['start', 'zone2', 'zone3', 'zone4'];

/** The instruction that should be heard now; null while idle, starting or paused. */
export function voiceCueFor(running: boolean, done: boolean, elapsedS: number): VoiceCue | null {
  if (done) return 'done';
  return running ? ZONE_CUES[zoneForElapsed(elapsedS)] : null;
}

/** Seconds left in the session (never negative). */
export function remainingSeconds(elapsedS: number, totalS: number = TARGET_DURATION_S): number {
  return Math.max(0, totalS - Math.max(0, elapsedS));
}

// ---------------------------------------------------------------------------------------------
// Proof video settings (ACCOUNTS_AND_FLOWS.md §2.4 step 2: ~480p, low bitrate, <= limits)
// ---------------------------------------------------------------------------------------------

/**
 * expo-camera 57 `videoQuality` (Android: CameraX QualitySelector; '480p' = SD, falling back to
 * the nearest available quality).
 */
export const PROOF_VIDEO_QUALITY = '480p' as const;
/**
 * expo-camera 57 `videoBitrate` prop (bits/s): Android sets Recorder.setTargetVideoEncodingBitRate;
 * iOS honours it only with an explicit codec, so recordAsync passes codec 'avc1' there. 400 kbit/s
 * keeps a 2-minute clip around 6 MB, below proof_max_bytes (10 MiB).
 */
export const PROOF_VIDEO_BITRATE = 400_000;
/** Hard cap from the contract, whatever the server limit says. */
export const PROOF_MAX_DURATION_CAP_S = 180;
/**
 * maxFileSize is set a little under proof_max_bytes: the recorder stops at the limit, then writes
 * the MP4 index, which must not push the file over the server's limit (the file would be lost).
 */
export const PROOF_SIZE_HEADROOM = 0.97;

export function proofRecordingLimits(limits: Pick<AccountLimits, 'proofMaxBytes' | 'proofMaxDurationS'>): {
  maxDuration: number;
  maxFileSize: number;
} {
  const maxDuration = Math.max(1, Math.min(Math.floor(limits.proofMaxDurationS), PROOF_MAX_DURATION_CAP_S));
  const maxFileSize = Math.max(1, Math.floor(limits.proofMaxBytes * PROOF_SIZE_HEADROOM));
  return { maxDuration, maxFileSize };
}

/** expo-camera writes .mp4 on Android and .mov (QuickTime) on iOS. */
export function proofMimeForUri(uri: string): ProofMime {
  return /\.mov$/i.test(uri.split('?')[0]) ? 'video/quicktime' : 'video/mp4';
}

/**
 * Active recording time of a clip in whole seconds (>= 0): wall time since the start minus the
 * time spent paused, capped at the recorder's maxDuration.
 */
export function clipSeconds(
  clock: { startedAt: number; pausedMs: number; pausedAt: number | null },
  endedAt: number,
  maxDurationS: number,
): number {
  const pausedNow = clock.pausedAt !== null ? Math.max(0, endedAt - clock.pausedAt) : 0;
  const activeMs = Math.max(0, endedAt - clock.startedAt - clock.pausedMs - pausedNow);
  return Math.min(maxDurationS, Math.round(activeMs / 1000));
}
