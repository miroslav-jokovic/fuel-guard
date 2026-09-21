import type { AnomalySeverity } from "./constants.js";
import type { FuelTransaction } from "./fuel.js";
import type { Anomaly } from "./anomaly.js";
import type { Vehicle, Driver } from "./fleet.js";
import type { IdleCostBasisInput } from "./idleBreakdown.js";

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
  /** % of fills corroborated by telematics IN THE RANGE (null when the range holds no fills). */
  coveragePct: number | null;
  /**
   * The same share over the carrier's WHOLE history (D-SAM7). Null when nothing supplied it — the
   * tile then shows the windowed figure alone, which is what it did before 0322, rather than a zero.
   */
  allTimeCoveragePct: number | null;
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
 *  Idle arrives PRE-AGGREGATED (seconds from idle_rollup_days + the org's cost basis) so the
 *  dashboard tile shows the SAME numbers as the Idling page instead of a parallel per-event
 *  computation — these are the inputs the fills themselves cannot supply. */
export interface DashboardExtras {
  /**
   * Idle seconds over the range. SECONDS and not hours, and a BASIS rather than a dollar figure,
   * because "hours × gal/h × $/gal" is a rule and this file is where the dashboard's rules live
   * (Q9). It used to arrive as `idleHours` + `idleCostUsd` with the multiplication done in
   * `useDashboard.ts`, which left the browser holding one copy of the rule and the API about to
   * write a second.
   */
  idleSec?: number;
  /** Burn rate + $/gal from `resolveIdleCostBasis` (idle module) — the Idling page's own basis. */
  costBasis?: IdleCostBasisInput;
  declinedCount?: number;
  /** Driver per anomaly TRANSACTION (txn id → driver id) — the alert set is CURRENT-state (all time),
   *  so its drivers cannot be derived from the range-scoped `transactions` argument. Without this map
   *  the risk list silently dropped every driver whose flagged fill fell outside the visible range. */
  anomalyDrivers?: Map<string, string | null>;
  /**
   * All-time coverage, from `telematics_coverage_buckets()` (D-SAM7, migration 0322).
   *
   * Beside `coveragePct`, not instead of it, because they answer different questions and the whole
   * finding was that only one of them was being asked. Over 90 days the figure reads ~95%; measured
   * against the carrier's whole history on 2026-09-01 it was 23%. Both were correct, and a tile
   * showing only the first converts an unanswered question into a reassuring answer.
   */
  allTimeCoveragePct?: number | null;
}

/**
 * What was MEASURED, before any judgement is applied to it (queue item 5, Q8 —
 * `docs/plans/fuel/DATA-PRECISION-AUDIT-2026-09-20.md` §7.2).
 *
 * This is the seam the audit asked for: sums, counts and groupings are facts and can be taken where
 * the rows are (migration 0347's `dashboard_summary`, one round trip); rounding, zero-filling,
 * null-for-unknown and the moving-spend floor are product judgements and stay in
 * `summariseDashboard` below. Two producers, ONE verdict — `aggregateDashboard` folds rows into this
 * shape for the report that already holds them, and the API fills it straight from SQL.
 *
 * Everything here is UNROUNDED and SPARSE on purpose. A day with no spend is simply absent: whether
 * it counts as a real $0 day is the verdict's question, and the two callers must not be able to
 * answer it differently.
 */
export interface DashboardMeasurements {
  totalSpend: number;
  totalGallons: number;
  reeferSpend: number;
  coveredTxns: number;
  totalTxns: number;
  /** Spend per day, bucketed in the org's zone. Sparse and in no required order. */
  spendByDay: { date: string; value: number }[];
  /** Open cases by severity; an absent severity means none, which the verdict turns into a 0. */
  severityCounts: Partial<Record<AnomalySeverity, number>>;
  /** ⚠ ALL-TIME open cases, not range-scoped (D-PREC7) — see `aggregateDashboard`'s SCOPES note. */
  openAnomalies: number;
  /** Already ordered by critical desc, then count desc, and cut to five. */
  topVehiclesByRisk: RiskRow[];
  topDriversByRisk: RiskRow[];
  /** Idle seconds over the range, from the pre-aggregated rollup. Hours and dollars are verdicts. */
  idleSec: number;
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
  return summariseDashboard(measureDashboard(transactions, anomalies, vehicles, drivers, opts, extra), extra);
}

/**
 * Fold rows into the same MEASUREMENTS migration 0347 takes in SQL (Q8).
 *
 * Kept for the caller that already holds the rows — `GET /api/reports/summary.pdf` reads its own
 * window and has no reason to ask the database to count what it is holding. The Dashboard does not
 * come through here any more: it asks `dashboard_summary` and hands the answer straight to
 * `summariseDashboard`, which is the same verdict this function's result flows into.
 *
 * Of the extras it reads only `anomalyDrivers` and `idleSec` — both measurements the fills cannot
 * supply.
 */
export function measureDashboard(
  transactions: DashboardTransaction[],
  anomalies: DashboardAnomaly[],
  vehicles: Pick<Vehicle, "id" | "unit_number">[],
  drivers: Pick<Driver, "id" | "full_name">[],
  opts: DashboardOptions = {},
  extra: DashboardExtras = {},
): DashboardMeasurements {
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

  // Anomalies (active = not superseded).
  const active = anomalies.filter((a) => a.status !== "superseded");
  const open = active.filter((a) => a.status === "open" || a.status === "investigating");
  const severityCounts = emptySeverity();
  for (const a of open) severityCounts[a.severity] += 1;

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

  return {
    totalSpend,
    totalGallons,
    reeferSpend,
    coveredTxns,
    totalTxns,
    spendByDay: [...spendByDay].map(([date, value]) => ({ date, value })),
    severityCounts,
    openAnomalies: open.length,
    topVehiclesByRisk: [...vehRisk.values()].sort(byRisk).slice(0, 5),
    topDriversByRisk: [...drvRisk.values()].sort(byRisk).slice(0, 5),
    idleSec: extra.idleSec ?? 0,
  };
}

/**
 * Turn measurements into the view the Dashboard renders — the ~10% of this file that is JUDGEMENT
 * rather than arithmetic, and the reason migration 0347 deliberately returns neither rounding nor
 * null-for-unknown (Q8, §7.2).
 *
 * Each rule below has an argument behind it, and each is now applied exactly once whether the
 * measurements were folded from rows or counted in SQL:
 *
 *  - **The day series is zero-filled between the first and last day that saw spend**, not across
 *    the requested window. A no-spend day INSIDE the fuelling period is a real $0 day and used to
 *    disappear, which masked lost import days; padding beyond the data would instead invent $0 days
 *    at the edges of a window nobody fuelled in.
 *  - **`coveragePct` is null, not 0, when there is nothing to divide** — the same rule
 *    `allTimeCoveragePct` follows: no fills, no percentage.
 *  - **`allTimeCoveragePct` is `?? null` and never `?? 0`**, because 0% corroborated is an alarming
 *    claim to make on the strength of a missing argument.
 *  - **`movingSpend` has a floor at zero.** Idle cost is an estimate over a basis and tractor spend
 *    is a fact; a fleet that idled more than it bought would otherwise draw a negative donut slice.
 *  - **Idle dollars are hours × gal/h × $/gal**, computed here from seconds and the basis, so the
 *    tile, the Idling page and the fuel-spend report cannot drift apart (Q9).
 */
export function summariseDashboard(m: DashboardMeasurements, extra: DashboardExtras = {}): DashboardSummary {
  const spendByDay = new Map(m.spendByDay.map((d) => [d.date, d.value]));
  const seenDays = [...spendByDay.keys()].sort();
  const allDays = seenDays.length ? dateRangeDays(seenDays[0]!, seenDays[seenDays.length - 1]!) : [];
  const spendTrend: TrendPoint[] = allDays.map((date) => ({
    date,
    value: round2(spendByDay.get(date) ?? 0), // zero-fill: a no-spend day is a real $0 day
  }));

  const anomaliesBySeverity = emptySeverity();
  for (const [severity, n] of Object.entries(m.severityCounts)) {
    if (severity in anomaliesBySeverity) anomaliesBySeverity[severity as AnomalySeverity] = n ?? 0;
  }

  const idleHoursRaw = m.idleSec / 3600;
  const basis = extra.costBasis;
  const idleCostUsd = round2(basis ? idleHoursRaw * basis.idleGalPerHour * basis.fuelPricePerGal : 0);
  const idleHours = round2(idleHoursRaw);
  const reeferSpend = round2(m.reeferSpend);
  const tractorSpend = round2(m.totalSpend - m.reeferSpend);
  const movingSpend = round2(Math.max(0, tractorSpend - idleCostUsd));
  const coveragePct = m.totalTxns > 0 ? Math.round((m.coveredTxns / m.totalTxns) * 100) : null;

  return {
    totalSpend: round2(m.totalSpend),
    totalGallons: round2(m.totalGallons),
    openAnomalies: m.openAnomalies,
    spendTrend,
    anomaliesBySeverity,
    topVehiclesByRisk: m.topVehiclesByRisk,
    topDriversByRisk: m.topDriversByRisk,
    idleCostUsd,
    idleHours,
    reeferSpend,
    movingSpend,
    coveragePct,
    // `?? null` and never `?? 0`: a figure nobody supplied is unknown, and 0% corroborated is an
    // alarming claim to make on the strength of a missing argument.
    allTimeCoveragePct: extra.allTimeCoveragePct ?? null,
    declinedCount: extra.declinedCount ?? 0,
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────
// `toCsv` moved to `csv.ts` at FUEL-P2, where it is one rule for every exporter rather than two that
// had already drifted about negative numbers. Its callers import it from the package barrel, unchanged.
