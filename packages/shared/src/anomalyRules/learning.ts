/** Per-truck learners: odometer offset, tank-sensor reliability, robust window miles, station offset. */
import { median } from "./helpers.js";

export interface OdometerOffsetResult {
  /** Learned constant (entered − samsara), rounded to whole miles. */
  offset: number;
  /** How many (entered, samsara) pairs backed the estimate. */
  samples: number;
}

/**
 * Learn a per-vehicle odometer offset (dash − Samsara) from recent fills that have BOTH readings. Uses the
 * median (robust to the occasional bad entry) over the most recent `window` pairs, and only returns a value
 * when there are ≥ `minSamples` pairs AND they cluster tightly (a solid majority within `clusterToleranceMiles`
 * of the median). Otherwise returns null — meaning "not enough evidence", leave the offset at 0.
 */
export function learnOdometerOffset(
  pairs: { entered: number; samsara: number }[],
  opts: { window?: number; clusterToleranceMiles?: number; minSamples?: number } = {},
): OdometerOffsetResult | null {
  const window = opts.window ?? 10;
  const tol = opts.clusterToleranceMiles ?? 3;
  const minSamples = opts.minSamples ?? 3;
  const diffs = pairs
    .filter((p) => Number.isFinite(p.entered) && Number.isFinite(p.samsara))
    .slice(-window)
    .map((p) => p.entered - p.samsara);
  if (diffs.length < minSamples) return null;
  const med = median(diffs);
  const within = diffs.filter((d) => Math.abs(d - med) <= tol).length;
  // Require both an absolute floor of clustered samples and a clustered majority.
  if (within < minSamples || within / diffs.length < 0.6) return null;
  return { offset: Math.round(med), samples: diffs.length };
}

export interface TankSensorReliabilityResult {
  /** True when the sensor's observed rise reflects the whole billed fill (ratio ≈1, single/equalized tank). */
  reliable: boolean;
  /** Median observed-rise ÷ billed ratio over the sampled fills (for transparency/UI). */
  ratio: number;
  samples: number;
}

/**
 * Learn whether a truck's Samsara fuel-level sensor reflects the WHOLE billed fill. For each recent fill with
 * both an observed tank rise and billed gallons, take ratio = observedRise / billed. A single-tank (or
 * crossover-equalized) truck reconciles NEAR 1.0 on almost every fill; a dual-independent-tank truck reads
 * only one tank so the ratio runs ~0.5, or swings wildly (both-tank vs one-tank fills, non-linear sensor).
 *
 * Reliable=true ONLY when a STRONG MAJORITY of fills land within `band` of 1.0 — the PHYSICAL truth that
 * observed rise ≈ gallons bought. The band is anchored on 1.0, NOT on the median, because a spread/bimodal
 * distribution can have a median that happens to sit in-band while the individual fills swing (real case:
 * unit 706, ratios 0.66–1.21, median 1.14 — it must NOT be called reliable). Ratios materially above 1.0 are
 * physically impossible (can't rise more than you bought → overstated capacity / non-linear sensor) and fall
 * OUTSIDE the band, so they count against reliability. Returns reliable=false when the majority don't
 * reconcile, or null when there isn't enough history yet (caller leaves the per-fill tank rules suppressed).
 *
 * The evidence floor is `minSamples = 8` (audit A2.1/A2.2). At the old floor of 4, a dual-tank truck that
 * happened to log a few single-tank fills early was prematurely marked reliable, which then ENABLED the
 * weight-90 tank_space_exceeded rule and false-fired on the next both-tank fill. Requiring 8 fills both demands
 * real evidence AND widens the window enough that a genuine dual-tank truck's occasional both-tank fill lands
 * in-sample and trips the short-fill guard below → it stays unreliable. Cold-start (< 8 fills) returns null, so
 * the per-fill tank rules stay suppressed until there's enough history — the SAFE direction (fewer false alarms;
 * cumulative_overfuel + exceeds_tank_capacity still catch gross fraud regardless of this flag).
 */
