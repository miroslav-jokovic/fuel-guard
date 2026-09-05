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
  /** null = no data that day (MPG trend renders a gap; spend zero-fills instead). */
  value: number | null;
}

export interface RiskRow {
  id: string;
  label: string;
  anomalyCount: number;
  criticalCount: number;
}

export type DashboardTransaction = Pick<FuelTransaction, "id" | "vehicle_id" | "driver_id" | "fueled_at" | "gallons" | "total_cost" | "computed_mpg"> & {
  tank_type?: "tractor" | "reefer" | null;
  samsara_recon_at?: string | null;
};

export type DashboardAnomaly = Pick<Anomaly, "id" | "transaction_id" | "vehicle_id" | "severity" | "status">;

export interface DashboardSummary {
  totalSpend: number;
  totalGallons: number;
  fleetMpg: number | null; // gallon-weighted average of computed MPG
  openAnomalies: number;
  mpgTrend: TrendPoint[];
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

// A fleet vehicle's real MPG is never below ~1 or above ~40. Values outside this band come from a
// corrupt fill (bad/blank odometer, a missed prior fill, a top-off after barely moving) and would drag
// the gallon-weighted daily average to a nonsense spike/dip. Exclude them from the efficiency views —
// the underlying bad fill is still surfaced by the anomaly engine. Kept wide so real economy is untouched.
export const MPG_PLAUSIBLE_MIN = 1;
export const MPG_PLAUSIBLE_MAX = 40;
const plausibleMpg = (n: number) => Number.isFinite(n) && n >= MPG_PLAUSIBLE_MIN && n <= MPG_PLAUSIBLE_MAX;

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
  let mpgWeighted = 0;
  let mpgGallons = 0;
  let reeferSpend = 0;
  let coveredTxns = 0;
  let totalTxns = 0;

  const spendByDay = new Map<string, number>();
  const mpgGalByDay = new Map<string, { mpgGal: number; gal: number }>();

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

    if (t.computed_mpg != null && gallons > 0 && plausibleMpg(Number(t.computed_mpg))) {
      const mpg = Number(t.computed_mpg);
      mpgWeighted += mpg * gallons;
      mpgGallons += gallons;
      const cur = mpgGalByDay.get(d) ?? { mpgGal: 0, gal: 0 };
      cur.mpgGal += mpg * gallons;
      cur.gal += gallons;
      mpgGalByDay.set(d, cur);
    }
  }

  const seenDays = [...spendByDay.keys()].sort();
  const allDays = seenDays.length ? dateRangeDays(seenDays[0]!, seenDays[seenDays.length - 1]!) : [];

  const spendTrend: TrendPoint[] = allDays.map((date) => ({
    date,
    value: round2(spendByDay.get(date) ?? 0), // zero-fill: a no-spend day is a real $0 day
  }));

  const mpgTrend: TrendPoint[] = allDays.map((date) => {
    const cur = mpgGalByDay.get(date);
    return { date, value: cur && cur.gal > 0 ? round2(cur.mpgGal / cur.gal) : null }; // null = gap, not 0 MPG
  });

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
    fleetMpg: mpgGallons > 0 ? round2(mpgWeighted / mpgGallons) : null,
    openAnomalies: open.length,
    mpgTrend,
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
