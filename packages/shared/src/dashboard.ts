import type { AnomalySeverity } from "./constants.js";
import type { FuelTransaction } from "./fuel.js";
import type { Anomaly } from "./anomaly.js";
import type { Vehicle, Driver } from "./fleet.js";

/**
 * Pure dashboard aggregation (docs/04 Phase 7). The web fetches org-scoped rows (RLS-protected) and
 * passes them here; keeping the math pure makes it fully unit-testable.
 */

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  /** null = no data that day. Spend zero-fills instead: a no-spend day is a real $0 day. */
  value: number | null;
}

export interface RiskRow {
  id: string;
  label: string;
  anomalyCount: number;
  criticalCount: number;
}

export type DashboardTransaction = Pick<FuelTransaction, "id" | "vehicle_id" | "driver_id" | "fueled_at" | "gallons" | "total_cost"> & {
  tank_type?: "tractor" | "reefer" | null;
  samsara_recon_at?: string | null;
};

export type DashboardAnomaly = Pick<Anomaly, "id" | "transaction_id" | "vehicle_id" | "severity" | "status">;

export interface DashboardSummary {
  totalSpend: number;
  totalGallons: number;
  openAnomalies: number;
  /**
   * ⚠ **There is no `fleetMpg` or `mpgTrend` here, and that is the point of M4.**
   *
   * Both were computed in this file from the fills the browser happened to be holding — one of four
   * copies of the same definition, over a numerator that ran 1.31–2.41% below Samsara's own IFTA
   * miles. Fleet MPG now comes from `GET /api/fueling/fleet-mpg` (D-MPG1), whose numerator is the
   * difference between two odometer readings the vendor asserted and which a browser cannot see.
   * The trend went WEEKLY at the same time (D-MPG6): a day's fuel purchases are not that day's
   * consumption, and the daily series this field used to feed looked reassuringly smooth only
   * because its miles and its gallons had been spread across the same interval together.
   */
  spendTrend: TrendPoint[];
  anomaliesBySeverity: Record<AnomalySeverity, number>;
  topVehiclesByRisk: RiskRow[];
  topDriversByRisk: RiskRow[];
  // Range-scoped feature metrics (0/null when their inputs aren't supplied).
  idleCostUsd: number;
  idleHours: number;
  reeferSpend: number;
  /** Tractor fuel that actually moved the truck (tractor spend minus idle). Donut slice. */
  movingSpend: number;
  /** % of fills corroborated by telematics (null when no fills in range). */
  coveragePct: number | null;
  declinedCount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// The per-FILL plausibility band lives in `fuelSpend/fleetEfficiency.ts` (M4, D-MPG1), beside the
// fleet band and the coverage floor it sits next to in every argument about MPG. It is not re-exported
// from here any more: this file no longer applies it, and re-exporting a constant a module does not
// use is how the next reader concludes it does.

/** Options for aggregateDashboard. `tz` buckets trend days in the org's timezone (UTC when absent). */
export interface DashboardOptions {
  /** IANA timezone for day bucketing (e.g. "America/Chicago"). Defaults to UTC slicing. */
  tz?: string | null;
}

/** Secondary inputs so the range-scoped dashboard can also show idle waste, declines, etc. Pure.
 *  Idle arrives PRE-AGGREGATED (hours from idle_rollup_days + the org's cost basis) so the dashboard
 *  tile shows the SAME numbers as the Idling page instead of a parallel per-event computation. */
export interface DashboardExtras {
  idleHours?: number;
  idleCostUsd?: number;
  declinedCount?: number;
  /** Driver per anomaly TRANSACTION (txn id → driver id) — the alert set is CURRENT-state (all time),
   *  so its drivers cannot be derived from the range-scoped `transactions` argument. Without this map
   *  the risk list silently dropped every driver whose flagged fill fell outside the visible range. */
  anomalyDrivers?: Map<string, string | null>;
}

/** YYYY-MM-DD of an instant in a timezone (cached Intl formatter per tz). */
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
export function dayInTz(iso: string, tz: string | null | undefined): string {
  if (!tz) return iso.slice(0, 10);
  let fmt = dayFormatters.get(tz);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      return iso.slice(0, 10); // unknown tz → deterministic UTC fallback
    }
    dayFormatters.set(tz, fmt);
  }
  return fmt.format(new Date(iso)); // en-CA formats as YYYY-MM-DD
}

