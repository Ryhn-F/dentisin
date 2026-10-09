import { View } from 'react-native';

import { id } from '@/core/i18n/id';
import { palette, shadows } from '@/core/theme';

import { Icon, type IconName } from './icon';
import { Text } from './ui/text';

export type SyncStatus = 'synced' | 'pending' | 'offline' | 'local';

const icons: Record<SyncStatus, IconName> = {
  synced: 'cloud-done',
  pending: 'cloud-upload',
  offline: 'cloud-off',
  local: 'smartphone',
};

// Offline is a normal state, not an error: neutral colors only.
export function SyncStatusPill({ status }: { status: SyncStatus }) {
  const label = id.components.sync[status];
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      className="flex-row items-center gap-1.5 rounded-full bg-card py-1.5 pl-2 pr-3"
      style={{ boxShadow: shadows.card }}
    >
      <View className="size-6 items-center justify-center rounded-full bg-tint-lavender">
        <Icon name={icons[status]} size={14} color={status === 'synced' ? palette.success : palette.primary} />
      </View>
      <Text variant="label" tone="secondary">
        {label}
      </Text>
    </View>
  );
}
