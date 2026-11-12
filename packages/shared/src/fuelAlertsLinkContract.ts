import { ANOMALY_SEVERITIES, type AnomalySeverity } from "./constants.js";

/**
 * The Fuel alerts page's URL (`/anomalies`), ONE definition read by the page (`useAnomaliesPage`), by the
 * Fuel log's "Flagged" tile (`flaggedCasesLink`) and by Ask AI's `open_view` (F21 Step 5, D-AI6; why a
 * contract: `fuelCostsLinkContract.ts`).
 *
 * The page's own rules, stated once here rather than restated by each writer:
 * - `vehicle` is a comma-joined list of VEHICLE IDS (`anomalies.vehicle_id` is a foreign key), keeping its
 *   singular name because `/anomalies?vehicle=<id>` is a deep link reviewers forward (FUEL-P1).
 * - `status` is ONE of the page's four statuses, or `all`. Its ABSENCE means two different things: with
 *   no truck, the work queue (`open`); with trucks, their whole history. So "every status" is spelled
 *   `all` and never as absence (FUEL-C3; `anomaliesFiltersInUrl.test.ts`).
 * - `severity` is ONE severity: the page has a single-choice control, so "high or critical" has no
 *   address and a link must not pretend it does.
 * - `reefer=1` is the Reefer fueling tab; its absence is All alerts.
 * - `from`/`to` are carrier days on the fill (`fueled_at`).
 */
export const FUEL_ALERTS_QUERY_KEYS = {
  vehicles: "vehicle",
  status: "status",
  severity: "severity",
  from: "from",
  to: "to",
  reefer: "reefer",
} as const;

/** The statuses the page's Status control offers (`superseded` is bookkeeping, never a choice). */
export const FUEL_ALERTS_STATUSES = ["open", "investigating", "resolved", "dismissed"] as const;
export type FuelAlertsStatus = (typeof FUEL_ALERTS_STATUSES)[number];
/** The reader's explicit "every status", distinct from absence (see the header). */
export const FUEL_ALERTS_STATUS_ALL = "all";
export const FUEL_ALERTS_REEFER_ON = "1";
export const FUEL_ALERTS_SEVERITIES: readonly AnomalySeverity[] = ANOMALY_SEVERITIES;

export interface FuelAlertsLinkFilters {
  vehicleIds?: readonly string[];
  status?: FuelAlertsStatus | typeof FUEL_ALERTS_STATUS_ALL;
  severity?: AnomalySeverity;
  from?: string;
  to?: string;
  reeferOnly?: boolean;
}

export function fuelAlertsToQuery(f: FuelAlertsLinkFilters): Record<string, string> {
  const K = FUEL_ALERTS_QUERY_KEYS;
  const q: Record<string, string> = {};
  if (f.status) q[K.status] = f.status;
  if (f.severity) q[K.severity] = f.severity;
  if (f.from) q[K.from] = f.from;
  if (f.to) q[K.to] = f.to;
  if (f.vehicleIds?.length) q[K.vehicles] = f.vehicleIds.join(",");
  if (f.reeferOnly) q[K.reefer] = FUEL_ALERTS_REEFER_ON;
  return q;
}
