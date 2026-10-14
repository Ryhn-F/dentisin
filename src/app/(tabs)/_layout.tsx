import { Tabs } from 'expo-router/js-tabs';
import { Pressable, View, type ColorValue, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { fontFamilies, palette, shadows } from '@/core/theme';
import { cn } from '@/lib/utils';

// Fixed height (pill indicator + label need ~80dp, Material 3 nav bar), so the
// bottom safe-area inset is added by hand.
const TAB_BAR_HEIGHT = 80;
const CENTER_BUTTON = 64;

function tabIcon(name: IconName) {
  return function TabIcon({ focused, color }: { focused: boolean; color: ColorValue }) {
    // Active tab: bold blue pill behind a white icon (design reference 1, M3 indicator).
    return (
      <View className={cn('h-9 w-14 items-center justify-center rounded-full', focused && 'bg-primary')}>
        <Icon name={name} size={24} color={focused ? palette.onPrimary : color} />
      </View>
    );
  };
}

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
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textSecondary,
        // The keyboard must not lift the tab bar over form fields.
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: palette.card,
          borderTopWidth: 0,
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingTop: 10,
          paddingBottom: insets.bottom + 10,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          boxShadow: shadows.raised,
          overflow: 'visible',
        },
        tabBarLabelStyle: { fontFamily: fontFamilies.bold, fontSize: 12, lineHeight: 16, marginTop: 4 },
        headerStyle: { backgroundColor: palette.bg },
        headerTintColor: palette.text,
        headerTitleStyle: { fontFamily: fontFamilies.extrabold, fontSize: 18 },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: palette.bg },
      }}
    >
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
