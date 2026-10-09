// Based on React Native Reusables `Button` (MIT): cva variants + TextClassContext.
// Restyled to the references: pill shape, bold label, saturated fills, soft colored glow.
import { cva, type VariantProps } from 'class-variance-authority';
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette, shadows, useTheme } from '@/core/theme';
import { cn } from '@/lib/utils';

import { Icon, type IconName } from '../icon';
import { PressableScale } from './pressable-scale';
import { Text, TextClassContext } from './text';

export const buttonVariants = cva('flex-row items-center justify-center gap-2 overflow-hidden rounded-full px-7', {
  variants: {
    variant: {
      primary: 'bg-primary',
      accent: 'bg-sun',
      secondary: 'bg-tint-lavender',
      inverse: 'bg-card',
      ghost: 'bg-transparent px-3',
      danger: 'bg-level-emergency',
    },
  },
  defaultVariants: { variant: 'primary' },
});

const buttonTextVariants = cva('', {
  variants: {
    variant: {
      primary: 'text-primary-on',
      accent: 'text-sun-on',
      secondary: 'text-primary-deep',
      inverse: 'text-primary',
      ghost: 'text-primary',
      danger: 'text-white',
    },
  },
  defaultVariants: { variant: 'primary' },
});

const glow: Partial<Record<ButtonVariant, string>> = {
  primary: shadows.button,
  accent: shadows.accentButton,
};

const spinnerColor: Record<ButtonVariant, string> = {
  primary: palette.onPrimary,
  accent: palette.onAccent,
  secondary: palette.primaryDeep,
  inverse: palette.primary,
  ghost: palette.primary,
  danger: palette.onPrimary,
};

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'regular',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  accessibilityHint,
  className,
  style,
  testID,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'regular' | 'large';
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { touch } = useTheme();
  const inactive = disabled || loading;
  const fg = spinnerColor[variant];

  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant })}>
      <PressableScale
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: inactive, busy: loading }}
        disabled={inactive}
        onPress={onPress}
        scaleTo={variant === 'ghost' ? 1 : 0.96}
        className={cn(buttonVariants({ variant }), disabled && 'opacity-40')}
        style={{ boxShadow: inactive ? undefined : glow[variant] }}
        // Caller classes/styles position the button; the touch target is mode-dependent
        // (48/56 adult, 56/64 child) — a runtime value.
        containerClassName={className}
        containerStyle={[{ minHeight: touch[size] }, style]}
      >
        {/* Label stays visible while loading so the action remains readable. */}
        <View className="flex-row items-center gap-2">
          {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={22} color={fg} /> : null}
          <Text variant="headline" className="text-center">
            {title}
          </Text>
          {iconRight && !loading ? <Icon name={iconRight} size={22} color={fg} /> : null}
        </View>
      </PressableScale>
    </TextClassContext.Provider>
  );
}
