import { createDeviationSet } from "@/composables/useDeviationSet";

/**
 * Which sidebar sections are collapsed (phase 6).
 *
 * ── The problem this solves ─────────────────────────────────────────────────────────────────────
 * Every section and every item was visible at once — six labelled groups plus the ungrouped top —
 * so the nav scrolled, and a scrolling nav is one where you cannot see where you are. The confusion
 * is structural rather than cosmetic: a list long enough to scroll asks the reader to hold its shape
 * in their head.
 *
 * ── Why the stored set is what CHANGED, not what is open ────────────────────────────────────────
 * The first draft stored open sections, and it was wrong in a way worth recording. That argument now
 * lives in `useDeviationSet`, which the live map's floating panels share (D-DR6) — it had already
 * been transcribed once into `useTableColumns` before anybody noticed it was a mechanism rather than
 * a remark. Every section here defaults to OPEN, so this set is exactly the collapsed ones and the
 * behaviour is unchanged from the draft that shipped.
 *
 * ── One rule overrides the preference ───────────────────────────────────────────────────────────
 * The section containing the CURRENT route is always open, whatever was stored. Otherwise a deep
 * link, a redirect after sign-in, or a notification lands you on a page whose own section is
 * collapsed, and the nav is actively lying about where you are. Remembered state decides what else
 * is open; it never decides to hide the page you are on.
 *
 * ⚠ That override is why this file still exists rather than the sidebar calling `createDeviationSet`
 * directly: it is a rule about the CURRENT ROUTE, which a generic set of changed things has no
 * business knowing.
 */
const STORAGE_KEY = "fg.sidebar-collapsed";

/** Module-level: one sidebar, one set of collapsed sections, however many components ask. */
const sections = createDeviationSet(STORAGE_KEY);

export function useSidebarSections(currentSection: () => string | null) {
  const isOpen = (label: string) => label === currentSection() || !sections.has(label);

  return {
    isOpen,
    toggle: sections.toggle,
    /** Exposed for tests and for a future "expand all" affordance. */
    collapsedCount: sections.count,
  };
}
