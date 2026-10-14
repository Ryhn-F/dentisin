import { View } from 'react-native';

import { palette, useTheme } from '@/core/theme';
import { cn } from '@/lib/utils';

import { Checkbox } from './ui/checkbox';
import { PressableScale } from './ui/pressable-scale';
import { Text } from './ui/text';

// A labelled checkbox where the whole row is one control: one big touch target and
// one screen-reader element ("checkbox, checked/not checked"), instead of a small box
// and a separate tappable label. Errors outline the row and are announced.
export function CheckboxField({
  label,
  checked,
  onCheckedChange,
  error,
  testID,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  error?: string | null;
  testID?: string;
}) {
  const { touch } = useTheme();
  return (
    <View className="gap-1.5">
      <PressableScale
        testID={testID}
        accessibilityRole="checkbox"
        accessibilityLabel={label}
        accessibilityHint={error ?? undefined}
        accessibilityState={{ checked }}
        onPress={() => onCheckedChange(!checked)}
        scaleTo={1}
        android_ripple={{ color: palette.ripple }}
        minHeight={touch.regular + 16}
        className={cn(
          'flex-row items-center gap-4 rounded-tile border-2 bg-card px-4 py-3',
          error ? 'border-danger' : checked ? 'border-primary' : 'border-separator',
        )}
        style={{ borderCurve: 'continuous' }}
      >
        {/* Visual only: the row above is the control. */}
        <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Checkbox checked={checked} onCheckedChange={onCheckedChange} className={error && !checked ? 'border-danger' : undefined} />
        </View>
        <Text variant="bodyStrong" className="flex-1">
          {label}
        </Text>
      </PressableScale>
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" className="px-1">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
