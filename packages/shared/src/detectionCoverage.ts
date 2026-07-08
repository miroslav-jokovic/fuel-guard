/**
 * Detection COVERAGE — the honesty layer that bounds recall. Precision tells you how often a raised
 * case was real; coverage tells you how much of the data the system could actually SEE. A fill with no
 * telematics corroboration can still be scored on internal physics, but it can't be cross-checked
 * against where the truck was or its true odometer — so a fleet with thin coverage has blind spots, and
 * "we didn't flag it" means less there. This surfaces exactly where those blind spots are, per truck.
 *
 * Pure + testable; the web pages fuel rows and passes them here.
 */

export interface CoverageInput {
  vehicle_id: string | null;
  driver_id: string | null;
  fueled_at: string;
  tank_type?: "tractor" | "reefer" | null;
  /** Telematics recovered a fueling moment for this fill (recon ran and matched something). */
  samsara_recon_at: string | null;
  /** Fueling-time odometer available (gated) → the odometer cross-check was possible. */
  samsara_odometer: number | string | null;
  /** gps_confirmed | in_state | mismatch | unknown | null. Anything but unknown/null = location judgeable. */
  samsara_location_confidence: string | null;
  /** tank_confirmed | stop_estimated | reported | date_only | null. */
  fueling_time_basis: string | null;
}

export type TimeBasisKey = "tank_confirmed" | "stop_estimated" | "reported" | "date_only" | "none";

export interface CoverageTruckRow {
  vehicleId: string;
  fills: number;
  /** Share of this truck's fills matched to a driver (the vehicle is known by grouping). 0–100. */
  attributedPct: number;
  reconciledPct: number; // telematics matched
  odometerPct: number; // fueling-time odometer available
  locationPct: number; // location judgeable (not unknown)
  /** Fills with NO telematics corroboration — card-only, invisible to cross-checks. */
  blindFills: number;
  blindPct: number;
}

export interface CoverageSummary {
  totalFills: number;
  /** Fills matched to BOTH a vehicle and a driver. */
  attributedPct: number;
  unattributed: number; // missing a vehicle or a driver
  reconciledPct: number;
  odometerPct: number;
  locationPct: number;
  blindFills: number;
  blindPct: number;
  timeBasis: Record<TimeBasisKey, number>;
  /** Per-truck coverage, worst (most blind) first. Unattributed fills aren't per-truck. */
  perTruck: CoverageTruckRow[];
  /** Most recent telematics-reconciled fill (freshness proxy), or null. */
  lastReconciledAt: string | null;
  totalTrucks: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (num: number, den: number) => (den > 0 ? round1((num / den) * 100) : 0);

/** Location is judgeable when Samsara resolved SOMETHING (confirmed, in-state, or an actual mismatch). */
const LOCATION_JUDGEABLE = new Set(["gps_confirmed", "in_state", "mismatch"]);

function timeBasisKey(b: string | null | undefined): TimeBasisKey {
  return b === "tank_confirmed" || b === "stop_estimated" || b === "reported" || b === "date_only" ? b : "none";
}

interface TruckAcc {
  fills: number;
  withDriver: number;
  reconciled: number;
  odometer: number;
  location: number;
}

export function computeDetectionCoverage(rows: CoverageInput[]): CoverageSummary {
  const byTruck = new Map<string, TruckAcc>();
  const timeBasis: Record<TimeBasisKey, number> = { tank_confirmed: 0, stop_estimated: 0, reported: 0, date_only: 0, none: 0 };

  let attributed = 0;
  let unattributed = 0;
  let reconciled = 0;
  let odometer = 0;
  let location = 0;
  let lastReconMs: number | null = null;

  for (const r of rows) {
    const hasRecon = r.samsara_recon_at != null;
    const hasOdo = r.samsara_odometer != null;
    const hasLoc = r.samsara_location_confidence != null && LOCATION_JUDGEABLE.has(r.samsara_location_confidence);
    const isAttributed = r.vehicle_id != null && r.driver_id != null;

    if (isAttributed) attributed += 1;
    else unattributed += 1;
    if (hasRecon) {
      reconciled += 1;
      const t = new Date(r.samsara_recon_at as string).getTime();
      if (Number.isFinite(t) && (lastReconMs == null || t > lastReconMs)) lastReconMs = t;
    }
    if (hasOdo) odometer += 1;
    if (hasLoc) location += 1;
    timeBasis[timeBasisKey(r.fueling_time_basis)] += 1;

    if (r.vehicle_id != null) {
      const cur = byTruck.get(r.vehicle_id) ?? { fills: 0, withDriver: 0, reconciled: 0, odometer: 0, location: 0 };
      cur.fills += 1;
      if (r.driver_id != null) cur.withDriver += 1;
      if (hasRecon) cur.reconciled += 1;
      if (hasOdo) cur.odometer += 1;
      if (hasLoc) cur.location += 1;
      byTruck.set(r.vehicle_id, cur);
    }
  }

  const total = rows.length;
  const perTruck: CoverageTruckRow[] = [...byTruck.entries()]
    .map(([vehicleId, v]) => {
      const blindFills = v.fills - v.reconciled;
      return {
        vehicleId,
        fills: v.fills,
        attributedPct: pct(v.withDriver, v.fills),
        reconciledPct: pct(v.reconciled, v.fills),
        odometerPct: pct(v.odometer, v.fills),
        locationPct: pct(v.location, v.fills),
        blindFills,
        blindPct: pct(blindFills, v.fills),
      };
    })
    // Worst first: most blind fills, then highest blind share, then most fills.
    .sort((a, b) => b.blindFills - a.blindFills || b.blindPct - a.blindPct || b.fills - a.fills);

  return {
    totalFills: total,
    attributedPct: pct(attributed, total),
    unattributed,
    reconciledPct: pct(reconciled, total),
    odometerPct: pct(odometer, total),
    locationPct: pct(location, total),
    blindFills: total - reconciled,
    blindPct: pct(total - reconciled, total),
    timeBasis,
    perTruck,
    lastReconciledAt: lastReconMs != null ? new Date(lastReconMs).toISOString() : null,
    totalTrucks: perTruck.length,
  };
}
