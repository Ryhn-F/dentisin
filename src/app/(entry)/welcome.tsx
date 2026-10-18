import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '@/components/banner';
import { Blob, Ring, Sparkle } from '@/components/decor';
import { Mascot } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useSession } from '@/core/auth/session-store';
import { isSupabaseConfigured } from '@/core/config';
import { id } from '@/core/i18n/id';
import { palette, useIsScreenFocused, useLightStatusBar } from '@/core/theme';

const t = id.auth;

// Onboarding (design reference 1): bold blue stage with the mascot, white sheet with
// a curved top, big centered headline, yellow pill call to action.
export default function Welcome() {
  const insets = useSafeAreaInsets();
  const continueAsGuest = useSession((s) => s.continueAsGuest);
  useLightStatusBar();
  // The float animation stops while Login/Register cover this screen.
  const focused = useIsScreenFocused();

  return (
    // Scrollable so small phones (and large system text) never cut off the actions.
    <ScrollView className="flex-1 bg-primary" contentContainerClassName="grow" bounces={false}>
      <View
        className="flex-1 items-center justify-center overflow-hidden pb-6"
        style={{ paddingTop: insets.top + 16, minHeight: 250 + insets.top }}
      >
        {/* Below the status bar: system icons are white and must not sit on coral. */}
        <Blob color={palette.coral} size={190} variant={0} style={{ left: -90, top: insets.top + 12 }} />
        <Blob color={palette.primaryDeep} size={260} variant={2} opacity={0.7} style={{ right: -110, bottom: -60 }} />
        <Ring color={palette.accent} size={84} thickness={12} style={{ right: 26, top: insets.top + 36 }} />
        <Sparkle color={palette.accent} size={30} style={{ left: 48, bottom: 64 }} />
        <Sparkle color={palette.card} size={18} style={{ right: 70, bottom: 120 }} />
        <View className="size-48 items-center justify-center rounded-full bg-primary-deep">
          <Mascot size={156} withBrush float={focused} />
        </View>
      </View>

      <View
        className="gap-3 rounded-t-sheet bg-card px-6 pt-7"
        style={{ paddingBottom: insets.bottom + 20, borderCurve: 'continuous' }}
      >
        <Text variant="label" tone="primary" className="text-center">
          {id.appName}
        </Text>
        <Text variant="display" accessibilityRole="header" className="text-center">
          {t.welcomeTitle}
        </Text>
        <Text variant="body" tone="secondary" className="mb-2 text-center">
          {t.welcomeBody}
        </Text>
        {!isSupabaseConfigured ? <Banner tone="info" message={t.notConfiguredBanner} /> : null}
        <Button title={t.signIn} variant="accent" size="large" onPress={() => router.push('/login')} />
        <Button title={t.signUp} variant="secondary" onPress={() => router.push('/register')} />
        <Button title={t.useWithoutAccount} variant="ghost" onPress={() => continueAsGuest()} />
        <Button
          title={id.childLogin.entryButton}
          variant="ghost"
          onPress={() => router.push('/child-login')}
          testID="welcome-child"
        />
        <Text variant="caption" tone="secondary" className="text-center">
          {t.withoutAccountNote}
        </Text>
      </View>
    </ScrollView>
  );
}
