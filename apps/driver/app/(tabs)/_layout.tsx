import { Tabs } from 'expo-router';
import { TabBar } from '@/components/TabBar';

/**
 * Bottom tab shell — Home · Loads · Navigate · Score · More.
 *
 * Uses expo-router's stable <Tabs> navigator with a fully custom JS tab bar (`TabBar`), replacing
 * the former `expo-router/unstable-native-tabs`. Rationale: the native tab bar can only host
 * rasterized PNG icons and relies on OS template-tinting (which differed across iOS/Android and
 * produced off-color glyphs); the custom bar renders our HugeIcons SVG directly through the `Icon`
 * component, so tab-icon color follows the design tokens exactly and looks identical on both
 * platforms. Per-tab state is preserved by the underlying tabs navigator. Labels are hidden for the
 * compact driver shell (accessibility labels are kept on each tab).
 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="loads" options={{ title: 'Loads' }} />
      <Tabs.Screen name="navigate" options={{ title: 'Navigate' }} />
      <Tabs.Screen name="score" options={{ title: 'Score' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
