import { Stack } from 'expo-router';

import { id } from '@/core/i18n/id';
import { onPrimaryHeaderOptions, useStackScreenOptions } from '@/core/theme';

export default function ProfileLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ ...onPrimaryHeaderOptions, title: id.profile.title }} />
      <Stack.Screen name="child/[id]" options={{ title: id.child.editTitle }} />
      <Stack.Screen name="settings" options={{ title: id.settings.title }} />
      <Stack.Screen name="consents" options={{ title: id.consents.title }} />
      <Stack.Screen name="about" options={{ ...onPrimaryHeaderOptions, title: id.about.title }} />
    </Stack>
  );
}
