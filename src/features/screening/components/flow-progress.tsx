import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { cn } from '@/lib/utils';

export const FLOW_STEPS = 4;

// "Langkah 2 dari 4" + a segmented bar: questions, symptoms, photo, result.
export function FlowProgress({ step }: { step: number }) {
  const label = id.screening.stepOf(step, FLOW_STEPS);
  return (
    <View accessible accessibilityLabel={label} className="gap-2">
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      <View className="flex-row gap-1.5">
        {Array.from({ length: FLOW_STEPS }, (_, i) => (
          <View key={i} className={cn('h-2 flex-1 rounded-full', i < step ? 'bg-primary' : 'bg-separator')} />
        ))}
      </View>
    </View>
  );
}
