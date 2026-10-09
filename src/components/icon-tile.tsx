import { View } from 'react-native';

import { palette } from '@/core/theme';
import { cn } from '@/lib/utils';

import { Icon, type IconName } from './icon';

export type IconTileTone = 'blue' | 'sun' | 'coral' | 'lavender' | 'mint' | 'white' | 'danger';

const tones: Record<IconTileTone, { bg: string; fg: string }> = {
  blue: { bg: 'bg-primary', fg: palette.onPrimary },
  sun: { bg: 'bg-sun', fg: palette.onAccent },
  coral: { bg: 'bg-coral', fg: palette.onCoral },
  lavender: { bg: 'bg-tint-lavender', fg: palette.primary },
  mint: { bg: 'bg-tint-mint', fg: palette.success },
  white: { bg: 'bg-card', fg: palette.primary },
  danger: { bg: 'bg-tint-peach', fg: palette.danger },
};

// Rounded-square icon holder (design references: blue play tiles, feature icons).
export function IconTile({
  name,
  tone = 'blue',
  size = 48,
  round = false,
  className,
}: {
  name: IconName;
  tone?: IconTileTone;
  size?: number;
  round?: boolean;
  className?: string;
}) {
  const t = tones[tone];
  return (
    <View
      className={cn('items-center justify-center', round ? 'rounded-full' : 'rounded-2xl', t.bg, className)}
      style={{ width: size, height: size, borderCurve: 'continuous' }}
    >
      <Icon name={name} size={Math.round(size * 0.5)} color={t.fg} />
    </View>
  );
}
