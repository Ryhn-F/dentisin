import type { ReactNode } from 'react';
import { View } from 'react-native';

import { palette } from '@/core/theme';
import { cn } from '@/lib/utils';

import { Icon, type IconName } from './icon';
import { Text } from './ui/text';

type Tone = 'info' | 'warning' | 'success' | 'error';

const toneStyle: Record<Tone, { bg: string; dot: string; icon: IconName; iconColor: string }> = {
  info: { bg: 'bg-tint-sky', dot: 'bg-primary', icon: 'info-outline', iconColor: palette.onPrimary },
  warning: { bg: 'bg-tint-cream', dot: 'bg-sun', icon: 'schedule', iconColor: palette.onAccent },
  success: { bg: 'bg-tint-mint', dot: 'bg-success', icon: 'check', iconColor: palette.onPrimary },
  error: { bg: 'bg-tint-peach', dot: 'bg-danger', icon: 'priority-high', iconColor: palette.onPrimary },
};

// Inline message. Errors stay next to the form (never an alert dialog).
export function Banner({
  tone = 'info',
  title,
  message,
  icon,
  action,
  className,
  testID,
}: {
  tone?: Tone;
  title?: string;
  message: string;
  icon?: IconName;
  action?: ReactNode;
  className?: string;
  testID?: string;
}) {
  const s = toneStyle[tone];
  return (
    <View
      testID={testID}
      // Errors are read as one alert; banners with an action keep their button focusable.
      accessible={tone === 'error' && !action}
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'error' ? 'polite' : undefined}
      className={cn('flex-row gap-3 rounded-tile p-4', s.bg, className)}
      style={{ borderCurve: 'continuous' }}
    >
      <View className={cn('size-8 items-center justify-center rounded-full', s.dot)}>
        <Icon name={icon ?? s.icon} size={18} color={s.iconColor} />
      </View>
      <View className="flex-1 gap-1">
        {title ? <Text variant="bodyStrong">{title}</Text> : null}
        <Text variant="caption">{message}</Text>
        {action}
      </View>
    </View>
  );
}
