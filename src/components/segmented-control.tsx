import { Pressable, View } from 'react-native';

import { shadows, useTheme } from '@/core/theme';
import { cn } from '@/lib/utils';

import { Text } from './ui/text';

export type SegmentOption<T extends string> = { value: T; label: string };

// Pill track with a bold blue selected pill (design references: calendar chips).
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  testID,
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { touch } = useTheme();
  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      className="flex-row gap-1 rounded-full bg-card p-1.5"
      style={{ boxShadow: shadows.card }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            className={cn('flex-1 items-center justify-center rounded-full px-2', selected && 'bg-primary')}
            style={{ minHeight: touch.regular - 4 }}
          >
            <Text variant="label" tone={selected ? 'onPrimary' : 'secondary'} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
