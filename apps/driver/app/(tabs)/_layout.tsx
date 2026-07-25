import { Tabs, useRouter } from 'expo-router';
import type { ColorValue } from 'react-native';
import { Icon } from '@/components';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

// Navigation shell (plan D17): Home · Fuel Log · (center) Log · My Score · More.
// The center tab opens the capture modal instead of navigating.
function tabIcon(name: MaterialSymbolName, fill = false) {
  return function TabBarIcon({ color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <Icon name={name} fill={fill} color={color as string} size={size} />;
  };
}

export default function TabsLayout() {
  const router = useRouter();
  const { isDark } = useTheme();
  const rc = isDark ? roleColors.dark : roleColors.light;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: rc.brand,
        tabBarInactiveTintColor: rc.inkMuted,
        tabBarStyle: { backgroundColor: rc.surface, borderTopColor: rc.edge },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="fuel-log" options={{ title: 'Fuel Log', tabBarIcon: tabIcon('history') }} />
      <Tabs.Screen
        name="log"
        options={{ title: 'Log', tabBarIcon: tabIcon('local_gas_station', true) }}
        listeners={() => ({
          tabPress: (e) => {
            e.preventDefault();
            router.push('/log-fuel');
          },
        })}
      />
      <Tabs.Screen name="score" options={{ title: 'My Score', tabBarIcon: tabIcon('star') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: tabIcon('more_horiz') }} />
    </Tabs>
  );
}
