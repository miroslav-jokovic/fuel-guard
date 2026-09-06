import type { RouteLocationRaw } from "vue-router";

/**
 * Where each Dashboard fuel tile goes, and the window it takes with it (C9).
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────────────────────────
 * All five tiles linked to a bare `/fuel-log`. Two things were wrong with that, and the second is the
 * worse one. The strip asks five different questions and sent every one of them to the same answer;
 * and it dropped the PERIOD, so clicking "$41k, last 30 days" landed on a Fuel Log showing its own
 * default window and therefore a different number. A tile that cannot be clicked through to the
 * figure behind it is decoration; one that lands on a DIFFERENT figure is worse than decoration.
 *
 * ── THE RULE USED TO CHOOSE DESTINATIONS ────────────────────────────────────────────────────────
 * Each tile points at the page that computes THE SAME NUMBER — a stronger rule than "the page about
 * that topic", and the one that keeps the two screens agreeing:
 *
 *   · Fill-ups and Miles come from the Fuel Log's own range-aware totals (`useFuelLogTotals`), which
 *     `DashboardPage` reuses precisely "so the two pages agree". The Fuel Log reproduces them by
 *     construction rather than by coincidence.
 *   · Gallons and Spend come from the dashboard summary and are what `/fuel-spend`'s Spend & trend
 *     tab reports over the same window.
 *   · Avg MPG is the honest exception. `useFleetMpgSeries` renders on the Dashboard and the IFTA
 *     ledger and NOWHERE in the fuel section, so no page reproduces the average. The Fills tab holds
 *     the per-fill `computed_mpg` behind it, which is the closest answer that exists — named here
 *     rather than papered over.
 *
 * ⚠ NOT `/odometer`, which was the obvious target for Miles and is wrong twice over: it is a
 * MISMATCH report about odometer readings disagreeing, not a miles-driven figure, and it keeps its
 * date range in local refs rather than the URL — so a window sent to it is silently ignored and the
 * visitor lands on a different period anyway. Both destinations below read `from`/`to` from the query
 * (`useFuelLogFilters`'s `SHARED_FUEL_LOG_KEYS`, `useSpendFilters`), which is what makes the window
 * survive the click.
 */

export interface DashboardRange {
  from: string;
  to: string;
}

/** The tiles in the Dashboard's fuel strip, by the label each one carries. */
export const FUEL_TILE_LABELS = ["Fill-ups", "Gallons", "Miles driven", "Fuel spend", "Avg MPG"] as const;
export type FuelTileLabel = (typeof FUEL_TILE_LABELS)[number];

/**
 * Destinations for the whole strip, keyed by label and TOTAL over it — so a tile added to the strip
 * without a destination is a compiler error rather than a link that quietly falls back to nothing.
 */
export function fuelTileDestinations(range: DashboardRange): Record<FuelTileLabel, RouteLocationRaw> {
  const window = { from: range.from, to: range.to };
  const log: RouteLocationRaw = { path: "/fuel-log", query: { ...window, tab: "fills" } };
  const spend: RouteLocationRaw = { path: "/fuel-spend", query: { ...window, tab: "spend" } };
  return {
    "Fill-ups": log,
    Gallons: spend,
    "Miles driven": log,
    "Fuel spend": spend,
    "Avg MPG": log,
  };
}
