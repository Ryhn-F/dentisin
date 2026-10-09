import { Stack } from 'expo-router';

import { id } from '@/core/i18n/id';
import { onPrimaryHeaderOptions, useStackScreenOptions } from '@/core/theme';

export default function HistoryLayout() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ ...onPrimaryHeaderOptions, title: id.history.title }} />
      <Stack.Screen name="[id]" options={{ ...onPrimaryHeaderOptions, title: id.history.detailTitle }} />
    </Stack>
  );
}
