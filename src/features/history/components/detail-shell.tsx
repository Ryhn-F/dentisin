import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { IconName } from '@/components/icon';
import { HeroHeader } from '@/components/hero-header';
import { IconTile, type IconTileTone } from '@/components/icon-tile';
import { Screen } from '@/components/screen';
import { Text } from '@/components/ui/text';

// Blue hero (icon, small label, big title, date) over a white sheet, like the other detail screens.
export function DetailShell({
  icon,
  tone = 'sun',
  label,
  title,
  caption,
  titleAccessibilityLabel,
  children,
  testID,
}: {
  icon: IconName;
  tone?: IconTileTone;
  label: string;
  title: string;
  caption?: string;
  titleAccessibilityLabel?: string;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <Screen flush testID={testID}>
      <HeroHeader>
        <View className="flex-row items-center gap-4">
          <IconTile name={icon} tone={tone} size={64} />
          <View className="flex-1">
            <Text variant="label">{label}</Text>
            <Text variant="title" accessibilityLabel={titleAccessibilityLabel}>
              {title}
            </Text>
            {caption ? <Text variant="caption">{caption}</Text> : null}
          </View>
        </View>
      </HeroHeader>
      <View className="gap-6 px-5">{children}</View>
    </Screen>
  );
}
