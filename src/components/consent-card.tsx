import { View } from 'react-native';

import { id } from '@/core/i18n/id';
import { shadows, useTheme } from '@/core/theme';
import { cn } from '@/lib/utils';

import { IconTile } from './icon-tile';
import type { IconName } from './icon';
import { Switch } from './ui/switch';
import { Text } from './ui/text';

export type ConsentCopy = {
  title: string;
  what: string;
  why: string;
  where: string;
  ifDeclined: string;
  /** Consent (c)/(d): who can see the data. */
  who?: string;
  /** Consent (c)/(d): how long it is kept. */
  howLong?: string;
  /** What happens when the consent is withdrawn. */
  withdraw?: string;
};

// One card per consent; never bundled, never an "accept all". The caller owns the
// value and must default it to false (app/CLAUDE.md §3.5).
// `disabled` is for a consent that cannot be given yet (feature off): the switch is locked
// and `badge` says why in a word. `note` is a short line under the texts (sync state, hints).
export function ConsentCard({
  copy,
  value,
  onValueChange,
  icon = 'verified-user',
  disabled = false,
  badge,
  note,
  testID,
}: {
  copy: ConsentCopy;
  value: boolean;
  onValueChange: (next: boolean) => void;
  icon?: IconName;
  disabled?: boolean;
  badge?: string;
  note?: string;
  testID?: string;
}) {
  const { touch } = useTheme();
  const labels = id.consent.labels;
  const extra = id.consentsV2.labels;
  const rows: [string, string][] = [
    [labels.what, copy.what],
    [labels.why, copy.why],
    [labels.where, copy.where],
    ...(copy.who ? ([[extra.who, copy.who]] as [string, string][]) : []),
    ...(copy.howLong ? ([[extra.howLong, copy.howLong]] as [string, string][]) : []),
    ...(copy.withdraw ? ([[extra.withdraw, copy.withdraw]] as [string, string][]) : []),
    [labels.ifDeclined, copy.ifDeclined],
  ];

  return (
    <View
      testID={testID}
      className={cn('gap-4 rounded-card bg-card p-5', disabled && 'opacity-80')}
      style={{ borderCurve: 'continuous', boxShadow: shadows.card }}
    >
      <View className="flex-row items-center gap-3" style={{ minHeight: touch.regular }}>
        <IconTile name={icon} tone={value ? 'blue' : 'lavender'} size={44} />
        <View className="flex-1 gap-1">
          <Text variant="headline">{copy.title}</Text>
          {badge ? (
            <View className="self-start rounded-full bg-tint-cream px-3 py-0.5">
              <Text variant="caption">{badge}</Text>
            </View>
          ) : null}
        </View>
        <Switch
          testID={testID ? `${testID}-switch` : undefined}
          accessibilityLabel={copy.title}
          checked={value}
          disabled={disabled}
          onCheckedChange={onValueChange}
        />
      </View>
      <View className="gap-3 rounded-tile bg-bg p-4">
        {rows.map(([label, text]) => (
          <View key={label} className="gap-0.5">
            <Text variant="label" tone="secondary">
              {label}
            </Text>
            <Text variant="body">{text}</Text>
          </View>
        ))}
      </View>
      {note ? (
        <Text variant="caption" tone="secondary" testID={testID ? `${testID}-note` : undefined}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}
