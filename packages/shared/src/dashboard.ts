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
  value: number;
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
const day = (iso: string) => iso.slice(0, 10);

function emptySeverity(): Record<AnomalySeverity, number> {
  return { low: 0, medium: 0, high: 0, critical: 0 };
}

/** Aggregate transactions + anomalies into the executive dashboard view. */
export function aggregateDashboard(
  transactions: FuelTransaction[],
  anomalies: Anomaly[],
  vehicles: Pick<Vehicle, "id" | "unit_number">[],
  drivers: Pick<Driver, "id" | "full_name">[],
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

    const d = day(t.fueled_at);
    spendByDay.set(d, (spendByDay.get(d) ?? 0) + cost);

    if (t.computed_mpg != null && gallons > 0) {
      const mpg = Number(t.computed_mpg);
      mpgWeighted += mpg * gallons;
      mpgGallons += gallons;
      const cur = mpgGalByDay.get(d) ?? { mpgGal: 0, gal: 0 };
      cur.mpgGal += mpg * gallons;
      cur.gal += gallons;
      mpgGalByDay.set(d, cur);
    }
  }

  const spendTrend: TrendPoint[] = [...spendByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value: round2(value) }));

  const mpgTrend: TrendPoint[] = [...mpgGalByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { mpgGal, gal }]) => ({ date, value: gal > 0 ? round2(mpgGal / gal) : 0 }));

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
