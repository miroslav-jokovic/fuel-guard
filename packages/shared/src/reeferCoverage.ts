/**
 * Reefer-coverage analytic (read-only, no detection). Aggregates fuel events per truck into a picture of
 * how much reefer (ULSR) vs tractor (ULSD) fuel it bought and how recently — the calibration data behind
 * a future reefer_not_fueled / reefer_ratio rule, and a human-review aid TODAY. Pure + testable; the web
 * fetches org-scoped rows and passes them here. Deliberately NOT a rule: it never raises an anomaly.
 */

export interface ReeferCoverageInput {
  vehicle_id: string | null;
  tank_type?: "tractor" | "reefer" | null;
  gallons: number | string;
  fueled_at: string;
  /** Line total ($). Optional — used to sum reefer spend per truck. */
  total_cost?: number | string | null;
  /** Matched driver id (null when unattributed). Optional — used to surface the primary reefer driver. */
  driver_id?: string | null;
}

export interface ReeferCoverageRow {
  vehicleId: string;
  tractorGal: number;
  reeferGal: number;
  /** Reefer share of this truck's fuel: reefer / (reefer + tractor), as a percent (0–100). */
  reeferSharePct: number;
  /** Number of reefer (ULSR) fills in the window. */
  reeferFills: number;
  /** Average gallons per reefer fill (reeferGal / reeferFills), or 0 when no fills. */
  avgGalPerFill: number;
  /** Total reefer spend ($) in the window. */
  reeferSpend: number;
  /** Average whole days between consecutive reefer fills, or null with fewer than 2 fills. */
  avgCadenceDays: number | null;
  /** Driver id responsible for the most reefer fills (the truck's usual reefer driver), or null. */
  primaryDriverId: string | null;
  /** Most recent reefer fill (ISO), or null if none in the window. */
  lastReeferAt: string | null;
  /** Whole days since the last reefer fill, or null if never. */
  daysSinceReefer: number | null;
  /** true when the truck bought ANY reefer fuel in the window (data-driven "runs a reefer"). */
  reeferActive: boolean;
}

export interface ReeferCoverageSummary {
  perTruck: ReeferCoverageRow[];
  /** Median reefer share across reefer-active trucks — the fleet baseline. null if none. */
  fleetMedianSharePct: number | null;
  reeferActiveCount: number;
  totalTrucks: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Aggregate fuel rows into per-truck reefer coverage. `nowMs` anchors the days-since calculation (inject
 * for deterministic tests). Rows with no vehicle are ignored (unattributed can't be per-truck).
 */
interface TruckAcc {
  tractorGal: number;
  reeferGal: number;
  reeferSpend: number;
  reeferFillMs: number[]; // one entry per reefer fill (for count + cadence + last)
  driverCounts: Map<string, number>; // reefer fills per driver id
}

export function computeReeferCoverage(rows: ReeferCoverageInput[], nowMs: number = Date.now()): ReeferCoverageSummary {
  const byTruck = new Map<string, TruckAcc>();

  for (const r of rows) {
    if (!r.vehicle_id) continue;
    const gal = Number(r.gallons) || 0;
    const cur =
      byTruck.get(r.vehicle_id) ??
      ({ tractorGal: 0, reeferGal: 0, reeferSpend: 0, reeferFillMs: [], driverCounts: new Map() } as TruckAcc);
    if (r.tank_type === "reefer") {
      cur.reeferGal += gal;
      cur.reeferSpend += Number(r.total_cost) || 0;
      const t = new Date(r.fueled_at).getTime();
      if (Number.isFinite(t)) cur.reeferFillMs.push(t);
      if (r.driver_id) cur.driverCounts.set(r.driver_id, (cur.driverCounts.get(r.driver_id) ?? 0) + 1);
    } else {
      cur.tractorGal += gal;
    }
    byTruck.set(r.vehicle_id, cur);
  }

  const perTruck: ReeferCoverageRow[] = [...byTruck.entries()].map(([vehicleId, v]) => {
    const total = v.tractorGal + v.reeferGal;
    const reeferActive = v.reeferGal > 0;
    const fills = v.reeferFillMs.length;
    const sortedMs = [...v.reeferFillMs].sort((a, b) => a - b);
    const lastReeferMs = fills > 0 ? sortedMs[fills - 1]! : null;
    // Average cadence = span between first and last fill divided by the number of gaps (fills - 1).
    const avgCadenceDays =
      fills >= 2 ? Math.round((sortedMs[fills - 1]! - sortedMs[0]!) / (fills - 1) / 86_400_000) : null;
    // Primary driver = the id with the most reefer fills (ties resolved by first-seen max).
    let primaryDriverId: string | null = null;
    let best = 0;
    for (const [id, c] of v.driverCounts) if (c > best) ((best = c), (primaryDriverId = id));
    return {
      vehicleId,
      tractorGal: round1(v.tractorGal),
      reeferGal: round1(v.reeferGal),
      reeferSharePct: total > 0 ? round1((v.reeferGal / total) * 100) : 0,
      reeferFills: fills,
      avgGalPerFill: fills > 0 ? round1(v.reeferGal / fills) : 0,
      reeferSpend: Math.round(v.reeferSpend * 100) / 100,
      avgCadenceDays,
      primaryDriverId,
      lastReeferAt: lastReeferMs != null ? new Date(lastReeferMs).toISOString() : null,
      daysSinceReefer: lastReeferMs != null ? Math.max(0, Math.floor((nowMs - lastReeferMs) / 86_400_000)) : null,
      reeferActive,
    };
  });

  const activeShares = perTruck.filter((t) => t.reeferActive).map((t) => t.reeferSharePct);
  const med = median(activeShares);

  return {
    perTruck: perTruck.sort((a, b) => b.reeferGal - a.reeferGal),
    fleetMedianSharePct: med != null ? round1(med) : null,
    reeferActiveCount: activeShares.length,
    totalTrucks: perTruck.length,
  };
}
