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
}

export interface ReeferCoverageRow {
  vehicleId: string;
  tractorGal: number;
  reeferGal: number;
  /** Reefer share of this truck's fuel: reefer / (reefer + tractor), as a percent (0–100). */
  reeferSharePct: number;
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
export function computeReeferCoverage(rows: ReeferCoverageInput[], nowMs: number = Date.now()): ReeferCoverageSummary {
  const byTruck = new Map<string, { tractorGal: number; reeferGal: number; lastReeferMs: number | null }>();

  for (const r of rows) {
    if (!r.vehicle_id) continue;
    const gal = Number(r.gallons) || 0;
    const cur = byTruck.get(r.vehicle_id) ?? { tractorGal: 0, reeferGal: 0, lastReeferMs: null };
    if (r.tank_type === "reefer") {
      cur.reeferGal += gal;
      const t = new Date(r.fueled_at).getTime();
      if (Number.isFinite(t) && (cur.lastReeferMs == null || t > cur.lastReeferMs)) cur.lastReeferMs = t;
    } else {
      cur.tractorGal += gal;
    }
    byTruck.set(r.vehicle_id, cur);
  }

  const perTruck: ReeferCoverageRow[] = [...byTruck.entries()].map(([vehicleId, v]) => {
    const total = v.tractorGal + v.reeferGal;
    const reeferActive = v.reeferGal > 0;
    return {
      vehicleId,
      tractorGal: round1(v.tractorGal),
      reeferGal: round1(v.reeferGal),
      reeferSharePct: total > 0 ? round1((v.reeferGal / total) * 100) : 0,
      lastReeferAt: v.lastReeferMs != null ? new Date(v.lastReeferMs).toISOString() : null,
      daysSinceReefer: v.lastReeferMs != null ? Math.max(0, Math.floor((nowMs - v.lastReeferMs) / 86_400_000)) : null,
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
