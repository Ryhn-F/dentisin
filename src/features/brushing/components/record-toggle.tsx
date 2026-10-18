import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { palette, useTheme } from '@/core/theme';

import type { ProofAudience } from '../camera-availability';

const r = id.recording;

/**
 * Pre-start choice "record a video" (child: for the parent; teen: for themself). States, before
 * anything is recorded, who can watch and that the clip is deleted automatically.
 */
export function RecordToggle({
  audience,
  value,
  onChange,
  retentionDays,
}: {
  audience: ProofAudience;
  value: boolean;
  onChange: (value: boolean) => void;
  retentionDays: number;
}) {
  const { touch } = useTheme();
  const label = audience === 'parent' ? r.toggleParent : r.toggleSelf;
  const note = audience === 'parent' ? r.noteParent(retentionDays) : r.noteSelf(retentionDays);
  return (
    <View className="gap-1 rounded-tile bg-card px-4 py-2" style={{ borderCurve: 'continuous' }}>
      <Pressable
        testID="record-toggle"
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={note}
        accessibilityState={{ checked: value }}
        onPress={() => onChange(!value)}
        className="flex-row items-center gap-3"
        style={{ minHeight: touch.regular }}
      >
        <Icon name={value ? 'videocam' : 'videocam-off'} size={24} color={value ? palette.primary : palette.textSecondary} />
        <Text variant="bodyStrong" className="flex-1">
          {label}
        </Text>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Switch checked={value} onCheckedChange={onChange} />
        </View>
      </Pressable>
      <Text variant="caption" tone="secondary" className="pb-1">
        {note}
      </Text>
    </View>
  );
}
