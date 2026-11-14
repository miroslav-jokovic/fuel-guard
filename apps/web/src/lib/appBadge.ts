import { onUnmounted, watch, type Ref } from "vue";

/**
 * The number on the installed app's icon (docs/plans/messaging/INSTALLED-APP-PLAN.md D-IA1).
 *
 * It is the sidebar's chat number and nothing else — `useNavCounts` hands over the very value its badge
 * shows — so the icon and the sidebar cannot disagree. Zero clears it. It is cleared when the signed-in shell
 * goes away too: a signed-out phone must not keep advertising somebody's unread messages.
 *
 * Only where the browser has the Badging API (installed Chromium apps, iOS Home Screen apps 16.4+); anywhere
 * else this does nothing. ⚠ It is right only while the app is OPEN: a message that arrives with the app
 * closed moves the icon only once the push itself carries the count (IA-U1b in the plan).
 */
type BadgeNavigator = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

export function setAppBadgeCount(count: number): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as BadgeNavigator;
  // Both reject where the app is not installed or the person refused notifications; neither is an error here.
  if (count > 0) void nav.setAppBadge?.(count).catch(() => {});
  else void nav.clearAppBadge?.().catch(() => {});
}

export function useAppBadge(count: Ref<number>): void {
  watch(count, (n) => setAppBadgeCount(n), { immediate: true });
  onUnmounted(() => setAppBadgeCount(0));
}
