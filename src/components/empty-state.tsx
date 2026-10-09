import { View } from 'react-native';

import { palette } from '@/core/theme';

import { Blob } from './decor';
import { Icon, type IconName } from './icon';
import { Mascot, type MascotMood } from './mascot';
import { Button } from './ui/button';
import { Text } from './ui/text';

// Friendly empty / info state: the mascot (or an icon) on a soft blob, one line, one action.
export function EmptyState({
  icon,
  mascot,
  title,
  message,
  action,
  testID,
}: {
  icon?: IconName;
  /** Show the mascot with this mood instead of an icon. */
  mascot?: MascotMood;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
  testID?: string;
}) {
  return (
    <View testID={testID} className="items-center gap-3 py-6">
      <View className="size-36 items-center justify-center">
        <Blob color={palette.tints.lavender} size={144} variant={2} />
        {mascot ? (
          <Mascot mood={mascot} size={112} />
        ) : (
          <View className="size-20 items-center justify-center rounded-full bg-primary">
            <Icon name={icon ?? 'info-outline'} size={40} color={palette.onPrimary} />
          </View>
        )}
      </View>
      <Text variant="title" className="text-center">
        {title}
      </Text>
      {message ? (
        <Text variant="body" tone="secondary" className="max-w-[320px] text-center">
          {message}
        </Text>
      ) : null}
      {action ? <Button title={action.label} onPress={action.onPress} variant="accent" className="mt-2" /> : null}
    </View>
  );
}
