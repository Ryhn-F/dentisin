import { Tabs } from 'expo-router/js-tabs';

import { tabIcon, useTabScreenOptions } from '@/components/tab-bar';
import { id } from '@/core/i18n/id';

// Child accounts (ADR 017): three tabs, same tab bar look as (tabs). No screening tab: the
// guardian screens; the child only brushes, asks for a check, and sees its own history.
export default function KidTabsLayout() {
  const screenOptions = useTabScreenOptions();
  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen name="index" options={{ title: id.kid.tabs.home, tabBarIcon: tabIcon('home'), headerShown: false }} />
      <Tabs.Screen name="history" options={{ title: id.kid.tabs.history, tabBarIcon: tabIcon('history') }} />
      <Tabs.Screen name="account" options={{ title: id.kid.tabs.account, tabBarIcon: tabIcon('person') }} />
    </Tabs>
  );
}
