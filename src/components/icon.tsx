import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

// One icon family for the whole app (Material Icons; Android-only app).
export type IconName = ComponentProps<typeof MaterialIcons>['name'];

export function Icon({
  name,
  size = 24,
  color,
}: {
  name: IconName;
  size?: number;
  color: ColorValue;
}) {
  // Decorative by default: meaning must always be carried by adjacent text.
  return (
    <MaterialIcons
      name={name}
      size={size}
      color={color}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
