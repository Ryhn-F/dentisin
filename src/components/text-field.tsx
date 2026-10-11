import { useState, type ReactNode, type Ref } from 'react';
import { View, type TextInput, type TextInputProps } from 'react-native';

import { useTheme } from '@/core/theme';
import { cn } from '@/lib/utils';

import { Input } from './ui/input';
import { Text } from './ui/text';

export type TextFieldProps = TextInputProps & {
  label: string;
  helper?: string;
  error?: string | null;
  /** Element inside the field on the right (e.g. show-password button). */
  trailing?: ReactNode;
  /** For moving focus to the next field ("Lanjut" on the keyboard). */
  ref?: Ref<TextInput>;
};

// Rounded white field with a visible outline (3:1 non-text contrast, WCAG 1.4.11);
// thick blue ring on focus, red on error.
export function TextField({ label, helper, error, trailing, onFocus, onBlur, ...input }: TextFieldProps) {
  const { touch } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View className="gap-1.5">
      <Text variant="label">{label}</Text>
      <View
        className={cn(
          'flex-row items-center rounded-field bg-card pl-4',
          error ? 'border-2 border-danger' : focused ? 'border-2 border-primary' : 'border-[1.5px] border-outline',
        )}
        style={{ minHeight: touch.regular + 8, borderCurve: 'continuous' }}
      >
        <Input
          accessibilityLabel={label}
          accessibilityHint={error ?? helper}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...input}
        />
        {trailing ?? <View className="w-4" />}
      </View>
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : helper ? (
        <Text variant="caption" tone="secondary">
          {helper}
        </Text>
      ) : null}
    </View>
  );
}
