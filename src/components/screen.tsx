import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { motion, palette } from '@/core/theme';
import { cn } from '@/lib/utils';

const HEADER_BAR = 56;
const SCRIM_AFTER = 12;

export type TopScrim = {
  /** Color of the bar that fades in: the hero blue or the page lavender. */
  color: 'primary' | 'bg';
  /** Cover only the status bar, or the status bar plus a transparent navigation header. */
  height: 'statusBar' | 'header';
};

// Standard scrolling screen body: lavender page, safe-area aware, keyboard friendly,
// 20dp edge padding and generous section gaps. `flush` removes top padding for
// screens that start with a full-bleed hero block.
// When content scrolls under a transparent top area (status bar, transparent header),
// a solid bar fades in so text never runs under the clock or the back arrow.
export function Screen({
  children,
  className,
  flush = false,
  topScrim = flush ? { color: 'primary', height: 'header' } : undefined,
  testID,
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
  topScrim?: TopScrim;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const opacity = useSharedValue(0);
  const scrimStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  useEffect(() => {
    const target = scrolled ? 1 : 0;
    opacity.set(reduceMotion ? target : withTiming(target, { duration: motion.fast }));
  }, [scrolled, reduceMotion, opacity]);

  // State changes only when the threshold is crossed, not on every scroll event.
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = e.nativeEvent.contentOffset.y > SCRIM_AFTER;
    if (next !== scrolled) setScrolled(next);
  }

  return (
    <View className="flex-1 bg-bg">
      <ScrollView
        testID={testID}
        contentInsetAdjustmentBehavior={flush ? 'never' : 'automatic'}
        keyboardShouldPersistTaps="handled"
        onScroll={topScrim ? onScroll : undefined}
        scrollEventThrottle={topScrim ? 32 : undefined}
        className="flex-1 bg-bg"
        contentContainerClassName={cn('gap-7 pb-12', flush ? 'pt-0' : 'px-5 pt-4', className)}
      >
        {children}
      </ScrollView>
      {topScrim ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: insets.top + (topScrim.height === 'header' ? HEADER_BAR : 0),
              backgroundColor: topScrim.color === 'primary' ? palette.primary : palette.bg,
            },
            scrimStyle,
          ]}
        />
      ) : null}
    </View>
  );
}
