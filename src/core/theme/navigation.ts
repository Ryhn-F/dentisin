import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';

import { palette } from './colors';
import { fontFamilies } from './typography';

// One header look for every stack (titles come from the navigator, never a hand-rolled <Text>).
export function useStackScreenOptions() {
  return {
    headerStyle: { backgroundColor: palette.bg },
    headerTintColor: palette.text,
    headerTitleStyle: { fontFamily: fontFamilies.extrabold, fontSize: 18 },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: palette.bg },
  } as const;
}

/** Header options for screens whose content starts with a blue hero block. */
export const onPrimaryHeaderOptions = {
  headerTransparent: true,
  // Must override the stack's default header background, or it paints over the hero.
  headerStyle: { backgroundColor: 'transparent' },
  headerTintColor: palette.onPrimary,
  headerTitleStyle: { fontFamily: fontFamilies.extrabold, fontSize: 18, color: palette.onPrimary },
} as const;

// Focused screens that want light icons. A set (not a toggle) because React Navigation
// may run the next screen's focus before or after the previous screen's blur; the
// result must not depend on that order.
const lightRequests = new Set<symbol>();

function applyStatusBarStyle() {
  StatusBar.setStyle(lightRequests.size > 0 ? 'light' : 'dark');
}

/**
 * Light status-bar icons while a screen with a blue top block is focused.
 * Uses focus events because tab screens stay mounted (a <StatusBar> element would fight).
 */
export function useLightStatusBar() {
  useFocusEffect(
    useCallback(() => {
      const token = Symbol('light-status-bar');
      lightRequests.add(token);
      applyStatusBarStyle();
      return () => {
        lightRequests.delete(token);
        applyStatusBarStyle();
      };
    }, []),
  );
}

/** True while this screen is focused (stack and tab screens stay mounted when covered). */
export function useIsScreenFocused() {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused;
}
