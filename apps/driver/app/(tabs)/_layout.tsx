import { Tabs } from 'expo-router';
import { TabBar } from '@/components/TabBar';

/**
 * Bottom tab shell — Home · Loads · Score · More (FOUR tabs, D51).
 *
 * Navigate is deliberately NOT a tab: D52 moved navigation to its own programme and reserved the
 * center slot "designed in but not rendered". `navigate.tsx` stays on disk as the seam — it is
 * hidden from the bar (`href: null`) and its screen self-gates to dev builds only, so production
 * never renders the NP0 sample-route spike as if it were live data (hardening plan Phase 2).
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
      {/* Reserved center slot (D52): route exists, tab hidden. */}
      <Tabs.Screen name="navigate" options={{ href: null }} />
      <Tabs.Screen name="score" options={{ title: 'Score' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
