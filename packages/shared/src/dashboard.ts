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
 */
export function aggregateDashboard(
  transactions: FuelTransaction[],
  anomalies: Anomaly[],
  vehicles: Pick<Vehicle, "id" | "unit_number">[],
  drivers: Pick<Driver, "id" | "full_name">[],
  opts: DashboardOptions = {},
): DashboardSummary {
  let totalSpend = 0;
  let totalGallons = 0;
  let mpgWeighted = 0;
  let mpgGallons = 0;

  const spendByDay = new Map<string, number>();
  const mpgGalByDay = new Map<string, { mpgGal: number; gal: number }>();

  for (const t of transactions) {
    const gallons = Number(t.gallons) || 0;
    const cost = t.total_cost == null ? 0 : Number(t.total_cost);
    totalGallons += gallons;
    totalSpend += cost;

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
    const driverId = txnDriver.get(a.transaction_id) ?? null;
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
    totalSpend: round2(totalSpend),
    totalGallons: round2(totalGallons),
    fleetMpg: mpgGallons > 0 ? round2(mpgWeighted / mpgGallons) : null,
    openAnomalies: open.length,
    mpgTrend,
    spendTrend,
    anomaliesBySeverity,
    topVehiclesByRisk: [...vehRisk.values()].sort(byRisk).slice(0, 5),
    topDriversByRisk: [...drvRisk.values()].sort(byRisk).slice(0, 5),
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** Serialize rows to CSV given ordered columns. RFC-4180 quoting. */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
): string {
  const esc = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(",")).join("\n");
  return body ? `${head}\n${body}` : head;
}
