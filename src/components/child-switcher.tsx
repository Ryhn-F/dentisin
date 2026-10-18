import { ScrollView, View } from 'react-native';

import { id } from '@/core/i18n/id';
import { palette, useTheme } from '@/core/theme';
import { cn } from '@/lib/utils';

import { PressableScale } from './ui/pressable-scale';
import { Text } from './ui/text';

export type ChildOption = { id: string; nickname: string };

// Avatar colors rotate so siblings are easy to tell apart (not a meaning carrier).
const avatar = ['bg-sun', 'bg-coral', 'bg-tint-mint', 'bg-tint-sky'];

// Nicknames exist only on this device (the backend stores no names). Callers pass a display
// label for children without one (e.g. "Anak 2"); a blank label still gets a generic name so the
// chip never renders empty for a screen reader.
export function ChildSwitcher({
  kids,
  activeId,
  onChange,
}: {
  kids: readonly ChildOption[];
  activeId: string | null;
  onChange: (id: string) => void;
}) {
  const { touch } = useTheme();
  if (kids.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={id.components.childSwitcher.label}
      contentContainerClassName="gap-2 py-1"
    >
      {kids.map((kid, i) => {
        const selected = kid.id === activeId;
        const label = kid.nickname.trim() || id.components.childSwitcher.unnamed;
        return (
          <PressableScale
            key={kid.id}
            testID={`child-chip-${kid.id}`}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => onChange(kid.id)}
            className={cn(
              'flex-row items-center gap-2 rounded-full border-2 py-1 pl-1 pr-4',
              selected ? 'border-primary bg-primary' : 'border-separator bg-card',
            )}
            minHeight={touch.regular}
          >
            <View className={cn('size-9 items-center justify-center rounded-full', avatar[i % avatar.length])}>
              <Text variant="headline" style={{ color: palette.text }}>
                {label.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <Text variant="label" tone={selected ? 'onPrimary' : 'default'}>
              {label}
            </Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}
