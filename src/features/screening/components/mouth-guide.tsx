import { View } from 'react-native';
import Svg, { ClipPath, Defs, G, Line, Path, Rect } from 'react-native-svg';

import { palette } from '@/core/theme';

export type FrameRect = { x: number; y: number; width: number; height: number };

/** Capture frame proportions (wide: a smile with lips pulled back). Shared by guide and camera. */
export const FRAME_ASPECT = 0.56;

export function roundedRectPath({ x, y, width: w, height: h }: FrameRect, r: number): string {
  return [
    `M${x + r} ${y}`,
    `H${x + w - r}`,
    `A${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V${y + h - r}`,
    `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H${x + r}`,
    `A${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V${y + r}`,
    `A${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ');
}

/** Four corner brackets around the frame. */
export function cornerPaths({ x, y, width: w, height: h }: FrameRect, len: number): string[] {
  return [
    `M${x} ${y + len} V${y} H${x + len}`,
    `M${x + w - len} ${y} H${x + w} V${y + len}`,
    `M${x + w} ${y + h - len} V${y + h} H${x + w - len}`,
    `M${x + len} ${y + h} H${x} V${y + h - len}`,
  ];
}

const TEETH = 6;

// ORIGINAL simple drawing of the target view (app/CLAUDE.md §3.6): front teeth together,
// lips pulled back, inside the capture frame. Friendly shapes, no realistic teeth or lesions.
export function MouthGuide({ width = 280, accessibilityLabel }: { width?: number; accessibilityLabel: string }) {
  const height = Math.round(width * FRAME_ASPECT);
  const frame: FrameRect = { x: 8, y: 8, width: width - 16, height: height - 16 };
  const cx = width / 2;
  const cy = height / 2;
  const mw = width * 0.36; // half-width of the lips
  const lips = `M${cx - mw} ${cy} Q${cx} ${cy - height * 0.42} ${cx + mw} ${cy} Q${cx} ${cy + height * 0.46} ${cx - mw} ${cy} Z`;
  const iw = mw * 0.86;
  const inner = `M${cx - iw} ${cy} Q${cx} ${cy - height * 0.32} ${cx + iw} ${cy} Q${cx} ${cy + height * 0.34} ${cx - iw} ${cy} Z`;
  const toothW = (iw * 1.5) / TEETH;
  const teethX = cx - (toothW * TEETH) / 2;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Svg width={width} height={height}>
        <Defs>
          <ClipPath id="mouth-inner">
            <Path d={inner} />
          </ClipPath>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} rx={20} fill={palette.tints.sky} />
        <Path d={lips} fill={palette.coral} />
        <Path d={inner} fill={palette.text} />
        <G clipPath="url(#mouth-inner)">
          <Rect x={cx - iw} y={cy - height * 0.2} width={iw * 2} height={height * 0.07} fill={palette.tints.peach} />
          {Array.from({ length: TEETH }, (_, i) => (
            <G key={i}>
              <Rect x={teethX + i * toothW + 1} y={cy - height * 0.15} width={toothW - 2} height={height * 0.15 - 1} rx={4} fill={palette.card} />
              <Rect x={teethX + i * toothW + 1} y={cy + 1} width={toothW - 2} height={height * 0.13} rx={4} fill={palette.card} />
            </G>
          ))}
        </G>
        <Line x1={frame.x + 14} x2={frame.x + frame.width - 14} y1={cy} y2={cy} stroke={palette.primary} strokeWidth={1.5} strokeDasharray="6 6" opacity={0.6} />
        <Path d={roundedRectPath(frame, 16)} stroke={palette.primary} strokeWidth={2} strokeDasharray="8 8" fill="none" />
        {cornerPaths(frame, 26).map((d) => (
          <Path key={d} d={d} stroke={palette.primary} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        ))}
      </Svg>
    </View>
  );
}
