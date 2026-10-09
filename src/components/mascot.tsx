import { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import { motion, palette } from '@/core/theme';

export type MascotMood = 'happy' | 'wow' | 'sleepy' | 'thinking';

// "Gigi" — an ORIGINAL tooth character drawn for DentisAI (app/CLAUDE.md §3.6).
// Placeholder until commissioned mascot art exists; decorative only (meaning is
// always carried by text). Never shown on result or emergency screens.
export function Mascot({
  mood = 'happy',
  size = 120,
  withBrush = false,
  float = false,
  style,
}: {
  mood?: MascotMood;
  size?: number;
  withBrush?: boolean;
  /** Gentle idle float — only for rare/celebration moments; off with reduced motion. */
  float?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const y = useSharedValue(0);

  useEffect(() => {
    if (!float || reduceMotion) return;
    y.set(
      withRepeat(
        withSequence(
          withTiming(-motion.floatDistance, { duration: motion.floatDuration }),
          withTiming(0, { duration: motion.floatDuration }),
        ),
        -1,
      ),
    );
  }, [float, reduceMotion, y]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  const ink = palette.text;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width: size, height: size }, style]}
    >
      <Animated.View style={animatedStyle}>
        <Svg width={size} height={size} viewBox="0 0 120 120">
          {withBrush ? (
            <G transform="rotate(-32 96 64)">
              <Rect x={80} y={60} width={38} height={9} rx={4.5} fill={palette.coral} stroke={ink} strokeWidth={3} />
              <Rect x={70} y={55} width={14} height={14} rx={3} fill={palette.card} stroke={ink} strokeWidth={3} />
            </G>
          ) : null}
          {/* Tooth body */}
          <Path
            d="M60 18 C70 12 88 12 94 26 C100 40 96 56 92 68 C89 78 88 92 84 102 C81 110 72 110 70 100 C68 92 66 84 60 84 C54 84 52 92 50 100 C48 110 39 110 36 102 C32 92 31 78 28 68 C24 56 20 40 26 26 C32 12 50 12 60 18 Z"
            fill={palette.card}
            stroke={ink}
            strokeWidth={3.5}
            strokeLinejoin="round"
          />
          {/* Soft shade on the right side */}
          <Path d="M86 22 C94 30 95 46 90 60 C88 66 86 72 85 78 C81 66 82 42 86 22 Z" fill={palette.tints.lavender} />
          {/* Cheeks */}
          <Circle cx={40} cy={64} r={5.5} fill={palette.coral} opacity={0.45} />
          <Circle cx={80} cy={64} r={5.5} fill={palette.coral} opacity={0.45} />
          {/* Eyes */}
          {mood === 'sleepy' ? (
            <G stroke={ink} strokeWidth={3.2} strokeLinecap="round" fill="none">
              <Path d="M42 53 Q48 58 54 53" />
              <Path d="M66 53 Q72 58 78 53" />
            </G>
          ) : (
            <G>
              <Ellipse cx={48} cy={52} rx={5.2} ry={mood === 'wow' ? 7.5 : 6.5} fill={ink} />
              <Ellipse cx={72} cy={52} rx={5.2} ry={mood === 'wow' ? 7.5 : 6.5} fill={ink} />
              <Circle cx={49.8} cy={49.5} r={1.9} fill={palette.card} />
              <Circle cx={73.8} cy={49.5} r={1.9} fill={palette.card} />
            </G>
          )}
          {/* Mouth */}
          {mood === 'happy' ? (
            <G>
              <Path d="M50 64 Q60 78 70 64 Z" fill={ink} stroke={ink} strokeWidth={2} strokeLinejoin="round" />
              <Ellipse cx={60} cy={70} rx={4.2} ry={2.4} fill={palette.coral} />
            </G>
          ) : mood === 'wow' ? (
            <Ellipse cx={60} cy={69} rx={4.5} ry={5.5} fill={ink} />
          ) : mood === 'thinking' ? (
            <Path d="M54 69 Q60 66 66 70" stroke={ink} strokeWidth={3.2} strokeLinecap="round" fill="none" />
          ) : (
            <Path d="M56 68 Q60 71 64 68" stroke={ink} strokeWidth={3} strokeLinecap="round" fill="none" />
          )}
        </Svg>
      </Animated.View>
    </View>
  );
}
