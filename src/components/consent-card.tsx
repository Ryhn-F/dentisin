import { View } from 'react-native';

import { id } from '@/core/i18n/id';
import { shadows, useTheme } from '@/core/theme';

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
};

// One card per consent; never bundled, never an "accept all". The caller owns the
// value and must default it to false (app/CLAUDE.md §3.5).
export function ConsentCard({
  copy,
  value,
  onValueChange,
  icon = 'verified-user',
  testID,
}: {
  copy: ConsentCopy;
  value: boolean;
  onValueChange: (next: boolean) => void;
  icon?: IconName;
  testID?: string;
}) {
  const { touch } = useTheme();
  const labels = id.consent.labels;
  const rows: [string, string][] = [
    [labels.what, copy.what],
    [labels.why, copy.why],
    [labels.where, copy.where],
    [labels.ifDeclined, copy.ifDeclined],
  ];

  return (
    <View testID={testID} className="gap-4 rounded-card bg-card p-5" style={{ borderCurve: 'continuous', boxShadow: shadows.card }}>
      <View className="flex-row items-center gap-3" style={{ minHeight: touch.regular }}>
        <IconTile name={icon} tone={value ? 'blue' : 'lavender'} size={44} />
        <Text variant="headline" className="flex-1">
          {copy.title}
        </Text>
        <Switch
          testID={testID ? `${testID}-switch` : undefined}
          accessibilityLabel={copy.title}
          checked={value}
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
    </View>
  );
}
