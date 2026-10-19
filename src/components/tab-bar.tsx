import { useEffect } from 'react';
import { View, type ColorValue } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamilies, motion, palette, shadows } from '@/core/theme';

import { Icon, type IconName } from './icon';

// Shared look of the bottom tab bars: (tabs) for guardian / teen / guest and kid/ for child
// accounts. Fixed height (pill indicator + label need ~80dp, Material 3 nav bar), so the
// bottom safe-area inset is added by hand.
export const TAB_BAR_HEIGHT = 80;

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export function tabIcon(name: IconName) {
  return function TabIcon({ focused, color }: { focused: boolean; color: ColorValue }) {
    // Active tab: bold blue pill behind a white icon (design reference 1, M3 indicator);
    // the pill grows out from the icon when the tab becomes active.
    const reduceMotion = useReducedMotion();
    const on = useSharedValue(focused ? 1 : 0);
    useEffect(() => {
      const target = focused ? 1 : 0;
      on.set(reduceMotion ? target : withTiming(target, { duration: motion.fast, easing: EASE_OUT }));
    }, [focused, reduceMotion, on]);
    const pillStyle = useAnimatedStyle(() => ({ opacity: on.get(), transform: [{ scaleX: 0.5 + on.get() * 0.5 }] }));
    return (
      <View className="h-9 w-14 items-center justify-center">
        <Animated.View
          style={[{ position: 'absolute', inset: 0, borderRadius: 999, backgroundColor: palette.primary }, pillStyle]}
        />
        <Icon name={name} size={24} color={focused ? palette.onPrimary : color} />
      </View>
    );
  };
}

/** screenOptions for a js-tabs navigator with the app's tab bar. */
export function useTabScreenOptions() {
  const insets = useSafeAreaInsets();
  return {
    // Tabs are peers: a short crossfade, never a slide.
    animation: 'fade' as const,
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
