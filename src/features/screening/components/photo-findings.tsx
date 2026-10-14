import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { palette } from '@/core/theme';
import type { DetectionClass } from '@/domain/triage';

export type Finding = { class: DetectionClass; confidence: number; box: { x: number; y: number; w: number; h: number } };

// The photo with one numbered box per finding (ADR 014: boxes are overlay only). Classes
// differ by line style as well as by the list below, so color is never the only carrier.
export function PhotoWithFindings({
  uri,
  width,
  height,
  findings = [],
  accessibilityLabel,
  testID,
}: {
  uri: string;
  width: number;
  height: number;
  findings?: readonly Finding[];
  accessibilityLabel: string;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      className="w-full overflow-hidden rounded-card"
      style={{ aspectRatio: width / height, backgroundColor: palette.cameraBg, borderCurve: 'continuous' }}
    >
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      {findings.map((f, i) => (
        <View
          key={`${f.class}-${i}`}
          testID={`finding-box-${i}`}
          style={{
            position: 'absolute',
            left: `${f.box.x * 100}%`,
            top: `${f.box.y * 100}%`,
            width: `${f.box.w * 100}%`,
            height: `${f.box.h * 100}%`,
            borderWidth: 3,
            borderRadius: 8,
            borderColor: palette.accent,
            borderStyle: f.class === 'caries_permanent' ? 'dashed' : 'solid',
          }}
        >
          <View className="absolute -left-1 -top-1 size-6 items-center justify-center rounded-full bg-sun">
            <Text variant="label" tone="onAccent" style={{ fontSize: 12, lineHeight: 16 }}>
              {i + 1}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
