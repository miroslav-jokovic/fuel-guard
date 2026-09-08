import { Tabs } from 'expo-router';
import { TabBar } from '@/components/TabBar';
import { useFeatures } from '@/session/useFeatures';

/**
 * Bottom tab shell — Home · Loads · Documents · More (D-DB14, owner ruling 2026-09-07, superseding
 * D51's Home · Loads · Score · More). Loads and Documents are dashboard-controllable blocks
 * (hardening plan Phase 4, D-PM1/D-PM3): `href: null` removes a disabled tab entirely — the Samsara
 * rule, a feature an org turned off simply doesn't appear. Home and More are never controllable
 * (fail-safe core).
 *
 * Documents is the driver's document surface: the bill-of-lading scanner and every compliance
 * verdict it produced. It had been a modal hub two taps inside More since the hardening plan's
 * Phase 3, which is how the scanner programme's whole front door went missing from the app's
 * navigation. Gated on `hazmat.capture`, the same entitlement the hub carried.
 *
 * Score is NOT a tab: it is a weekly grade, read from More and summarised on Home. The route stays
 * in the navigator, hidden, so `/score` keeps working from More and from a notification. Messages
 * and Notifications are the top-bar icons on Home and rows in More (D51, restored — the one-day
 * Messages tab of D-DB13 is withdrawn). Navigate is deliberately NOT a tab: D52 moved navigation
 * to its own programme; `navigate.tsx` stays on disk as the seam, hidden and dev-only.
 *
 * Uses expo-router's stable <Tabs> navigator with a fully custom JS tab bar (`TabBar`) — our
 * HugeIcons SVG through the `Icon` component, token-exact colours, identical on both platforms.
 */
export default function TabsLayout() {
  const { enabled } = useFeatures();
  // `animation: 'none'`: the owner ruled every tab-switch motion out on 2026-09-07 — the disc's
  // slide first, then the scene's cross-fade. A driver tapping a tab wants the screen, now.
  return (
    <Tabs screenOptions={{ headerShown: false, animation: 'none' }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="loads" options={enabled('tab.loads') ? { title: 'Loads' } : { href: null }} />
      {/* Reserved slot (D52): route exists, tab hidden. */}
      <Tabs.Screen name="navigate" options={{ href: null }} />
      <Tabs.Screen name="documents" options={enabled('hazmat.capture') ? { title: 'Documents' } : { href: null }} />
      {/* Reached from More; never a tab (D-DB14). */}
      <Tabs.Screen name="score" options={{ href: null }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
