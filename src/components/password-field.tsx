import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { id } from '@/core/i18n/id';
import { palette, useTheme } from '@/core/theme';

import { Icon } from './icon';
import { TextField, type TextFieldProps } from './text-field';
import { Text } from './ui/text';

const t = id.components.password;

export type PasswordRuleState = { label: string; met: boolean };

export function PasswordField({
  rules,
  ...field
}: Omit<TextFieldProps, 'secureTextEntry' | 'trailing'> & { rules?: readonly PasswordRuleState[] }) {
  const { touch } = useTheme();
  const [visible, setVisible] = useState(false);

  return (
    <View className="gap-2">
      <TextField
        {...field}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? t.hide : t.show}
            onPress={() => setVisible((v) => !v)}
            className="items-center justify-center"
            style={{ width: touch.regular, height: touch.regular }}
          >
            <Icon name={visible ? 'visibility-off' : 'visibility'} size={22} color={palette.textSecondary} />
          </Pressable>
        }
      />
      {rules ? (
        <View accessibilityRole="list" className="flex-row flex-wrap gap-2">
          {rules.map((rule) => (
            <View
              key={rule.label}
              accessible
              accessibilityLabel={`${rule.label}: ${rule.met ? t.ruleMet : t.ruleNotMet}`}
              className={rule.met ? 'flex-row items-center gap-1 rounded-full bg-tint-mint px-3 py-1' : 'flex-row items-center gap-1 rounded-full bg-card px-3 py-1'}
            >
              <Icon
                name={rule.met ? 'check-circle' : 'radio-button-unchecked'}
                size={16}
                color={rule.met ? palette.success : palette.outline}
              />
              <Text variant="caption" tone={rule.met ? 'success' : 'secondary'}>
                {rule.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
