import { Stack } from 'expo-router';

import { id } from '@/core/i18n/id';
import { onPrimaryHeaderOptions, useStackScreenOptions } from '@/core/theme';

export default function EntryLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      {/* Welcome is a landing page with no navigation context, so no header bar. */}
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      {/* Login/Register start with a blue hero block under a transparent header. */}
      <Stack.Screen name="login" options={{ ...onPrimaryHeaderOptions, title: '' }} />
      <Stack.Screen name="register" options={{ ...onPrimaryHeaderOptions, title: '' }} />
      <Stack.Screen name="check-email" options={{ title: id.auth.checkEmail.title }} />
    </Stack>
  );
}
