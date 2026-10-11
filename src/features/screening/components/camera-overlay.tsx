import { StyleSheet } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { palette } from '@/core/theme';

import { cornerPaths, roundedRectPath, type FrameRect } from './mouth-guide';

// Veil over the live preview with a clear window where the teeth should be, corner brackets
// and a dashed line where the upper and lower front teeth meet. Purely visual: the hint text
// next to it carries the meaning for TalkBack.
export function CameraOverlay({
  width,
  height,
  frame,
  highlight = false,
}: {
  width: number;
  height: number;
  frame: FrameRect;
  /** Brighter brackets while the countdown runs. */
  highlight?: boolean;
}) {
  const veil = `M0 0 H${width} V${height} H0 Z ${roundedRectPath(frame, 24)}`;
  const midY = frame.y + frame.height / 2;
  return (
    <Svg
      width={width}
      height={height}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path d={veil} fill={palette.scrim} fillRule="evenodd" />
      <Line
        x1={frame.x + 20}
        x2={frame.x + frame.width - 20}
        y1={midY}
        y2={midY}
        stroke={palette.card}
        strokeOpacity={0.55}
        strokeWidth={1.5}
        strokeDasharray="8 8"
      />
      <Path d={roundedRectPath(frame, 24)} stroke={palette.card} strokeOpacity={0.5} strokeWidth={1.5} fill="none" />
      {cornerPaths(frame, 34).map((d) => (
        <Path
          key={d}
          d={d}
          stroke={highlight ? palette.card : palette.accent}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </Svg>
  );
}
