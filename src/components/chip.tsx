import { palette, useTheme } from '@/core/theme';
import { cn } from '@/lib/utils';

import { Icon, type IconName } from './icon';
import { PressableScale } from './ui/pressable-scale';
import { Text } from './ui/text';

const VISUAL_HEIGHT = 42;

export function Chip({
  label,
  selected = false,
  icon,
  onPress,
  accessibilityLabel,
  testID,
}: {
  label: string;
  selected?: boolean;
  icon?: IconName;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { touch } = useTheme();
  // Visual 42dp, hit area extended to the mode's minimum touch target.
  const slop = Math.max(0, (touch.regular - VISUAL_HEIGHT) / 2);
  const fg = selected ? palette.onPrimary : palette.text;

  return (
    <PressableScale
      testID={testID}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={onPress ? { selected } : undefined}
      onPress={onPress}
      disabled={!onPress}
      hitSlop={{ top: slop, bottom: slop }}
      className={cn(
        'flex-row items-center gap-1.5 rounded-full border-2 px-4',
        selected ? 'border-primary bg-primary' : 'border-separator bg-card',
      )}
      minHeight={VISUAL_HEIGHT}
    >
      {icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text variant="label" tone={selected ? 'onPrimary' : 'default'}>
        {label}
      </Text>
    </PressableScale>
  );
}
