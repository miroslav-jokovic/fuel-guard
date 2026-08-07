import { Tabs } from 'expo-router';
import { TabBar } from '@/components/TabBar';
import { useFeatures } from '@/session/useFeatures';

/**
 * Bottom tab shell — Home · Loads · Score · More (D51), with Loads and Score as dashboard-
 * controllable blocks (hardening plan Phase 4, D-PM1/D-PM3): `href: null` removes a disabled
 * tab entirely — the Samsara rule, a feature an org turned off simply doesn't appear. Home is
 * never controllable (fail-safe core). The paired Home sections hide with their tab in home.tsx,
 * so a block is all-on or all-off, never half-visible.
 *
 * Navigate is deliberately NOT a tab: D52 moved navigation to its own programme and reserved the
 * center slot "designed in but not rendered". `navigate.tsx` stays on disk as the seam — hidden
 * from the bar and dev-only, so production never renders the NP0 sample-route spike.
 *
 * Uses expo-router's stable <Tabs> navigator with a fully custom JS tab bar (`TabBar`) — our
 * HugeIcons SVG through the `Icon` component, token-exact colors, identical on both platforms.
 */
export default function TabsLayout() {
  const { enabled, scoreDetailTab } = useFeatures();
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="loads" options={enabled('tab.loads') ? { title: 'Loads' } : { href: null }} />
      {/* Reserved center slot (D52): route exists, tab hidden. */}
      <Tabs.Screen name="navigate" options={{ href: null }} />
      {/* Score DEPTH (tab.score config): the tab is optional even when the score itself is on —
          Home keeps its weekly tiles either way. Off entirely hides both. */}
      <Tabs.Screen name="score" options={scoreDetailTab ? { title: 'Score' } : { href: null }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
