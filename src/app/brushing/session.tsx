import { useKeepAwake } from 'expo-keep-awake';
import { Stack, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Blob, Ring, Sparkle } from '@/components/decor';
import { Mascot } from '@/components/mascot';
import { ProgressRing } from '@/components/progress-ring';
import { Button } from '@/components/ui/button';
import { Text, TextClassContext } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { onPrimaryHeaderOptions, palette, useLightStatusBar } from '@/core/theme';
import { TARGET_DURATION_S } from '@/domain/brushing-windows';
import { useMockData } from '@/mock/store';
import { cn } from '@/lib/utils';
import { formatClock } from '@/ui/format';

const t = id.brushing;
const MIN_RECORD_S = 10;
const HEADER_BAR = 56;

type Phase = 'idle' | 'running' | 'paused' | 'done';

// A 2-minute session must not be cut off by the phone's screen timeout.
function KeepScreenOn() {
  useKeepAwake('brushing-session');
  return null;
}

// Four mouth zones, an equal share of the session each (30 s at 2 minutes): a game-like
// guide, not a clinical assessment (app/CLAUDE.md §6.4).
function ZoneGuide({ zone }: { zone: number }) {
  return (
    <View
      accessible
      accessibilityLabel={t.zoneLabel(zone + 1, t.zones[zone])}
      accessibilityLiveRegion="polite"
      className="mt-6 items-center gap-2.5"
    >
      <View className="flex-row gap-1.5">
        {t.zones.map((name, i) => (
          <View
            key={name}
            className={cn('h-2.5 w-11 rounded-full', i < zone ? 'bg-sun' : i === zone ? 'bg-card' : 'bg-card/35')}
          />
        ))}
      </View>
      <Text variant="bodyStrong" className="text-center">
        {`${t.zoneNow} ${t.zones[zone]}`}
      </Text>
    </View>
  );
}

// Timer-only mode (PRD FR-61): no camera until spikes S2/S3 pass. Phase 5 adds
// music, keep-awake, slot windows and check-in recording via the outbox.
// Layout follows design reference 1's detail screen: bold stage + white sheet.
export default function BrushingSession() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // Small phones: shrink the ring so ring + zone guide always fit the stage.
  const ringSize = Math.round(Math.min(260, Math.max(180, height * 0.3)));
  useLightStatusBar();
  const activeChildId = useMockData((s) => s.activeChildId);
  const addBrushing = useMockData((s) => s.addBrushing);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const recorded = useRef(false);

  // "Done" is derived: reaching the target or finishing early.
  const done = phase === 'done' || elapsed >= TARGET_DURATION_S;
  const running = phase === 'running' && !done;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed((e) => Math.min(TARGET_DURATION_S, e + 1)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  // Writes to the (external) store once per session.
  useEffect(() => {
    if (done && !recorded.current && activeChildId && elapsed >= MIN_RECORD_S) {
      recorded.current = true;
      addBrushing(activeChildId, elapsed);
    }
  }, [done, elapsed, activeChildId, addBrushing]);

  const remaining = TARGET_DURATION_S - elapsed;
  const zone = Math.min(t.zones.length - 1, Math.floor((elapsed / TARGET_DURATION_S) * t.zones.length));
  const active = !done && (phase === 'running' || phase === 'paused');

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={onPrimaryHeaderOptions} />
      {active ? <KeepScreenOn /> : null}
      <TextClassContext.Provider value="text-primary-on">
        <View
          className="flex-1 items-center justify-center overflow-hidden rounded-b-sheet bg-primary"
          style={{ paddingTop: insets.top + HEADER_BAR, paddingBottom: 24, borderCurve: 'continuous' }}
        >
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
            <View className="items-center">
              <ProgressRing
                progress={elapsed / TARGET_DURATION_S}
                size={ringSize}
                strokeWidth={22}
                trackColor={palette.primaryDeep}
                color={palette.accent}
                accessibilityLabel={t.ringLabel(remaining)}
              >
                <Mascot size={86} withBrush mood={running ? 'happy' : 'wow'} />
                <Text variant="hero">{formatClock(remaining)}</Text>
                <Text variant="label">{t.remaining}</Text>
              </ProgressRing>
              <ZoneGuide zone={zone} />
            </View>
          )}
        </View>
      </TextClassContext.Provider>

      <View className="gap-3 px-6 pt-6" style={{ paddingBottom: insets.bottom + 20 }}>
        <Text variant="body" tone="secondary" className="text-center">
          {done ? t.doneBody : t.intro}
        </Text>
        {done ? (
          <Button title={t.close} variant="accent" size="large" onPress={() => router.back()} />
        ) : phase === 'idle' ? (
          <Button title={t.start} icon="play-arrow" variant="accent" size="large" onPress={() => setPhase('running')} />
        ) : phase === 'running' ? (
          <Button title={t.pause} icon="pause" size="large" onPress={() => setPhase('paused')} />
        ) : (
          <>
            <Button title={t.resume} icon="play-arrow" variant="accent" size="large" onPress={() => setPhase('running')} />
            <Button title={t.finishEarly} variant="ghost" onPress={() => setPhase('done')} />
          </>
        )}
        {!done ? (
          <Text variant="caption" tone="secondary" className="text-center">
            {t.noCamera}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
