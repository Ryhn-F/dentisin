import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { palette } from '@/core/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Thick rounded ring. The arc glides between timer ticks (UI thread, linear 1 s),
// so the countdown feels continuous; reduced motion jumps instead.
export function ProgressRing({
  progress,
  size = 240,
  strokeWidth = 20,
  trackColor = palette.surface,
  color = palette.primary,
  children,
  accessibilityLabel,
}: {
  /** 0..1 */
  progress: number;
  size?: number;
  strokeWidth?: number;
  trackColor?: string;
  color?: string;
  children?: ReactNode;
  accessibilityLabel?: string;
}) {
  const clamped = Math.min(1, Math.max(0, progress));
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const reduceMotion = useReducedMotion();
  const animated = useSharedValue(clamped);

  useEffect(() => {
    animated.set(reduceMotion ? clamped : withTiming(clamped, { duration: 1000, easing: Easing.linear }));
  }, [clamped, reduceMotion, animated]);

  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - animated.get()),
  }));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={arcProps}
          // Start at 12 o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}
