import '../../global.css';

import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { useSession } from '@/core/auth/session-store';
import { flags } from '@/core/flags';
import { id } from '@/core/i18n/id';
import { usePrefs } from '@/core/prefs';
import { ThemeProvider, useStackScreenOptions } from '@/core/theme';
import { fontAssets } from '@/core/theme/fonts';

// Keep the native splash up only while local state loads (fonts + stored session).
// Never waits for the network (app_plan.md §4.1).
SplashScreen.preventAutoHideAsync().catch(() => {});

function RootStack() {
  const screenOptions = useStackScreenOptions();
  const status = useSession((s) => s.status);
  const canUseApp = status === 'signedIn' || status === 'guest';

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Protected guard={canUseApp}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="brushing/session" options={{ presentation: 'fullScreenModal', title: id.brushing.title }} />
          <Stack.Screen name="feature/toothpaste" options={{ title: id.toothpaste.title }} />
          <Stack.Screen name="feature/education/index" options={{ title: id.education.title }} />
          <Stack.Screen name="feature/education/[slug]" options={{ title: id.education.title }} />
        </Stack.Protected>
        {/* Photo screening + triage: behind `medical_modules` (ADR 002). */}
        <Stack.Protected guard={canUseApp && flags.medical_modules}>
          <Stack.Screen name="screening/questions" options={{ title: id.screening.redFlags.title }} />
          <Stack.Screen name="screening/symptoms" options={{ title: id.screening.symptoms.title }} />
          <Stack.Screen name="screening/guide" options={{ title: id.screening.guide.title }} />
          <Stack.Screen name="screening/camera" options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen name="screening/review" options={{ title: id.screening.review.title }} />
          <Stack.Screen
            name="screening/result"
            options={{ title: id.screening.result.title, headerBackVisible: false, gestureEnabled: false }}
          />
          <Stack.Screen name="screening/referral" options={{ title: id.screening.referral.title }} />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="(entry)" options={{ headerShown: false }} />
        </Stack.Protected>
        {/* Reachable in any state: deep links and shared info pages. */}
        <Stack.Screen name="auth/callback" options={{ title: id.auth.callback.title, headerBackVisible: false }} />
        <Stack.Screen name="auth/reset-password" options={{ title: id.auth.reset.title }} />
        <Stack.Screen name="auth/forgot-password" options={{ title: id.auth.forgot.title }} />
        <Stack.Screen name="privacy" options={{ title: id.privacy.title }} />
        <Stack.Screen name="dev/theme" options={{ title: id.preview.screenTitle }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const status = useSession((s) => s.status);
  const hydrate = useSession((s) => s.hydrate);
  const prefsReady = usePrefs((s) => s.hydrated);
  const mode = usePrefs((s) => s.mode);
  const setMode = usePrefs((s) => s.setMode);
  const hydratePrefs = usePrefs((s) => s.hydrate);

  useEffect(() => {
    hydrate().catch(() => useSession.setState({ status: 'signedOut' }));
    hydratePrefs();
  }, [hydrate, hydratePrefs]);

  // A missing font must not block the app: fall back to the system font.
  const ready = (fontsLoaded || !!fontError) && status !== 'loading' && prefsReady;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <ThemeProvider mode={mode} onModeChange={setMode}>
      <RootStack />
    </ThemeProvider>
  );
}
