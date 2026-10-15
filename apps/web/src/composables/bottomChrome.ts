import { computed, onBeforeUnmount, reactive, type Ref } from "vue";
import { useResizeObserver } from "@vueuse/core";

/**
 * Chrome fixed along the bottom of the window — a phone's action bar — and how tall it is now.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────────────────
 * The Ask AI launcher lives in `App.vue`, beside every page rather than inside one, and parks in the
 * bottom-right corner. On the shelf walk at 390 px that corner is the walk's fixed bottom bar, and
 * the launcher sat over its primary action, "Record count" (seen in the UI-standardization browser
 * pass, 2026-10-15). The bar is the page's; the launcher is the shell's; neither can see the other.
 * So a bar says how tall it is HERE, measured, and the launcher keeps itself above the tallest.
 * The height is read from the element, never restated: the bar's padding includes the
 * safe-area inset, which no constant could know.
 *
 * A bar hidden by a breakpoint (`sm:hidden`) measures 0, so the launcher returns to its corner on a
 * wider window with nothing to unregister.
 */
const heights = reactive(new Map<symbol, number>());

/** The tallest bottom chrome on screen now, in px; 0 when there is none. */
export const bottomChromeHeight = computed(() => Math.max(0, ...heights.values()));

/** Register `el` as bottom chrome for the life of the calling component. */
export function useBottomChrome(el: Ref<HTMLElement | null>) {
  const id = Symbol("bottom-chrome");
  useResizeObserver(el, () => heights.set(id, el.value?.offsetHeight ?? 0));
  onBeforeUnmount(() => heights.delete(id));
}
