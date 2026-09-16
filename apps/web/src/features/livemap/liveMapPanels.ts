import { createDeviationSet } from "@/composables/useDeviationSet";

/**
 * Which corner a floating panel is pinned to (D-DR6, DESIGN-REFRESH-2026-09.md §4).
 *
 * ── THE CORNER IS FIXED, AND THAT IS A RULING RATHER THAN A SHORTCUT ─────────────────────────────
 * D-DR6 as first written said a floating panel is "a widget with a position". It is not, because
 * there is nowhere to put the position: `StoredDashboardLayout` holds `widgetKeys` and `hiddenKeys`
 * and nothing else, and migration 0343 has no column for one. Comp (7) draws every panel pinned to
 * a corner anyway, so fixed corners cost the design nothing and save a migration for a capability
 * nobody has asked for.
 *
 * ⚠ There is no `bottom-right`. Comp (7) puts "Recent alerts" there and this board has no alert feed
 * to put in it — `GET /api/livemap/positions` returns vehicles, bounds, a generated-at stamp and the
 * scope sentence, nothing resembling an event stream. Drawing that panel would be D-DR12's mistake
 * in a third costume. The corner is absent rather than empty, which is the difference between a
 * decision and an oversight.
 */
export type LiveMapCorner = "top-left" | "top-right" | "bottom-left";

export interface LiveMapPanelSpec {
  title: string;
  /** `null` for the fleet list, which is a dock across the bottom rather than a corner (D-DR7). */
  corner: LiveMapCorner | null;
  /** What the dispatcher sees before they have ever touched it. */
  openByDefault: boolean;
}

/**
 * The panels a dispatcher can shut, and the keys their choice is stored under.
 *
 * ⚠ The VEHICLE card is deliberately not in here. It is not shut and reopened — it is present when
 * a truck is selected and absent when none is — so "remembered as closed" would mean clicking a
 * truck and getting nothing back, with the control that would fix it two visits ago in their
 * memory. Its dismiss button clears the selection, which is the thing that made it appear.
 *
 * ⚠ The fleet list starts SHUT and the two corner panels start open, and that asymmetry is the one
 * default worth arguing for. D-DR5's whole point is that the map becomes the page; a dock holding
 * 199 rows that opened by itself would hand a third of the viewport straight back to the document
 * this step replaces. The corner panels are small, are what comp (7) draws, and are the board's own
 * report on itself.
 */
export const LIVE_MAP_PANELS = {
  status: { title: "Fleet status", corner: "top-left", openByDefault: true },
  filters: { title: "Filters", corner: "top-right", openByDefault: true },
  fleet: { title: "Fleet list", corner: null, openByDefault: false },
} as const satisfies Record<string, LiveMapPanelSpec>;

export type LiveMapPanelKey = keyof typeof LIVE_MAP_PANELS;

const STORAGE_KEY = "fg.livemap-panels";

/**
 * Module-level, like the sidebar's: one live map per tab, and the dispatcher's choice has to survive
 * the component being unmounted and remounted by a route change.
 *
 * See `useDeviationSet` for why this is `localStorage` and not LM10's `user_dashboard_layout` row —
 * the short version is that `PUT /api/dashboard-layout` refuses a key the widget catalogue does not
 * know, and getting one in there would mean inventing a widget, a tab and a component to store one
 * boolean.
 */
const panels = createDeviationSet(STORAGE_KEY);

/**
 * Open exactly when the stored set says this panel is at its default and that default is open, or
 * says it has been moved and its default was shut. One XOR, so the stored empty set reproduces the
 * defaults above and nothing has to be seeded on first visit.
 */
export function isPanelOpen(key: LiveMapPanelKey): boolean {
  return LIVE_MAP_PANELS[key].openByDefault !== panels.has(key);
}

export function useLiveMapPanels() {
  return { isPanelOpen, toggle: (key: LiveMapPanelKey) => panels.toggle(key) };
}
