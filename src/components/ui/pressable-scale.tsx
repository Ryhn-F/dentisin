import type { ReactNode } from 'react';
import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { motion } from '@/core/theme';

export type PressableScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode;
  /** Visual classes (background, radius, padding) — on the element that scales. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** Layout in the parent (flex, width, margins, alignSelf). */
  containerClassName?: string;
  containerStyle?: StyleProp<ViewStyle>;
  /** Minimum visual height = touch target height (mode-dependent, so a runtime value). */
  minHeight?: number;
  /**
   * Let the visuals grow with a container that is stretched by its parent (equal-height
   * tiles in a row). Never combine with `self-*` alignment: on Android (Yoga) a growing
   * child of a fit-content Pressable collapses to zero width and an endless height.
   */
  fill?: boolean;
  /** Scale while pressed; rows pass 1 (they highlight instead of shrinking). */
  scaleTo?: number;
};

// Touch-driven feedback runs on the UI thread with a spring so it can be interrupted
// (expo-animation guidance); disabled when the OS asks for reduced motion.
// Layers on purpose: NativeWind's cssInterop on an animated Pressable drops the inline
// `style` prop (verified in tests) and Reanimated's Animated.View ignores `className`
// (verified on web). So: plain Pressable = touch + a11y + layout; Animated.View = scale
// only; plain View = visual classes + minimum height.
export function PressableScale({
  scaleTo = 0.96,
  className,
  style,
  containerClassName,
  containerStyle,
  minHeight,
  fill = false,
  children,
  onPressIn,
  onPressOut,
  ...props
}: PressableScaleProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const animate = !reduceMotion && scaleTo !== 1;
  const grow = fill ? { flexGrow: 1 } : undefined;

  return (
    <Pressable
      {...props}
      className={containerClassName}
      style={containerStyle}
      onPressIn={(e) => {
        if (animate) scale.set(withSpring(scaleTo, motion.pressSpring));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (animate) scale.set(withSpring(1, motion.pressSpring));
        onPressOut?.(e);
      }}
    >
      {/* Reanimated gets inline styles only (it is not a NativeWind-interop component). */}
      <Animated.View style={[grow, animatedStyle]}>
        <View className={className} style={[grow, minHeight ? { minHeight } : undefined, style]}>
          {children}
        </View>
      </Animated.View>
    </Pressable>
  );
}
