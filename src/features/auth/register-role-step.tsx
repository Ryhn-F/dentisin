import { View } from 'react-native';

import { IconTile } from '@/components/icon-tile';
import { Icon, type IconName } from '@/components/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { palette, shadows, useTheme } from '@/core/theme';

import { TEEN_MAX_AGE, TEEN_MIN_AGE } from './register-age';

const t = id.registerFlow.role;

export type RegisterKind = 'guardian' | 'teen';

function RoleCard({
  icon,
  tone,
  title,
  badge,
  body,
  accessibilityLabel,
  onPress,
  testID,
}: {
  icon: IconName;
  tone: 'blue' | 'sun';
  title: string;
  badge?: string;
  body: string;
  accessibilityLabel: string;
  onPress: () => void;
  testID: string;
}) {
  const { touch } = useTheme();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      minHeight={touch.large}
      className="flex-row items-center gap-4 rounded-card bg-card p-5"
      style={{ borderCurve: 'continuous', boxShadow: shadows.card }}
    >
      <IconTile name={icon} tone={tone} size={56} />
      <View className="flex-1 gap-1">
        <Text variant="headline">{title}</Text>
        {badge ? (
          <Text variant="label" tone="primary">
            {badge}
          </Text>
        ) : null}
        <Text variant="body" tone="secondary">
          {body}
        </Text>
      </View>
      <Icon name="chevron-right" size={28} color={palette.textSecondary} />
    </PressableScale>
  );
}

// Step 1 of sign-up: who uses DentisAI. Two big cards, no default choice.
export function RoleStep({ onChoose }: { onChoose: (kind: RegisterKind) => void }) {
  return (
    <View className="gap-4">
      <RoleCard
        testID="register-role-guardian"
        icon="family-restroom"
        tone="blue"
        title={t.guardian.title}
        body={t.guardian.body}
        accessibilityLabel={t.guardian.a11y}
        onPress={() => onChoose('guardian')}
      />
      <RoleCard
        testID="register-role-teen"
        icon="face"
        tone="sun"
        title={t.teen.title}
        badge={t.teen.badge(TEEN_MIN_AGE, TEEN_MAX_AGE)}
        body={t.teen.body}
        accessibilityLabel={t.teen.a11y(TEEN_MIN_AGE, TEEN_MAX_AGE)}
        onPress={() => onChoose('teen')}
      />
    </View>
  );
}
