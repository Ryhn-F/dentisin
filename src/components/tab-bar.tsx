import { View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamilies, palette, shadows } from '@/core/theme';
import { cn } from '@/lib/utils';

import { Icon, type IconName } from './icon';

// Shared look of the bottom tab bars: (tabs) for guardian / teen / guest and kid/ for child
// accounts. Fixed height (pill indicator + label need ~80dp, Material 3 nav bar), so the
// bottom safe-area inset is added by hand.
export const TAB_BAR_HEIGHT = 80;

export function tabIcon(name: IconName) {
  return function TabIcon({ focused, color }: { focused: boolean; color: ColorValue }) {
    // Active tab: bold blue pill behind a white icon (design reference 1, M3 indicator).
    return (
      <View className={cn('h-9 w-14 items-center justify-center rounded-full', focused && 'bg-primary')}>
        <Icon name={name} size={24} color={focused ? palette.onPrimary : color} />
      </View>
    );
  };
}

/** screenOptions for a js-tabs navigator with the app's tab bar. */
export function useTabScreenOptions() {
  const insets = useSafeAreaInsets();
  return {
    tabBarActiveTintColor: palette.primary,
    tabBarInactiveTintColor: palette.textSecondary,
    // The keyboard must not lift the tab bar over form fields.
    tabBarHideOnKeyboard: true,
    tabBarStyle: {
      backgroundColor: palette.card,
      borderTopWidth: 0,
      height: TAB_BAR_HEIGHT + insets.bottom,
      paddingTop: 10,
      paddingBottom: insets.bottom + 10,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      boxShadow: shadows.raised,
      overflow: 'visible' as const,
    },
    tabBarLabelStyle: { fontFamily: fontFamilies.bold, fontSize: 12, lineHeight: 16, marginTop: 4 },
    headerStyle: { backgroundColor: palette.bg },
    headerTintColor: palette.text,
    headerTitleStyle: { fontFamily: fontFamilies.extrabold, fontSize: 18 },
    headerShadowVisible: false,
    sceneStyle: { backgroundColor: palette.bg },
  };
}
