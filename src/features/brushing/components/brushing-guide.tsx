import { View } from 'react-native';

import { Mascot } from '@/components/mascot';
import { ProgressRing } from '@/components/progress-ring';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';
import { cn } from '@/lib/utils';
import { formatClock } from '@/ui/format';

import { TARGET_DURATION_S, remainingSeconds, zoneForElapsed } from '../brushing-session';

const t = id.brushing;

/** Ring size used over the camera preview (the preview stays the main thing on screen). */
export const COMPACT_RING_SIZE = 124;

// Four mouth zones, an equal share of the session each (30 s at 2 minutes): a game-like
// guide, not a clinical assessment (app/CLAUDE.md §6.4).
export function ZoneGuide({ zone, compact = false }: { zone: number; compact?: boolean }) {
  return (
    <View
      accessible
      accessibilityLabel={t.zoneLabel(zone + 1, t.zones[zone])}
      accessibilityLiveRegion="polite"
      className={cn('items-center', compact ? 'mt-3 gap-2' : 'mt-6 gap-2.5')}
    >
      <View className="flex-row gap-1.5">
        {t.zones.map((name, i) => (
          <View
            key={name}
            className={cn('h-2.5 rounded-full', compact ? 'w-9' : 'w-11', i < zone ? 'bg-sun' : i === zone ? 'bg-card' : 'bg-card/35')}
          />
        ))}
      </View>
      <Text variant="bodyStrong" className="text-center">
        {`${t.zoneNow} ${t.zones[zone]}`}
      </Text>
    </View>
  );
}

/**
 * The brushing instruction: remaining-time ring + zone guide, identical in timer mode and over
 * the camera preview (compact: smaller ring, no mascot). Text color comes from the stage
 * (TextClassContext: white on blue / on the camera scrim).
 */
export function BrushingInstructions({
  elapsed,
  running,
  ringSize,
  compact = false,
}: {
  elapsed: number;
  running: boolean;
  ringSize?: number;
  compact?: boolean;
}) {
  const remaining = remainingSeconds(elapsed);
  const zone = zoneForElapsed(elapsed);
  return (
    <View className="items-center">
      <ProgressRing
        progress={elapsed / TARGET_DURATION_S}
        size={compact ? COMPACT_RING_SIZE : (ringSize ?? 240)}
        strokeWidth={compact ? 12 : 22}
        trackColor={palette.primaryDeep}
        color={palette.accent}
        accessibilityLabel={t.ringLabel(remaining)}
      >
        {compact ? null : <Mascot size={86} withBrush mood={running ? 'happy' : 'wow'} />}
        <Text variant={compact ? 'title' : 'hero'}>{formatClock(remaining)}</Text>
        <Text variant="label">{t.remaining}</Text>
      </ProgressRing>
      <ZoneGuide zone={zone} compact={compact} />
    </View>
  );
}
