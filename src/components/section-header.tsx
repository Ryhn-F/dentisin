import { View } from 'react-native';

import { Button } from './ui/button';
import { Text } from './ui/text';

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View className="flex-row items-center justify-between gap-2">
      <Text variant="title" accessibilityRole="header" className="shrink">
        {title}
      </Text>
      {action ? <Button title={action.label} variant="ghost" iconRight="arrow-forward" onPress={action.onPress} /> : null}
    </View>
  );
}
