import { View } from 'react-native';

import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';
import { cn } from '@/lib/utils';

import { Icon } from './icon';
import { Text } from './ui/text';

const t = id.components.streak;

export type StreakDay = {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  morning: boolean;
  evening: boolean;
  isToday?: boolean;
  isFuture?: boolean;
};

// Designed to sit on the blue streak card (white text passes AA on primary).
export function StreakCounter({ count }: { count: number }) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${count} ${t.daysInARow}`}
      className="flex-row items-center gap-3"
    >
      <View className="size-16 items-center justify-center rounded-full bg-sun">
        <Icon name="local-fire-department" size={36} color={palette.coral} />
      </View>
      <View>
        <Text variant="hero" tone="onPrimary" style={{ lineHeight: 54 }}>
          {count}
        </Text>
        <Text variant="label" tone="onPrimary">
          {t.daysInARow}
        </Text>
      </View>
    </View>
  );
}

function Dot({ done, muted, today }: { done: boolean; muted: boolean; today: boolean }) {
  return (
    <View
      className={cn(
        'size-4 rounded-full',
        done ? (today ? 'bg-primary' : 'bg-sun') : today ? 'border-2 border-outline' : 'border-2 border-white',
        muted && 'opacity-40',
      )}
    />
  );
}

function slotLabel(done: boolean, future: boolean) {
  if (future) return t.upcoming;
  return done ? t.done : t.notYet;
}

// Seven day pills (Mon–Sun) with morning (top) and evening (bottom) dots.
// Today is a white pill, like the selected day in the reference calendars.
export function StreakWeek({ days }: { days: readonly StreakDay[] }) {
  return (
    <View className="flex-row justify-between">
      {days.map((day) => {
        const future = !!day.isFuture;
        const today = !!day.isToday;
        const label = `${t.weekdaysLong[day.weekday]}: ${t.morning} ${slotLabel(day.morning, future)}, ${t.evening} ${slotLabel(day.evening, future)}`;
        return (
          <View
            key={day.date}
            testID={`streak-day-${day.date}`}
            accessible
            accessibilityLabel={label}
            className={cn('min-w-10 items-center gap-2 rounded-full px-1.5 py-2.5', today && 'bg-card')}
          >
            <Text variant="label" tone={today ? 'primary' : 'onPrimary'}>
              {t.weekdaysShort[day.weekday]}
            </Text>
            <Dot done={day.morning} muted={future} today={today} />
            <Dot done={day.evening} muted={future} today={today} />
          </View>
        );
      })}
    </View>
  );
}

// Legend for the dots, so meaning is not carried by position alone.
export function StreakLegend() {
  return (
    <View className="flex-row gap-4">
      <View className="flex-row items-center gap-1">
        <Icon name="wb-sunny" size={16} color={palette.accent} />
        <Text variant="caption" tone="onPrimary">
          {t.legendMorning}
        </Text>
      </View>
      <View className="flex-row items-center gap-1">
        <Icon name="nightlight-round" size={16} color={palette.accent} />
        <Text variant="caption" tone="onPrimary">
          {t.legendEvening}
        </Text>
      </View>
    </View>
  );
}
