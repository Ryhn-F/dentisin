import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback } from 'react';

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

/**
 * Light status-bar icons while a screen with a blue top block is focused.
 * Uses focus events because tab screens stay mounted (a <StatusBar> element would fight).
 */
export function useLightStatusBar() {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, []),
  );
}
