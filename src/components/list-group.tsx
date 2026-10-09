import { Children, Fragment, type ReactNode } from 'react';
import { View } from 'react-native';

import { palette, shadows, useTheme } from '@/core/theme';
import { cn } from '@/lib/utils';

import { Icon, type IconName } from './icon';
import { IconTile, type IconTileTone } from './icon-tile';
import { PressableScale } from './ui/pressable-scale';
import { Text } from './ui/text';

// A white rounded group with hairlines between rows (not a card per row).
export function ListGroup({
  title,
  footer,
  children,
  className,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
  className?: string;
}) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View className={cn('gap-2', className)}>
      {title ? (
        <Text variant="headline" accessibilityRole="header" className="px-1">
          {title}
        </Text>
      ) : null}
      <View className="overflow-hidden rounded-card bg-card" style={{ borderCurve: 'continuous', boxShadow: shadows.card }}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 ? <View className="ml-20 h-px bg-separator" /> : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? (
        <Text variant="caption" tone="secondary" className="px-1">
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  value,
  icon,
  iconTone = 'lavender',
  onPress,
  destructive = false,
  disabled = false,
  accessory,
  accessibilityLabel,
  testID,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: IconName;
  iconTone?: IconTileTone;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Custom trailing element (e.g. a Switch). Defaults to a chevron when pressable. */
  accessory?: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { touch } = useTheme();
  const trailing =
    accessory ??
    (onPress && !disabled ? (
      <View className="size-8 items-center justify-center rounded-full bg-tint-lavender">
        <Icon name="chevron-right" size={22} color={palette.primary} />
      </View>
    ) : null);

  const content = (
    <>
      {icon ? <IconTile name={icon} tone={destructive ? 'danger' : iconTone} size={44} /> : null}
      <View className="flex-1 gap-0.5">
        <Text variant="bodyStrong" tone={destructive ? 'danger' : undefined}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="caption" tone="secondary" className="max-w-[45%] text-right">
          {value}
        </Text>
      ) : null}
      {trailing}
    </>
  );

  const rowClass = cn('flex-row items-center gap-3 px-4 py-3', disabled && 'opacity-50');
  const rowStyle = { minHeight: touch.regular + 16 };

  if (!onPress) {
    return (
      <View testID={testID} className={rowClass} style={rowStyle} accessible={!accessory} accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle, value].filter(Boolean).join(', ')}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      // Rows highlight instead of shrinking.
      scaleTo={1}
      android_ripple={{ color: palette.ripple }}
      className={rowClass}
      containerStyle={rowStyle}
    >
      {content}
    </PressableScale>
  );
}
