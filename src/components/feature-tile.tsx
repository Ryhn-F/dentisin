import { View, type StyleProp, type ViewStyle } from 'react-native';

import { palette, useTheme } from '@/core/theme';
import { cn } from '@/lib/utils';

import { Blob, Ring } from './decor';
import { Icon, type IconName } from './icon';
import { PressableScale } from './ui/pressable-scale';
import { Text, TextClassContext } from './ui/text';

export type FeatureTone = 'blue' | 'sun' | 'coral' | 'lavender';

const tones: Record<FeatureTone, { bg: string; text: string; icon: string; blob: string; ring: string }> = {
  blue: { bg: 'bg-primary', text: 'text-primary-on', icon: palette.primary, blob: palette.primaryDeep, ring: palette.accent },
  sun: { bg: 'bg-sun', text: 'text-sun-on', icon: palette.text, blob: palette.coral, ring: palette.card },
  coral: { bg: 'bg-coral', text: 'text-coral-on', icon: palette.text, blob: palette.accent, ring: palette.card },
  lavender: { bg: 'bg-tint-lavender', text: 'text-ink', icon: palette.primary, blob: palette.card, ring: palette.primary },
};

export type FeatureStatus = 'active' | 'soon';

// Bold, saturated feature card (design references: course cards). "soon" cards say
// why they are unavailable instead of pretending to work.
export function FeatureTile({
  icon,
  title,
  description,
  tone,
  status = 'active',
  statusLabel,
  onPress,
  compact = false,
  style,
  testID,
}: {
  icon: IconName;
  title: string;
  description?: string;
  tone: FeatureTone;
  status?: FeatureStatus;
  statusLabel?: string;
  onPress?: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { touch } = useTheme();
  const t = tones[tone];
  const disabled = status !== 'active';

  return (
    <TextClassContext.Provider value={t.text}>
      <PressableScale
        testID={testID}
        accessibilityRole="button"
        // One sentence per part; strip end punctuation first so it never reads "..".
        accessibilityLabel={[title, description, statusLabel]
          .filter((part): part is string => !!part)
          .map((part) => part.replace(/[.!?]+$/, ''))
          .join('. ')}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        className={cn('justify-between gap-4 overflow-hidden rounded-card p-5', t.bg)}
        style={{ borderCurve: 'continuous' }}
        minHeight={compact ? touch.large * 2.4 : touch.large * 2.6}
        // Tiles sit side by side in rows: grow with the tallest one.
        fill
        containerStyle={style}
      >
        <Blob color={t.blob} size={compact ? 110 : 150} variant={1} opacity={0.35} style={{ right: -36, top: -40 }} />
        <Ring color={t.ring} size={compact ? 44 : 56} thickness={8} opacity={0.6} style={{ right: 18, bottom: -14 }} />
        <View className={cn('size-14 items-center justify-center rounded-2xl bg-card', disabled && 'opacity-80')}>
          <Icon name={icon} size={30} color={disabled ? palette.textSecondary : t.icon} />
        </View>
        <View className="gap-1">
          <Text variant={compact ? 'headline' : 'title'}>{title}</Text>
          {description && !compact ? <Text variant="caption">{description}</Text> : null}
          {statusLabel ? (
            <View className="mt-1 flex-row items-center gap-1 self-start rounded-full bg-card px-3 py-1">
              <Icon name="schedule" size={14} color={palette.textSecondary} />
              <Text variant="label" tone="secondary">
                {statusLabel}
              </Text>
            </View>
          ) : null}
        </View>
      </PressableScale>
    </TextClassContext.Provider>
  );
}
