import { Tabs } from 'expo-router';
import { TabBar } from '@/components/TabBar';
import { useThreads } from '@/features/messages/useMessages';
import { useFeatures } from '@/session/useFeatures';

/**
 * Bottom tab shell — Today · Loads · Messages · Score · More (D-DB13, 2026-09-07), with Loads,
 * Messages and Score as dashboard-controllable blocks (hardening plan Phase 4, D-PM1/D-PM3):
 * `href: null` removes a disabled tab entirely — the Samsara rule, a feature an org turned off
 * simply doesn't appear. Today and More are never controllable (fail-safe core).
 *
 * Messages became a tab because talking to dispatch is a top-level activity, not a setting: it was
 * reachable only through a bell-sized button on Today's hero and a row inside More, so a driver on
 * Loads with an unread question had no signal at all. The count rides on the tab now, through
 * `tabBarBadge`, and the duplicate entry points are gone. Notifications stays a feed behind the
 * bell and inside More — it is read, not worked.
 *
 * Navigate is deliberately NOT a tab: D52 moved navigation to its own programme. `navigate.tsx`
 * stays on disk as the seam — hidden from the bar and dev-only, so production never renders the
 * NP0 sample-route spike. When NP1 lands it takes a slot; the shell draws any count.
 *
 * Uses expo-router's stable <Tabs> navigator with a fully custom JS tab bar (`TabBar`) — our
 * HugeIcons SVG through the `Icon` component, token-exact colours, identical on both platforms.
 */
export default function TabsLayout() {
  const { enabled, scoreDetailTab } = useFeatures();
  const messagesEnabled = enabled('messages');
  const threads = useThreads(messagesEnabled);
  const unread = threads.data?.unread_total ?? 0;

  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="home" options={{ title: 'Today' }} />
      <Tabs.Screen name="loads" options={enabled('tab.loads') ? { title: 'Loads' } : { href: null }} />
      {/* Reserved slot (D52): route exists, tab hidden. */}
      <Tabs.Screen name="navigate" options={{ href: null }} />
      <Tabs.Screen
        name="messages"
        options={messagesEnabled ? { title: 'Messages', tabBarBadge: unread > 0 ? unread : undefined } : { href: null }}
      />
      {/* Score DEPTH (tab.score config): the tab is optional even when the score itself is on —
          Home keeps its weekly tiles either way. Off entirely hides both. */}
      <Tabs.Screen name="score" options={scoreDetailTab ? { title: 'Score' } : { href: null }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
