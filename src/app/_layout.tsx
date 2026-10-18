import '../../global.css';
import '@/core/auth/crypto-polyfill';

import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { useAccount, useAccountForegroundRefresh } from '@/core/account/account-store';
import { resolveHome } from '@/core/account/routing';
import { useSession } from '@/core/auth/session-store';
import { flags } from '@/core/flags';
import { id } from '@/core/i18n/id';
import { usePrefs } from '@/core/prefs';
import { useSyncEngine } from '@/core/sync/engine';
import { ThemeProvider, useStackScreenOptions } from '@/core/theme';
import { fontAssets } from '@/core/theme/fonts';
import { useLocalReady } from '@/data/local-store';
import { startProofUploads } from '@/features/brushing/proof-uploads';

// Keep the native splash up only while local state loads (fonts + stored session + the
// signed-in user's or guest's local data, so screens never flash another scope's empty state).
// Never waits for the network (app_plan.md §4.1).
SplashScreen.preventAutoHideAsync().catch(() => {});

function RootStack() {
  const screenOptions = useStackScreenOptions();
  const status = useSession((s) => s.status);
  const me = useAccount((s) => s.me);
  const accountStatus = useAccount((s) => s.status);
  // Account-based routing (ADR 017/018): my_account() decides the home, never a client guess.
  const home = resolveHome(status, me, accountStatus);
  const adultHome = home === 'guardian' || home === 'teen' || home === 'guest';
  const signedInAdult = home === 'guardian' || home === 'teen';
  useAccountForegroundRefresh(status === 'signedIn');

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        {/* Guardian, teen and no-account mode share the tab app. */}
        <Stack.Protected guard={adultHome}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="feature/toothpaste" options={{ title: id.toothpaste.title }} />
          <Stack.Screen name="feature/education/index" options={{ title: id.education.title }} />
          <Stack.Screen name="feature/education/[slug]" options={{ title: id.education.title }} />
        </Stack.Protected>
        {/* Brushing is for everyone who has a home, child accounts included. */}
        <Stack.Protected guard={adultHome || home === 'child'}>
          <Stack.Screen name="brushing/session" options={{ presentation: 'fullScreenModal', title: id.brushing.title }} />
        </Stack.Protected>
        {/* Photo screening + triage: guardian/teen/guest only, behind `medical_modules` (ADR 002). */}
        <Stack.Protected guard={adultHome && flags.medical_modules}>
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
        {/* Screening requests from child accounts arrive at the guardian. */}
        <Stack.Protected guard={home === 'guardian'}>
          <Stack.Screen name="requests/index" options={{ title: id.requests.title }} />
        </Stack.Protected>
        {/* Proof videos: guardian (children's videos) and teen (own videos); server-backed. */}
        <Stack.Protected guard={signedInAdult}>
          <Stack.Screen name="proofs/index" options={{ title: id.proofs.title }} />
          <Stack.Screen name="proofs/[id]" options={{ title: id.proofs.playerTitle }} />
        </Stack.Protected>
        {/* Child accounts: their own small app. */}
        <Stack.Protected guard={home === 'child'}>
          <Stack.Screen name="kid" options={{ headerShown: false }} />
          <Stack.Screen name="requests/new" options={{ title: id.requests.newTitle }} />
        </Stack.Protected>
        <Stack.Protected guard={home === 'teenSetup'}>
          <Stack.Screen name="onboarding/teen-setup" options={{ title: id.teenSetup.title, headerBackVisible: false }} />
        </Stack.Protected>
        <Stack.Protected guard={home === 'accountGate'}>
          <Stack.Screen name="account-gate" options={{ title: id.accountGate.title, headerBackVisible: false }} />
        </Stack.Protected>
        <Stack.Protected guard={home === 'entry'}>
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
  const localReady = useLocalReady();
  // Local data and the outbox follow the session (one scope per user / guest). Mounted before
  // the hydrate effect so the first session state already selects its scope.
  useSyncEngine();
  // Proof video uploads resume after a restart without waiting for a brushing screen to open
  // (the queue follows the session itself; idempotent).
  useEffect(() => startProofUploads(), []);

  useEffect(() => {
    hydrate().catch(() => useSession.setState({ status: 'signedOut' }));
    hydratePrefs();
  }, [hydrate, hydratePrefs]);

  // A missing font must not block the app: fall back to the system font.
  const ready = (fontsLoaded || !!fontError) && status !== 'loading' && prefsReady && localReady;
  // Only the first boot waits: a later scope switch (sign-in / sign-out) reloads local data
  // briefly and must not unmount the navigator.
  const [booted, setBooted] = useState(false);
  if (ready && !booted) setBooted(true);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready && !booted) return null;

  return (
    <ThemeProvider mode={mode} onModeChange={setMode}>
      <RootStack />
    </ThemeProvider>
  );
}