export function learnTankSensorReliability(
  pairs: { observedRiseGal: number; billedGallons: number }[],
  opts: { window?: number; minSamples?: number; band?: number; minFraction?: number; shortRatio?: number; maxShortFraction?: number } = {},
): TankSensorReliabilityResult | null {
  const window = opts.window ?? 12;
  const minSamples = opts.minSamples ?? 8;
  const band = opts.band ?? 0.15; // ±15% around 1.0 absorbs sensor coarseness
  const minFraction = opts.minFraction ?? 0.7; // ≥70% of fills must reconcile near 1.0
  const shortRatio = opts.shortRatio ?? 0.8; // observed rise below this share of billed = a "short" fill
  const maxShortFraction = opts.maxShortFraction ?? 0.12; // too many short fills ⇒ dual-tank both-fills
  const ratios = pairs
    .filter((p) => Number.isFinite(p.observedRiseGal) && Number.isFinite(p.billedGallons) && p.billedGallons > 0)
    .slice(-window)
    .map((p) => p.observedRiseGal / p.billedGallons);
  if (ratios.length < minSamples) return null;
  const near1 = ratios.filter((r) => Math.abs(r - 1) <= band).length;
  // A DUAL-tank truck whose driver USUALLY fills one tank (ratio ~1) but sometimes fills BOTH (the sensor sees
  // only one tank → observed rise ≪ billed) has a near-1 MEDIAN yet a tail of "short" fills. Those both-tank
  // fills false-fire tank_space_exceeded, so a truck with more than a small fraction of short fills is NOT
  // reliable for the per-fill space/volume checks (cumulative_overfuel + exceeds_tank_capacity still apply).
  const short = ratios.filter((r) => r < shortRatio).length;
  const reliable = near1 / ratios.length >= minFraction && short / ratios.length <= maxShortFraction;
  return { reliable, ratio: Math.round(median(ratios) * 1000) / 1000, samples: ratios.length };
}

export interface WindowOdoRow {
  /** Driver-entered odometer on the fill (noisy — typos, missed/duplicate entries). */
  enteredOdometer: number | null;
  /** Samsara fueling-time odometer (single-source + despiked upstream). */
  samsaraOdometer: number | null;
  /** Provenance of samsaraOdometer: 'obd' is a single consistent baseline; 'gps'/'reconstructed' are not. */
  samsaraSource: string | null;
}

export interface WindowMilesResult {
  /** Miles driven across the window, or null when no source is trustworthy (→ cumulative_overfuel suppressed). */
  miles: number | null;
  basis: "samsara_obd" | "entered" | "none";
}

/**
 * Robust miles-driven over the cumulative window. The over-fuel ceiling is only as trustworthy as this number,
 * and computing it from the DRIVER-ENTERED odometer span lets one typo / missed / duplicate entry collapse the
 * miles and false-fire cumulative_overfuel. So: prefer the clean OBD Samsara odometer span (single, despiked
 * baseline); fall back to the entered span ONLY when it doesn't regress (a later reading below an earlier one
 * signals a bad entry); otherwise return null so the rule stays silent (data-quality, not fraud). Rows must be
 * ordered OLDEST→NEWEST.
 */
export function robustWindowMiles(rowsOldestFirst: WindowOdoRow[]): WindowMilesResult {
  const obd = rowsOldestFirst
    .filter((r) => r.samsaraSource === "obd" && r.samsaraOdometer != null && Number.isFinite(r.samsaraOdometer))
    .map((r) => r.samsaraOdometer as number);
  if (obd.length >= 2) return { miles: Math.max(...obd) - Math.min(...obd), basis: "samsara_obd" };

  const entered = rowsOldestFirst.map((r) => r.enteredOdometer).filter((x): x is number => x != null && Number.isFinite(x));
  if (entered.length >= 2) {
    const monotonic = entered.every((v, i) => i === 0 || v >= entered[i - 1]! - 1); // no backward jump (±1 float tol)
    if (monotonic) return { miles: Math.max(...entered) - Math.min(...entered), basis: "entered" };
  }
  return { miles: null, basis: "none" };
}

/**
 * Detect a WRONG STATION COORDINATE from the pattern of how close a truck came to a station across many fills.
 * WEX documents this exact pitfall: when a station's stored/geocoded coordinate is off (city-centroid, chain
 * HQ, bad pin), EVERY fill there shows the truck a CONSISTENT distance away — a data error, not theft. Genuine
 * "card used where the truck wasn't" varies trip to trip. So if the per-fill nearest-distances to a station
 * cluster tightly at a materially non-zero value across ≥ minSamples fills, treat it as a systematic offset
 * (route the mismatch to data-quality / suppress) rather than a theft signal. Pure.
 */
export function isSystematicStationOffset(
  distancesMiles: number[],
  opts: { minSamples?: number; minOffsetMiles?: number; maxRelSpread?: number; window?: number } = {},
): boolean {
  const minSamples = opts.minSamples ?? 4;
  const minOffset = opts.minOffsetMiles ?? 1;
  const maxRelSpread = opts.maxRelSpread ?? 0.25;
  const window = opts.window ?? 20;
  const vals = distancesMiles.filter((d) => Number.isFinite(d) && d >= 0).slice(-window);
  if (vals.length < minSamples) return false;
  const med = median(vals);
  if (med < minOffset) return false; // essentially at the station → no offset to explain
  // A strong majority must sit within a tight relative band of the median (tight cluster = fixed pin error).
  const within = vals.filter((d) => Math.abs(d - med) <= maxRelSpread * med).length;
  return within / vals.length >= 0.8;
}

