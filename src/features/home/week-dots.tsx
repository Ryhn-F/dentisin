import { useEffect, useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { motion, palette } from '@/core/theme';
import { cn } from '@/lib/utils';

import type { WeekDot } from './streak';

const weekdays = id.components.streak;

// A dot that turns done while on screen (today's brushing counted) pops once; dots that are
// already done on first render stay still.
function PopWhenDone({ done, children }: { done: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const wasDone = useRef(done);
  useEffect(() => {
    if (done && !wasDone.current && !reduceMotion) {
      scale.set(withSequence(withTiming(1.35, { duration: motion.fast }), withSpring(1, { duration: 400, dampingRatio: 0.5 })));
    }
    wasDone.current = done;
  }, [done, reduceMotion, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

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
          <PopWhenDone done={day.done}>
            <View
              className={cn(
                'items-center justify-center rounded-full',
                dot,
                day.done ? 'bg-sun' : day.isToday ? 'border-2 border-outline' : 'border-2 border-white',
              )}
            >
              {day.done ? <Icon name="check" size={big ? 20 : 16} color={palette.onAccent} /> : null}
            </View>
          </PopWhenDone>
        </View>
      ))}
    </View>
  );
}
