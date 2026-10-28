import { computed, onBeforeUnmount, reactive, type Ref } from "vue";
import { useResizeObserver } from "@vueuse/core";

/**
 * Chrome fixed along the bottom of the window — a phone's action bar, a section's tab row — and how
 * tall it is now.
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
 * ── TWO LAYERS (DESIGN-SYSTEM-CONTRACT.md §9, Maintenance M4) ─────────────────────────────────
 * The shop's tab row (`SectionTabBar`) sits on the window's edge and a page's verbs (`WalkActions`)
 * stand on top of it: verbs are what this page does, doors are where else to go, and the thumb
 * reaches the verbs first. So a registration is a BASE (the tab row, on the edge) or a bar (above
 * every base), the bar reads `bottomBaseHeight` for where to stand, and the launcher and the page's
 * bottom padding read the sum. A bar hidden by a breakpoint (`md:hidden`) measures 0, so everything
 * returns to the edge on a wider window with nothing to unregister.
 */
const bars = reactive(new Map<symbol, number>());
const bases = reactive(new Map<symbol, number>());

/** The tallest chrome on the window's edge now — the tab row — in px; 0 when there is none. */
export const bottomBaseHeight = computed(() => Math.max(0, ...bases.values()));

/** Everything fixed along the bottom now — the base plus the tallest bar on it — in px. */
export const bottomChromeHeight = computed(() => bottomBaseHeight.value + Math.max(0, ...bars.values()));

/** Register `el` as bottom chrome for the life of the calling component; `base` for the edge layer. */
export function useBottomChrome(el: Ref<HTMLElement | null>, { base = false }: { base?: boolean } = {}) {
  const id = Symbol("bottom-chrome");
  const layer = base ? bases : bars;
  useResizeObserver(el, () => layer.set(id, el.value?.offsetHeight ?? 0));
  onBeforeUnmount(() => layer.delete(id));
}
