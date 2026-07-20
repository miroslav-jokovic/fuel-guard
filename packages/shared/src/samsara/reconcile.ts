/** Location-confidence, odometer reconciliation, and tank-fill reconciliation. */
import { haversineMiles } from "../ai.js";
import type { SamsaraSample, RawVehicleStats } from "./core.js";
import type { FuelingStopMatch } from "./stops.js";

export type LocationConfidence = "gps_confirmed" | "in_state" | "mismatch" | "unknown";

/** Smallest great-circle distance (miles) from any GPS sample to a point; null if no sample has coords. */
export function minSampleDistanceMiles(
  samples: SamsaraSample[],
  lat: number,
  lng: number,
): number | null {
  let min: number | null = null;
  for (const s of samples) {
    if (s.lat == null || s.lng == null) continue;
    const d = haversineMiles(s.lat, s.lng, lat, lng);
    if (min == null || d < min) min = d;
  }
  return min == null ? null : Math.round(min * 10) / 10;
}

/**
 * Combine the full-day state presence (from matchFuelingStop) with an optional GPS-proximity check to
 * the geocoded station into a single confidence + boolean. Proximity, when available, is the most
 * precise signal and can CONFIRM a fill the state check left as false/unknown — but a failed/absent
 * proximity never invents a mismatch on its own (the state check governs that). Result:
 *  - matched=true  for gps_confirmed and in_state
 *  - matched=false for mismatch
 *  - matched=null  for unknown
 */
export function resolveLocationConfidence(
  stop: Pick<FuelingStopMatch, "locationMatched">,
  proximityMiles: number | null,
  proxThresholdMiles: number,
  veto?: { nearMiles: number | null; minMismatchMiles: number },
): { confidence: LocationConfidence; matched: boolean | null } {
  if (proximityMiles != null && proximityMiles <= proxThresholdMiles) {
    return { confidence: "gps_confirmed", matched: true };
  }
  if (stop.locationMatched === true) return { confidence: "in_state", matched: true };
  if (stop.locationMatched === false) {
    // We may ONLY accuse "the card was used where the truck was not" when we can measure how close the
    // truck came to the station — i.e. we have a geocode. Without one (uncached station, geocoding off, or
    // a bulk backfill that skipped the live lookup) `nearMiles` is null and we CANNOT rule out a border
    // crossing or a reverse-geo parse artifact, so we must NOT flag. Downgrade to unknown.
    if (!veto || veto.nearMiles == null) return { confidence: "unknown", matched: null };
    // VETO a would-be mismatch when the truck's GPS came within a generous radius of the claimed station
    // (even a coarse city-centroid geocode) — that differing state token is almost always a border/parse
    // artifact, not theft.
    if (veto.nearMiles < veto.minMismatchMiles) return { confidence: "unknown", matched: null };
    return { confidence: "mismatch", matched: false };
  }
  return { confidence: "unknown", matched: null };
}

export interface OdometerReconciliation {
  mismatch: boolean;
  diffMiles: number;
}

/** The ±tolerance odometer check: EFS pump odometer vs Samsara odometer at the fueling moment. */
export function reconcileOdometerMiles(
  efsMiles: number | null,
  samsaraMiles: number | null,
  toleranceMiles: number,
): OdometerReconciliation | null {
  if (efsMiles == null || samsaraMiles == null) return null;
  const diff = Math.abs(efsMiles - samsaraMiles);
  return { mismatch: diff > toleranceMiles, diffMiles: Math.round(diff * 10) / 10 };
}

// ---------------------------------------------------------------------------
// Tank-fill reconciliation (docs/10 §8 — soft / advisory signal)
//
// Samsara's OBD tank-level reading (`fuelPercents`) is COARSE and NOISY, so this is a low-confidence
// corroborator, never a hard alarm: if the card billed N gallons but the tank barely rose, less fuel
// went into the truck than was paid for (siphoning / fill into a container). We only ever flag a
// SHORTFALL, and only when it clears a deliberately generous tolerance.
// ---------------------------------------------------------------------------

export interface TankReading {
  time: string; // ISO
  percent: number; // 0..100
}

/** Parse the vehicle's fuel-percentage series from a stats-history response. */
export function parseFuelPercents(vehicle: RawVehicleStats): TankReading[] {
  return (vehicle.fuelPercents ?? [])
    .filter((p) => p.time && p.value != null && p.value >= 0 && p.value <= 100)
    .map((p) => ({ time: p.time!, percent: p.value! }));
}

/**
 * Tank percentage nearest to `iso`, restricted to one side and within `windowMin` minutes.
 * side="before" → latest reading at/just before the moment; side="after" → earliest at/just after.
 */
export function tankPercentNear(
  readings: TankReading[],
  iso: string,
  side: "before" | "after",
  windowMin = 90,
): TankReading | null {
  const t = new Date(iso).getTime();
  const windowMs = windowMin * 60_000;
  let best: TankReading | null = null;
  let bestDelta = Infinity;
  for (const r of readings) {
    const rt = new Date(r.time).getTime();
    const delta = side === "before" ? t - rt : rt - t;
    if (delta < 0 || delta > windowMs) continue; // wrong side or too far
    if (delta < bestDelta) {
      bestDelta = delta;
      best = r;
    }
  }
  return best;
}

export interface TankFillReconciliation {
  /** Gallons the tank actually rose across the fueling moment (observed). */
  observedRiseGal: number;
  /** Gallons short of what was billed (billed − observed), clamped at 0. */
  shortGal: number;
  /** True when the shortfall clears the tolerance → advisory flag. */
  short: boolean;
  /** The generous tolerance used (gallons). */
  toleranceGal: number;
}

/**
 * Compare billed gallons against the observed tank rise. Returns null when we can't measure it
 * (no capacity, or missing a before/after reading) — the deterministic rules still run without it.
 * Tolerance is deliberately generous (default: the larger of 15 gal or 30% of the bill) because the
 * sensor is coarse; this stays a low-confidence "worth a look" signal, not proof.
 */
export function reconcileTankFill(args: {
  gallonsBilled: number | null;
  pctBefore: number | null;
  pctAfter: number | null;
  tankCapacityGal: number | null;
  toleranceGal?: number;
  tolerancePctOfBill?: number;
}): TankFillReconciliation | null {
  const { gallonsBilled, pctBefore, pctAfter, tankCapacityGal } = args;
  if (
    gallonsBilled == null ||
    gallonsBilled <= 0 ||
    pctBefore == null ||
    pctAfter == null ||
    tankCapacityGal == null ||
    tankCapacityGal <= 0
  )
    return null;

  const observedRiseGal = Math.round(((pctAfter - pctBefore) / 100) * tankCapacityGal * 10) / 10;
  const fracTol = args.tolerancePctOfBill ?? 0.3;
  const toleranceGal =
    Math.round(Math.max(args.toleranceGal ?? 15, gallonsBilled * fracTol) * 10) / 10;
  const shortGal = Math.round(Math.max(0, gallonsBilled - observedRiseGal) * 10) / 10;
  return { observedRiseGal, shortGal, short: shortGal > toleranceGal, toleranceGal };
}

// ---------------------------------------------------------------------------
// Fleet vehicle sync (Samsara GET /fleet/vehicles)
//
// `/fleet/vehicles` returns POWERED vehicles only (trucks/tractors) — trailers and other unpowered
// assets live in the separate /assets API, so this endpoint never pulls trailers. We map each Samsara
// vehicle's identity into our `vehicles` table and, crucially, capture its Samsara `id` as
// `samsara_vehicle_id` so telematics reconciliation links up automatically.
// ---------------------------------------------------------------------------

