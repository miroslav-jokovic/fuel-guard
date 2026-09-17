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
 * ── ⚠ THE PANEL REGISTRY AND ITS MEMORY ARE GONE (D-DR25, 2026-09-16) ────────────────────────────
 * This file used to carry three panels — "Fleet status" top-left, "Filters" top-right, a fleet dock
 * across the bottom — and a `localStorage` set remembering which of them a dispatcher had shut. The
 * left rail replaced all three with one column, so there is nothing left to remember, and the
 * remembering itself turned out to be the wrong half of D-DR6:
 *
 *   · **A stored "closed" outlives the reason for it.** A dispatcher who shut the filters once came
 *     back weeks later to a map with no visible way to find a truck by number. The rail cannot be
 *     shut at `lg` and above at all, and below it the overlay is a gesture rather than a preference.
 *   · **It cost a measurement its footing.** The perf handoff records a "45% of viewport" reading
 *     that turned out to be leftover clicking from an earlier run — panel memory surviving between
 *     measurements, which is the same property that makes a surface hard to reason about in use.
 *
 * What survives is the TYPE below, because the selected-truck card is still a floating panel and
 * still has to say which corner it is in.
 */
export type LiveMapCorner = "top-left" | "top-right" | "bottom-left";
