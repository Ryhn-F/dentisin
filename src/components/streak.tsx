import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { id } from '@/core/i18n/id';
import { motion, palette } from '@/core/theme';
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

const FLICKER_MS = 700;
const EASE_IN_OUT = Easing.bezier(0.45, 0, 0.55, 1);

// Lit flame: a slow flicker (scale + sway from the base) while the screen is visible, and a
// bump when the count goes up. Decorative only; reduced motion keeps it still.
function Flame({ count, active }: { count: number; active: boolean }) {
  const reduceMotion = useReducedMotion();
  const flicker = useSharedValue(0);
  const bump = useSharedValue(1);
  const prevCount = useRef(count);

  useEffect(() => {
    if (!active || reduceMotion || count === 0) return;
    flicker.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: FLICKER_MS, easing: EASE_IN_OUT }),
          withTiming(-1, { duration: FLICKER_MS, easing: EASE_IN_OUT }),
        ),
        -1,
        true,
      ),
    );
    // Endless loops must stop when the screen is covered, or they keep the UI thread busy.
    return () => {
      cancelAnimation(flicker);
      flicker.set(0);
    };
  }, [active, reduceMotion, count, flicker]);

  useEffect(() => {
    if (count > prevCount.current && !reduceMotion) {
      bump.set(withSequence(withTiming(1.25, { duration: motion.fast }), withSpring(1, { duration: 400, dampingRatio: 0.5 })));
    }
    prevCount.current = count;
  }, [count, reduceMotion, bump]);

  const style = useAnimatedStyle(() => {
    const f = flicker.get();
    return {
      transformOrigin: 'bottom',
      transform: [{ scale: bump.get() }, { scaleY: 1 + Math.abs(f) * 0.08 }, { rotate: `${f * 4}deg` }],
    };
  });

  return (
    <Animated.View style={style}>
      <Icon name="local-fire-department" size={36} color={palette.coral} />
    </Animated.View>
  );
}

// Designed to sit on the blue streak card (white text passes AA on primary).
// `active`: the hosting screen is focused (animation runs only then).
export function StreakCounter({ count, active = false }: { count: number; active?: boolean }) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${count} ${t.daysInARow}`}
      className="flex-row items-center gap-3"
    >
      <View className="size-16 items-center justify-center rounded-full bg-sun">
        <Flame count={count} active={active} />
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
