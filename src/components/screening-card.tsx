import { View } from 'react-native';

import { id } from '@/core/i18n/id';
import { palette, shadows, useTheme } from '@/core/theme';

import { Ring, Sparkle } from './decor';
import { Icon } from './icon';
import { IconTile } from './icon-tile';
import { PressableScale } from './ui/pressable-scale';
import { Text, TextClassContext } from './ui/text';

const t = id.home;

// Bold yellow entry point to the main feature (also the center tab). While the feature
// waits for the dentist's sign-off it says so, and leads to the explanation page.
export function ScreeningCard({ onPress, testID }: { onPress: () => void; testID?: string }) {
  const { touch } = useTheme();
  return (
    <TextClassContext.Provider value="text-sun-on">
      <PressableScale
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${t.screeningCardTitle}. ${t.screeningCardBody} ${id.common.soon}.`}
        onPress={onPress}
        minHeight={touch.large * 1.75}
        className="flex-row items-center gap-4 overflow-hidden rounded-card bg-sun p-5"
        style={{ borderCurve: 'continuous', boxShadow: shadows.accentButton }}
      >
        <Ring color={palette.card} size={96} thickness={12} opacity={0.55} style={{ right: -26, top: -34 }} />
        <Sparkle color={palette.card} size={20} style={{ right: 64, bottom: 10 }} />
        <IconTile name="photo-camera" tone="blue" size={60} round />
        <View className="flex-1 gap-1">
          <Text variant="headline">{t.screeningCardTitle}</Text>
          <Text variant="caption">{t.screeningCardBody}</Text>
          <View className="mt-1 flex-row items-center gap-1 self-start rounded-full bg-card px-2.5 py-0.5">
            <Icon name="schedule" size={14} color={palette.textSecondary} />
            <Text variant="label" tone="secondary">
              {id.common.soon}
            </Text>
          </View>
        </View>
        <View className="size-11 items-center justify-center rounded-full bg-ink">
          <Icon name="arrow-forward" size={22} color={palette.onPrimary} />
        </View>
      </PressableScale>
    </TextClassContext.Provider>
  );
}