/** Every YYYY-MM-DD from `from` to `to` inclusive (both valid ISO dates). */
export function dateRangeDays(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function emptySeverity(): Record<AnomalySeverity, number> {
  return { low: 0, medium: 0, high: 0, critical: 0 };
}

/**
 * Aggregate transactions + anomalies into the executive dashboard view. Trend days are bucketed in
 * the ORG's timezone and ZERO-FILLED across the covered range, so a day with no fuel activity shows
 * as an honest 0/gap instead of silently disappearing (which previously masked lost import days).
 *
 * SCOPES (deliberately mixed, matching what each card claims): spend/MPG/coverage read the RANGE-scoped
 * `transactions`; the alert cards (count, severity, risk lists) read `anomalies` as the CURRENT
 * open/investigating set — the same thing the Alerts page shows when the card is clicked. Passing
 * range-filtered anomalies here makes the card disagree with the page it links to.
 */
export function aggregateDashboard(
  transactions: DashboardTransaction[],
  anomalies: DashboardAnomaly[],
  vehicles: Pick<Vehicle, "id" | "unit_number">[],
  drivers: Pick<Driver, "id" | "full_name">[],
  opts: DashboardOptions = {},
  extra: DashboardExtras = {},
): DashboardSummary {
  let totalSpend = 0;
  let totalGallons = 0;
  let reeferSpend = 0;
  let coveredTxns = 0;
  let totalTxns = 0;

  const spendByDay = new Map<string, number>();

  for (const t of transactions) {
    const gallons = Number(t.gallons) || 0;
    const cost = t.total_cost == null ? 0 : Number(t.total_cost);
    totalGallons += gallons;
    totalSpend += cost;
    totalTxns += 1;
    if (t.tank_type === "reefer") reeferSpend += cost;
    if (t.samsara_recon_at != null) coveredTxns += 1;

    const d = dayInTz(t.fueled_at, opts.tz);
    spendByDay.set(d, (spendByDay.get(d) ?? 0) + cost);
  }

  const seenDays = [...spendByDay.keys()].sort();
  const allDays = seenDays.length ? dateRangeDays(seenDays[0]!, seenDays[seenDays.length - 1]!) : [];

  const spendTrend: TrendPoint[] = allDays.map((date) => ({
    date,
    value: round2(spendByDay.get(date) ?? 0), // zero-fill: a no-spend day is a real $0 day
  }));

  // Anomalies (active = not superseded).
  const active = anomalies.filter((a) => a.status !== "superseded");
  const open = active.filter((a) => a.status === "open" || a.status === "investigating");
  const anomaliesBySeverity = emptySeverity();
  for (const a of open) anomaliesBySeverity[a.severity] += 1;

  // Risk per vehicle / driver (by open anomaly counts).
  const vehLabel = new Map(vehicles.map((v) => [v.id, v.unit_number]));
  const drvLabel = new Map(drivers.map((d) => [d.id, d.full_name]));
  const txnDriver = new Map(transactions.map((t) => [t.id, t.driver_id]));

  const vehRisk = new Map<string, RiskRow>();
  const drvRisk = new Map<string, RiskRow>();
  for (const a of open) {
    if (a.vehicle_id) {
      const row = vehRisk.get(a.vehicle_id) ?? { id: a.vehicle_id, label: vehLabel.get(a.vehicle_id) ?? "—", anomalyCount: 0, criticalCount: 0 };
      row.anomalyCount += 1;
      if (a.severity === "critical") row.criticalCount += 1;
      vehRisk.set(a.vehicle_id, row);
    }
    const driverId = extra.anomalyDrivers?.get(a.transaction_id) ?? txnDriver.get(a.transaction_id) ?? null;
    if (driverId) {
      const row = drvRisk.get(driverId) ?? { id: driverId, label: drvLabel.get(driverId) ?? "—", anomalyCount: 0, criticalCount: 0 };
      row.anomalyCount += 1;
      if (a.severity === "critical") row.criticalCount += 1;
      drvRisk.set(driverId, row);
    }
  }

  const byRisk = (a: RiskRow, b: RiskRow) =>
    b.criticalCount - a.criticalCount || b.anomalyCount - a.anomalyCount;

  const idleCostUsd = round2(extra.idleCostUsd ?? 0);
  const idleHours = round2(extra.idleHours ?? 0);
  const reeferSpendR = round2(reeferSpend);
  const tractorSpend = round2(totalSpend - reeferSpend);
  const movingSpend = round2(Math.max(0, tractorSpend - idleCostUsd));
  const coveragePct = totalTxns > 0 ? Math.round((coveredTxns / totalTxns) * 100) : null;

  return {
    totalSpend: round2(totalSpend),
    totalGallons: round2(totalGallons),
    openAnomalies: open.length,
    spendTrend,
    anomaliesBySeverity,
    topVehiclesByRisk: [...vehRisk.values()].sort(byRisk).slice(0, 5),
    topDriversByRisk: [...drvRisk.values()].sort(byRisk).slice(0, 5),
    idleCostUsd,
    idleHours,
    reeferSpend: reeferSpendR,
    movingSpend,
    coveragePct,
    declinedCount: extra.declinedCount ?? 0,
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────
// `toCsv` moved to `csv.ts` at FUEL-P2, where it is one rule for every exporter rather than two that
// had already drifted about negative numbers. Its callers import it from the package barrel, unchanged.
