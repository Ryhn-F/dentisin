import { Tabs } from 'expo-router/js-tabs';
import { View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/icon';
import { id } from '@/core/i18n/id';
import { fontFamilies, palette, shadows } from '@/core/theme';
import { cn } from '@/lib/utils';

// Fixed height (pill indicator + label need ~80dp, Material 3 nav bar), so the
// bottom safe-area inset is added by hand.
const TAB_BAR_HEIGHT = 80;

function tabIcon(name: IconName) {
  return function TabIcon({ focused, color }: { focused: boolean; color: ColorValue }) {
    // Active tab: bold blue pill behind a white icon (design reference 1, M3 indicator).
    return (
      <View className={cn('h-9 w-16 items-center justify-center rounded-full', focused && 'bg-primary')}>
        <Icon name={name} size={24} color={focused ? palette.onPrimary : color} />
      </View>
    );
  };
}

// Four always-visible destinations with icon + label (child-friendly navigation).
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textSecondary,
        tabBarStyle: {
          backgroundColor: palette.card,
          borderTopWidth: 0,
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingTop: 10,
          paddingBottom: insets.bottom + 10,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          boxShadow: shadows.raised,
        },
        tabBarLabelStyle: { fontFamily: fontFamilies.bold, fontSize: 12, lineHeight: 16, marginTop: 4 },
        headerStyle: { backgroundColor: palette.bg },
        headerTintColor: palette.text,
        headerTitleStyle: { fontFamily: fontFamilies.extrabold, fontSize: 18 },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: palette.bg },
      }}
    >
      {/* Home opens with its own greeting block, like the reference home screen. */}
      <Tabs.Screen name="home" options={{ title: id.nav.home, tabBarIcon: tabIcon('home'), headerShown: false }} />
      <Tabs.Screen name="features" options={{ title: id.nav.features, tabBarIcon: tabIcon('apps') }} />
      <Tabs.Screen name="history" options={{ title: id.nav.history, tabBarIcon: tabIcon('history'), headerShown: false }} />
      <Tabs.Screen name="profile" options={{ title: id.nav.profile, tabBarIcon: tabIcon('person'), headerShown: false }} />
    </Tabs>
  );
}
