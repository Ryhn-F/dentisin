import { useAudioPlayer } from 'expo-audio';
import { useEffect, useRef } from 'react';

import type { VoiceCue } from './brushing-session';

// Bundled clips made once at build time (backend/tools/tts, ADR 012): the app never calls a TTS
// service. The About screen carries the "suara dibuat dengan AI" label.
const clips: Record<VoiceCue, number> = {
  start: require('@/assets/audio/brushing.start.wav'),
  zone2: require('@/assets/audio/brushing.zone2.wav'),
  zone3: require('@/assets/audio/brushing.zone3.wav'),
  zone4: require('@/assets/audio/brushing.zone4.wav'),
  done: require('@/assets/audio/brushing.done.wav'),
};

/** Reads each instruction aloud once, when it first appears (resuming does not repeat it). */
export function useInstructionVoice(cue: VoiceCue | null) {
  const player = useAudioPlayer();
  const lastRef = useRef<VoiceCue | null>(null);
  useEffect(() => {
    if (!cue || cue === lastRef.current) return;
    lastRef.current = cue;
    try {
      player.replace(clips[cue]);
      player.play();
    } catch {
      // Voice is an extra: the on-screen instruction stays the source of truth.
    }
  }, [cue, player]);
}
