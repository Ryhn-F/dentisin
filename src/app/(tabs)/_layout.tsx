import { Tabs } from 'expo-router/js-tabs';
import { Pressable, View, type GestureResponderEvent } from 'react-native';

import { Icon } from '@/components/icon';
import { tabIcon, useTabScreenOptions } from '@/components/tab-bar';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { palette, shadows } from '@/core/theme';
import { cn } from '@/lib/utils';

const CENTER_BUTTON = 64;

// The main feature sits in the middle as a raised round button (design reference 1:
// big blue circle). It is still a normal tab: same role, label and selected state.
// The circle rises only partly above the bar — on Android, touches outside a parent's
// bounds are not delivered, so the part inside the bar must stay large (≥ 48dp).
function ScreeningTabButton({
  onPress,
  onLongPress,
  focused,
  testID,
}: {
  onPress?: ((e: GestureResponderEvent) => void) | null;
  onLongPress?: ((e: GestureResponderEvent) => void) | null;
  focused: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID ?? 'tab-screening'}
      accessibilityRole="tab"
      accessibilityLabel={id.nav.screening}
      accessibilityState={{ selected: focused }}
      onPress={onPress ?? undefined}
      onLongPress={onLongPress ?? undefined}
      className="flex-1 items-center"
    >
      <View
        className={cn(
          'items-center justify-center rounded-full border-4 bg-primary',
          focused ? 'border-sun' : 'border-card',
        )}
        style={{ width: CENTER_BUTTON, height: CENTER_BUTTON, marginTop: -32, boxShadow: shadows.button }}
      >
        <Icon name="photo-camera" size={28} color={palette.onPrimary} />
      </View>
      <Text
        className="mt-1 text-center font-sans-extrabold"
        style={{ fontSize: 12, lineHeight: 16 }}
        tone={focused ? 'primary' : 'default'}
      >
        {id.nav.screening}
      </Text>
    </Pressable>
  );
}

// Five always-visible destinations with icon + label (child-friendly navigation);
// Skrining, the main feature, in the middle.
export default function TabsLayout() {
  const screenOptions = useTabScreenOptions();
  return (
    <Tabs screenOptions={screenOptions}>
      {/* Home opens with its own greeting block, like the reference home screen. */}
      <Tabs.Screen name="home" options={{ title: id.nav.home, tabBarIcon: tabIcon('home'), headerShown: false }} />
      <Tabs.Screen name="features" options={{ title: id.nav.features, tabBarIcon: tabIcon('apps') }} />
      <Tabs.Screen
        name="screening"
        options={{
          title: id.nav.screening,
          headerShown: false,
          tabBarButton: (props) => (
            <ScreeningTabButton
              onPress={props.onPress}
              onLongPress={props.onLongPress}
              // The tab bar reports the selected state as `aria-selected`.
              focused={!!props['aria-selected']}
              testID={props.testID}
            />
          ),
        }}
      />
      <Tabs.Screen name="history" options={{ title: id.nav.history, tabBarIcon: tabIcon('history'), headerShown: false }} />
      <Tabs.Screen name="profile" options={{ title: id.nav.profile, tabBarIcon: tabIcon('person'), headerShown: false }} />
    </Tabs>
  );
}
