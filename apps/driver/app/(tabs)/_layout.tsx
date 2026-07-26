import { Tabs, useRouter } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { Icon } from '@/components';
import { haptics } from '@/lib/haptics';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

// Navigation shell (D17, retargeted by D41): Home · Loads · (center) Navigate · Score · More.
// The elevated center action opens navigation for the active load; per-stop capture and hazmat
// arrive as modal routes over this shell in Phases 3–4.

function tabIcon(name: MaterialSymbolName, fill = false) {
  return function TabBarIcon({ color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <Icon name={name} fill={fill} color={color as string} size={size} />;
  };
}

export default function TabsLayout() {
  const router = useRouter();
  const { isDark } = useTheme();
  const rc = isDark ? roleColors.dark : roleColors.light;

  // Raised circular brand action — sits proud of the bar (fleet-app signature; Dasher/Motive pattern).
  const centerWrap = {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginTop: -22,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: rc.brand,
    borderWidth: 3,
    borderColor: rc.surface,
    elevation: 6,
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  };

  function centerIcon() {
    return (
      <View style={centerWrap}>
        <Icon name="navigation" fill size={26} color={rc.inkInverse} />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: rc.brand,
        tabBarInactiveTintColor: rc.inkMuted,
        tabBarStyle: { backgroundColor: rc.surface, borderTopColor: rc.edge },
        tabBarLabelStyle: { fontSize: 11, fontFamily: 'HankenGrotesk_600SemiBold' },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="loads" options={{ title: 'Loads', tabBarIcon: tabIcon('local_shipping') }} />
      <Tabs.Screen
        name="navigate"
        options={{ title: 'Navigate', tabBarIcon: centerIcon, tabBarLabel: () => null }}
        listeners={() => ({
          tabPress: (e) => {
            e.preventDefault();
            haptics.tap();
            router.push('/drive');
          },
        })}
      />
      <Tabs.Screen name="score" options={{ title: 'My Score', tabBarIcon: tabIcon('speed') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: tabIcon('more_horiz') }} />
    </Tabs>
  );
}
