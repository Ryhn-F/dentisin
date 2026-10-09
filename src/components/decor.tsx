import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

// Decorative shapes from the references (organic blobs, coil rings, sparkles).
// Purely visual: hidden from screen readers and never intercept touches.

const BLOBS = [
  'M73 10 C88 18 97 36 92 55 C87 74 72 92 51 93 C30 94 12 80 8 60 C4 40 14 20 32 11 C46 4 60 4 73 10 Z',
  'M78 15 C93 27 95 50 85 68 C75 86 55 96 36 88 C17 80 6 60 10 40 C14 20 33 6 52 6 C62 6 71 9 78 15 Z',
  'M60 6 C80 6 96 22 94 44 C92 62 98 80 82 90 C64 100 40 96 24 84 C8 72 2 50 12 32 C22 14 40 6 60 6 Z',
];

function Decor({ size, style, children }: { size: number; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ position: 'absolute', width: size, height: size }, style]}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        {children}
      </Svg>
    </View>
  );
}

export function Blob({
  color,
  size = 120,
  variant = 0,
  opacity = 1,
  style,
}: {
  color: string;
  size?: number;
  variant?: 0 | 1 | 2;
  opacity?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Decor size={size} style={style}>
      <Path d={BLOBS[variant]} fill={color} opacity={opacity} />
    </Decor>
  );
}

export function Ring({
  color,
  size = 80,
  thickness = 10,
  opacity = 1,
  style,
}: {
  color: string;
  size?: number;
  thickness?: number;
  opacity?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = (thickness / size) * 100;
  return (
    <Decor size={size} style={style}>
      <Circle cx={50} cy={50} r={50 - t / 2} stroke={color} strokeWidth={t} fill="none" opacity={opacity} />
    </Decor>
  );
}

export function Sparkle({ color, size = 28, style }: { color: string; size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <Decor size={size} style={style}>
      <Path d="M50 4 C54 34 66 46 96 50 C66 54 54 66 50 96 C46 66 34 54 4 50 C34 46 46 34 50 4 Z" fill={color} />
    </Decor>
  );
}
