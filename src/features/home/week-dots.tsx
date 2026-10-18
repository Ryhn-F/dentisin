import { View } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';
import { cn } from '@/lib/utils';

import type { WeekDot } from './streak';

const weekdays = id.components.streak;

// The streak's last seven days (oldest first, today last) on the blue streak card: one pill
// per day with a tick when the day counts. Same pill look as StreakWeek; one dot because the
// server streak counts days, not morning/evening slots (those stay in the slot cards).
export function WeekDots({
  days,
  doneLabel,
  notYetLabel,
  big = false,
}: {
  days: readonly WeekDot[];
  doneLabel: string;
  notYetLabel: string;
  /** Child home: larger dots. */
  big?: boolean;
}) {
  const dot = big ? 'size-8' : 'size-6';
  return (
    <View className="flex-row justify-between" testID="week-dots">
      {days.map((day) => (
        <View
          key={day.date}
          testID={`week-dot-${day.date}`}
          accessible
          accessibilityLabel={`${weekdays.weekdaysLong[day.weekday]}: ${day.done ? doneLabel : notYetLabel}`}
          className={cn('min-w-10 items-center gap-2 rounded-full px-1.5 py-2.5', day.isToday && 'bg-card')}
        >
          <Text variant="label" tone={day.isToday ? 'primary' : 'onPrimary'}>
            {weekdays.weekdaysShort[day.weekday]}
          </Text>
          <View
            className={cn(
              'items-center justify-center rounded-full',
              dot,
              day.done ? 'bg-sun' : day.isToday ? 'border-2 border-outline' : 'border-2 border-white',
            )}
          >
            {day.done ? <Icon name="check" size={big ? 20 : 16} color={palette.onAccent} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
}
