import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';
import { layout, radius, type as typeScale } from '@/theme/tokens';

/**
 * Navigation shell (D51). Four tabs — Home · Loads · Score · More — with the center slot RESERVED
 * for navigation, which D52 moved to its own programme.
 *
 * The slot is designed in but not rendered: a driver sees four evenly-spaced tabs, no gap and no
 * dead button. When navigation lands it becomes the elevated center action launched from an accepted
 * load, and nothing else in the bar has to move — deciding the bar later is the redesign we are
 * avoiding.
 *
 * Messages and Notifications live in the TOP bar (D51), not here: they are interrupt-driven and
 * would sit badged and idle in a permanent slot. Contextual work — stop capture, the hazmat step,
 * the duty check-in — is a modal route over this shell, never a tab.
 */
function tabIcon(name: MaterialSymbolName, fill = false) {
  return function TabBarIcon({ color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <Icon name={name} fill={fill} color={color as string} size={size} />;
  };
}

export default function TabsLayout() {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const rc = isDark ? roleColors.dark : roleColors.light;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: rc.brand,
        tabBarInactiveTintColor: rc.inkMuted,
        tabBarStyle: {
          height: 84 + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom + 12,
          borderTopWidth: 0,
          backgroundColor: 'transparent',
          shadowOpacity: 0,
          elevation: 0,
        },
        tabBarBackground: () => (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 8,
              right: layout.screenInset,
              bottom: insets.bottom + 12,
              left: layout.screenInset,
              borderRadius: radius.lg,
              backgroundColor: rc.surface,
              shadowColor: rc.ink,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.14,
              shadowRadius: 12,
              elevation: 8,
            }}
          />
        ),
        tabBarLabelStyle: { fontSize: typeScale.size.micro, fontFamily: 'HankenGrotesk_600SemiBold' },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="loads" options={{ title: 'Loads', tabBarIcon: tabIcon('local_shipping') }} />
      <Tabs.Screen name="score" options={{ title: 'Score', tabBarIcon: tabIcon('speed') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: tabIcon('more_horiz') }} />
      {/* The navigation seam (D52). Kept in the route tree so a deep link still resolves and the
          programme has somewhere to land, but hidden from the bar until it is real. */}
      <Tabs.Screen name="navigate" options={{ href: null }} />
    </Tabs>
  );
}
