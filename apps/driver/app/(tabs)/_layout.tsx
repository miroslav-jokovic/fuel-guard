import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';
import { layout, radius, type as typeScale } from '@/theme/tokens';

/**
 * Navigation shell (D51). Five task-oriented tabs — Home · Loads · Navigate · Score · More.
 * Labels are intentionally hidden in the compact mobile bar, but accessibility labels remain explicit.
 * Navigation is a first-class task surface, not a placeholder or an action hidden in a load card.
 *
 * Messages and Notifications live in the TOP bar (D51), not here: they are interrupt-driven and
 * would sit badged and idle in a permanent slot. Contextual work — stop capture, the hazmat step,
 * the duty check-in — is a modal route over this shell, never a tab.
 */
function tabIcon(name: MaterialSymbolName, fill = false) {
  return function TabBarIcon({ color }: { focused: boolean; color: ColorValue; size: number }) {
    return <Icon name={name} fill={fill} color={color as string} size={28} />;
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
            className="absolute bg-surface"
            style={{
              top: 8,
              right: layout.screenInset,
              bottom: insets.bottom + 12,
              left: layout.screenInset,
              borderRadius: radius.lg,
              shadowColor: rc.ink,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.14,
              shadowRadius: 12,
              elevation: 8,
            }}
          />
        ),
        tabBarShowLabel: false,
        tabBarLabelStyle: { fontSize: typeScale.size.micro, fontFamily: 'HankenGrotesk_600SemiBold' },
        tabBarItemStyle: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarAccessibilityLabel: 'Home', tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="loads" options={{ title: 'Loads', tabBarAccessibilityLabel: 'Loads', tabBarIcon: tabIcon('local_shipping') }} />
      <Tabs.Screen name="navigate" options={{ title: 'Navigate', tabBarAccessibilityLabel: 'Navigate', tabBarIcon: tabIcon('navigation') }} />
      <Tabs.Screen name="score" options={{ title: 'Score', tabBarAccessibilityLabel: 'Score', tabBarIcon: tabIcon('speed') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarAccessibilityLabel: 'More', tabBarIcon: tabIcon('more_horiz') }} />
    </Tabs>
  );
}
