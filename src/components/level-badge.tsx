import { View } from 'react-native';

import { id } from '@/core/i18n/id';
import { levelColors, useTheme, type TriageLevel } from '@/core/theme';
import { cn } from '@/lib/utils';

import { Icon, type IconName } from './icon';
import { Text } from './ui/text';

// Color + icon + word, never color alone (color-blind safe). Level colors keep their
// clinical meaning and are NOT part of the playful palette. Routine uses a
// repeat-calendar icon, not a "healthy" check mark (screening, not diagnosis).
const icons: Record<TriageLevel, IconName> = {
  emergency: 'warning',
  urgent: 'access-alarm',
  scheduled: 'event',
  routine: 'event-repeat',
};

const bgClass: Record<TriageLevel, string> = {
  emergency: 'bg-level-emergency',
  urgent: 'bg-level-urgent',
  scheduled: 'bg-level-scheduled',
  routine: 'bg-level-routine',
};

export function LevelBadge({
  level,
  showAdvice = true,
  className,
}: {
  level: TriageLevel;
  showAdvice?: boolean;
  className?: string;
}) {
  const { touch } = useTheme();
  const on = levelColors[level].on;
  const { label, advice } = id.levels[level];

  return (
    <View
      testID={`level-badge-${level}`}
      accessible
      accessibilityRole="text"
      accessibilityLabel={showAdvice ? `${label}. ${advice}` : label}
      className={cn('flex-row items-center gap-3 rounded-tile px-4 py-3', bgClass[level], className)}
      style={{ minHeight: touch.regular, borderCurve: 'continuous' }}
    >
      <Icon name={icons[level]} size={30} color={on} />
      <View className="flex-1 gap-0.5">
        <Text variant="headline" style={{ color: on }}>
          {label}
        </Text>
        {showAdvice ? (
          <Text variant="body" style={{ color: on }}>
            {advice}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
