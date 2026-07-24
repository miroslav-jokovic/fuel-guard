/**
 * WP4 — chronic odometer-hygiene escalation (the "leave it blank" dodge). A single missing/stale
 * odometer is a data gap (suppressed, weight 0). But a driver who ROUTINELY skips or repeats the
 * odometer disables the entire consumption chain for their fills — which is exactly what someone
 * hiding fuel use would do — so the PATTERN must reach a human. Pure aggregation; the digest renders
 * it per driver with names resolved by the caller.
 */

export interface OdometerFillRow {
  vehicle_id: string | null;
  driver_id: string | null;
  odometer: number | null;
  fueled_at: string; // ISO
  tank_type?: string | null;
}

export interface OdometerHygieneCluster {
  driverId: string;
  fills: number;
  missing: number;
  stale: number;
  /** (missing + stale) / fills, 0–1. */
  badShare: number;
}

export interface OdometerHygiene {
  /** Tractor fills in the window with a blank odometer. */
  missingTotal: number;
  /** Tractor fills whose odometer repeats the vehicle's previous fill's value. */
  staleTotal: number;
  /** Drivers with ≥ minBad bad entries AND ≥ minShare of their fills bad — worst first. */
  clusters: OdometerHygieneCluster[];
}

/**
 * Stale detection is per-VEHICLE (consecutive fills with an identical entered odometer), then bad
 * entries are attributed to the fill's driver. Reefer (ULSR) fills are excluded — no odometer is
 * expected at a reefer pump. Escalation needs BOTH an absolute floor and a share: an occasional slip
 * never escalates; a habit does.
 */
export function computeOdometerHygiene(rows: OdometerFillRow[], opts: { minBad?: number; minShare?: number } = {}): OdometerHygiene {
  const minBad = opts.minBad ?? 3;
  const minShare = opts.minShare ?? 0.5;
  const tractor = rows.filter((r) => (r.tank_type ?? "tractor") !== "reefer");

  // Per-vehicle chronological pass to mark stale entries.
  const byVehicle = new Map<string, OdometerFillRow[]>();
  for (const r of tractor) {
    if (!r.vehicle_id) continue;
    (byVehicle.get(r.vehicle_id) ?? byVehicle.set(r.vehicle_id, []).get(r.vehicle_id)!).push(r);
  }
  const stale = new Set<OdometerFillRow>();
  for (const fills of byVehicle.values()) {
    const sorted = fills.slice().sort((a, b) => a.fueled_at.localeCompare(b.fueled_at));
    let prevOdo: number | null = null;
    for (const f of sorted) {
      if (f.odometer != null) {
        if (prevOdo != null && f.odometer === prevOdo) stale.add(f);
        prevOdo = f.odometer;
      }
    }
  }

  let missingTotal = 0;
  let staleTotal = 0;
  const byDriver = new Map<string, { fills: number; missing: number; stale: number }>();
  for (const r of tractor) {
    const isMissing = r.odometer == null;
    const isStale = stale.has(r);
    if (isMissing) missingTotal += 1;
    if (isStale) staleTotal += 1;
    if (!r.driver_id) continue;
    const cur = byDriver.get(r.driver_id) ?? { fills: 0, missing: 0, stale: 0 };
    cur.fills += 1;
    if (isMissing) cur.missing += 1;
    if (isStale) cur.stale += 1;
    byDriver.set(r.driver_id, cur);
  }

  const clusters: OdometerHygieneCluster[] = [...byDriver.entries()]
    .map(([driverId, c]) => ({ driverId, fills: c.fills, missing: c.missing, stale: c.stale, badShare: c.fills > 0 ? (c.missing + c.stale) / c.fills : 0 }))
    .filter((c) => c.missing + c.stale >= minBad && c.badShare >= minShare)
    .sort((a, b) => b.missing + b.stale - (a.missing + a.stale));

  return { missingTotal, staleTotal, clusters };
}
