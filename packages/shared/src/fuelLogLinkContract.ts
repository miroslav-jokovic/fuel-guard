/**
 * The Fuel log page's URL (`/fuel-log`), ONE definition read by the page (`useFuelLogFilters` and its
 * three tabs) and by Ask AI's `open_view` (F21 Step 5, D-AI6; why a contract: `fuelCostsLinkContract.ts`).
 *
 * The page's own rules, which this file states once rather than restating:
 * - `tab`, `from`, `to` and `unit` are SHARED: they mean the same on a fill, a decline and a raw EFS
 *   line, so they survive a tab change. Every other key belongs to ONE tab and is cleared when the tab
 *   changes (`useFuelLogFilters`' header has the correctness reason: `driver` is an id on Fills and a
 *   name on the two feeds, and `sort` names a column only one table has).
 * - `unit` is a comma-joined list of UNIT NUMBERS, not vehicle ids (FUEL-P1): two of the three tabs
 *   read tables that key on EFS's text unit, and old `/transactions?unit=654` links still carry one.
 * - A window's absence is every day there is: the Fuel log has never had a default window (C3).
 *
 * `FUEL_LOG_FACET_TABS` says which tab owns each facet a link may set, so a link can never put Fills'
 * `tank` on the Declines tab, where the page would ignore it and show a list wider than the link says.
 */
export const FUEL_LOG_TABS = ["fills", "declines", "source"] as const;
export type FuelLogTab = (typeof FUEL_LOG_TABS)[number];
export const DEFAULT_FUEL_LOG_TAB: FuelLogTab = "fills";

export const FUEL_LOG_QUERY_KEYS = {
  tab: "tab",
  from: "from",
  to: "to",
  units: "unit",
  tank: "tank",
  risk: "risk",
  state: "state",
} as const;

/** The keys that survive a tab change; every other key in the query belongs to the open tab. */
export const SHARED_FUEL_LOG_KEYS = [
  FUEL_LOG_QUERY_KEYS.tab,
  FUEL_LOG_QUERY_KEYS.from,
  FUEL_LOG_QUERY_KEYS.to,
  FUEL_LOG_QUERY_KEYS.units,
] as const;

/** Fills' tank facet: which tank the fill went into. */
export const FUEL_LOG_TANK_TYPES = ["tractor", "reefer"] as const;
export type FuelLogTankType = (typeof FUEL_LOG_TANK_TYPES)[number];

/** Declines' risk facet: the decline scorer's `suspicion_level`. */
export const FUEL_LOG_DECLINE_RISKS = ["alert", "review", "clear"] as const;
export type FuelLogDeclineRisk = (typeof FUEL_LOG_DECLINE_RISKS)[number];

/** The tab that owns each facet a link may set. `state` is the purchase state on both EFS feeds. */
export const FUEL_LOG_FACET_TABS = {
  tank: ["fills"],
  risk: ["declines"],
  state: ["declines", "source"],
} as const satisfies Record<"tank" | "risk" | "state", readonly FuelLogTab[]>;

export interface FuelLogLinkFilters {
  tab?: FuelLogTab;
  from?: string;
  to?: string;
  /** Unit numbers as the fleet spells them. Empty or absent = the whole fleet. */
  units?: readonly string[];
  tank?: FuelLogTankType;
  risk?: FuelLogDeclineRisk;
  /** Two-letter purchase state, as EFS writes it. */
  state?: string;
}

export function fuelLogToQuery(f: FuelLogLinkFilters): Record<string, string> {
  const K = FUEL_LOG_QUERY_KEYS;
  const q: Record<string, string> = {};
  if (f.tab && f.tab !== DEFAULT_FUEL_LOG_TAB) q[K.tab] = f.tab;
  if (f.from) q[K.from] = f.from;
  if (f.to) q[K.to] = f.to;
  if (f.units?.length) q[K.units] = f.units.join(",");
  if (f.tank) q[K.tank] = f.tank;
  if (f.risk) q[K.risk] = f.risk;
  if (f.state) q[K.state] = f.state;
  return q;
}
