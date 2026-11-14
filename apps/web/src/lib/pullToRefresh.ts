import { onMounted, onUnmounted, ref } from "vue";
import { isStandalone } from "@/lib/webPush";

/**
 * Pull down to refresh, in the INSTALLED app only (CHAT-WEB-PUSH-PLAN.md WP7, D-WP17; owner 2026-11-14, after
 * installing it on a phone: "refresh on pull down like on mobile app").
 *
 * WHY THE APP HAS TO DO IT. A browser tab has the browser's own pull-to-refresh and its reload button. Opened
 * from the Home Screen there is no browser chrome at all, and on an iPhone no gesture either: a page that
 * looks stale can only be fixed by quitting the app. So this is on only when `isStandalone()` on a touch
 * screen, and it takes the gesture over there (`overscroll-behavior-y: contain` on the root) so that Android,
 * which does have its own in an installed app, never shows two.
 *
 * WHAT A PULL DOES: reloads the page — what the browser's own gesture does, and the one answer that is right
 * on every screen (it also picks up a new deploy). Nothing is refetched selectively.
 *
 * WHEN A PULL MAY START (`mayStartPull`) — the gesture must never cost somebody their work or fight a
 * control that also moves under a finger:
 *   · the page is at its very top, and one finger is down;
 *   · not inside a dialog or a drawer (a form half filled in), nor in a field being typed into;
 *   · not on a map, a canvas or a signature pad, which own the drag;
 *   · not inside any element that scrolls by itself (the chat's lines, a board's column): there the pull is
 *     that element's scroll, and only the document's own top counts.
 * The shop's tablet screens do not mount this at all — a reload in the middle of a count is the thing
 * `ShopLayout` exists to prevent.
 */

/** How far the finger travels before letting go refreshes; the indicator follows up to MAX. */
export const PULL_THRESHOLD_PX = 80;
const PULL_MAX_PX = 120;
/** The finger moves further than the indicator, as on a phone: a pull has resistance. */
const RESISTANCE = 0.5;

const OWN_THE_DRAG = "[role='dialog'], [aria-modal='true'], input, textarea, select, [contenteditable='true'], canvas, .maplibregl-map, [data-no-pull-refresh]";

function scrollsByItself(el: Element): boolean {
  const y = getComputedStyle(el).overflowY;
  return (y === "auto" || y === "scroll") && el.scrollHeight > el.clientHeight;
}

/** May a touch that begins on `target`, with the document scrolled `scrollY`, become a pull? */
export function mayStartPull(target: EventTarget | null, scrollY: number, touches: number): boolean {
  if (touches !== 1 || scrollY > 0) return false;
  if (!(target instanceof Element)) return false;
  if (target.closest(OWN_THE_DRAG)) return false;
  for (let el: Element | null = target; el && el !== document.documentElement && el !== document.body; el = el.parentElement) {
    if (scrollsByItself(el)) return false;
  }
  return true;
}

/** The installed app on a touch screen: the only place the gesture is offered. */
export function pullToRefreshApplies(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return isStandalone() && navigator.maxTouchPoints > 0;
}

export function usePullToRefresh(reload: () => void = () => window.location.reload()) {
  /** How far the indicator is pulled, 0 when idle. */
  const distance = ref(0);
  const refreshing = ref(false);
  let startY: number | null = null;

  function onStart(e: TouchEvent) {
    startY = !refreshing.value && mayStartPull(e.target, window.scrollY, e.touches.length) ? e.touches[0]!.clientY : null;
  }
  function onMove(e: TouchEvent) {
    if (startY === null) return;
    // A second finger, or the page having scrolled under the first, ends the pull without a refresh.
    if (e.touches.length !== 1 || window.scrollY > 0) return cancel();
    distance.value = Math.max(0, Math.min(PULL_MAX_PX, (e.touches[0]!.clientY - startY) * RESISTANCE));
  }
  function onEnd() {
    if (startY === null) return;
    startY = null;
    if (distance.value >= PULL_THRESHOLD_PX) {
      refreshing.value = true;
      reload();
    } else {
      distance.value = 0;
    }
  }
  function cancel() {
    startY = null;
    distance.value = 0;
  }

  let on = false;
  onMounted(() => {
    if (!pullToRefreshApplies()) return;
    on = true;
    // One gesture, ours: without this Android's installed app would also run its own.
    document.documentElement.style.overscrollBehaviorY = "contain";
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", cancel);
  });
  onUnmounted(() => {
    if (!on) return;
    document.documentElement.style.overscrollBehaviorY = "";
    window.removeEventListener("touchstart", onStart);
    window.removeEventListener("touchmove", onMove);
    window.removeEventListener("touchend", onEnd);
    window.removeEventListener("touchcancel", cancel);
  });

  return { distance, refreshing };
}
