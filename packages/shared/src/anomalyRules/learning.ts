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
  /** WP-BEH: standard deviation of the observed/billed ratios — THIS truck's measured sensor noise. A
   *  tight sigma (clean single-tank sensor) lets tank_fill_short run a much tighter tolerance than the
   *  blanket 30%; a loose sigma keeps the wide band. Meaningful mainly when reliable=true. */
  ratioSigma: number;
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
  opts: {
    window?: number;
    minSamples?: number;
    band?: number;
    minFraction?: number;
    shortRatio?: number;
    maxShortFraction?: number;
  } = {},
): TankSensorReliabilityResult | null {
  const window = opts.window ?? 12;
  const minSamples = opts.minSamples ?? 8;
  const band = opts.band ?? 0.15; // ±15% around 1.0 absorbs sensor coarseness
  const minFraction = opts.minFraction ?? 0.7; // ≥70% of fills must reconcile near 1.0
  const shortRatio = opts.shortRatio ?? 0.8; // observed rise below this share of billed = a "short" fill
  const maxShortFraction = opts.maxShortFraction ?? 0.12; // too many short fills ⇒ dual-tank both-fills
  const ratios = pairs
    .filter(
      (p) =>
        Number.isFinite(p.observedRiseGal) &&
        Number.isFinite(p.billedGallons) &&
        p.billedGallons > 0,
    )
    .slice(-window)
    .map((p) => p.observedRiseGal / p.billedGallons);
  if (ratios.length < minSamples) return null;
  const near1 = ratios.filter((r) => Math.abs(r - 1) <= band).length;
  // A DUAL-tank truck whose driver USUALLY fills one tank (ratio ~1) but sometimes fills BOTH (the sensor sees
  // only one tank → observed rise ≪ billed) has a near-1 MEDIAN yet a tail of "short" fills. Those both-tank
  // fills false-fire tank_space_exceeded, so a truck with more than a small fraction of short fills is NOT
  // reliable for the per-fill space/volume checks (cumulative_overfuel + exceeds_tank_capacity still apply).
  const short = ratios.filter((r) => r < shortRatio).length;
  const reliable =
    near1 / ratios.length >= minFraction && short / ratios.length <= maxShortFraction;
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const sigma = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) * (b - mean), 0) / ratios.length);
  return {
    reliable,
    ratio: Math.round(median(ratios) * 1000) / 1000,
    samples: ratios.length,
    ratioSigma: Math.round(sigma * 1000) / 1000,
  };
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
 * The odometer must ADVANCE by more than this many miles across the window for the span to count as
 * real distance. Matches the ±1 float/entry-noise tolerance used in the monotonic check below: a span
 * at or under it is "the odometer did not move", which is not a usable distance.
 */
const MIN_WINDOW_ADVANCE_MI = 1;

/**
 * Robust miles-driven over the cumulative window. The over-fuel ceiling is only as trustworthy as this number,
 * and computing it from the DRIVER-ENTERED odometer span lets one typo / missed / duplicate entry collapse the
 * miles and false-fire cumulative_overfuel. So: prefer the clean OBD Samsara odometer span (single, despiked
 * baseline); fall back to the entered span ONLY when it doesn't regress (a later reading below an earlier one
 * signals a bad entry); otherwise return null so the rule stays silent (data-quality, not fraud). Rows must be
 * ordered OLDEST→NEWEST.
 *
 * A NON-ADVANCING span (the same odometer echoed across fills — a stale/placeholder reading like a
 * constant "736", or a truck that genuinely didn't move between two fuel purchases) is treated as NO
 * usable distance → null, NOT as 0 miles. This is the single most important guard here: a 0-mile span
 * makes `burnable` 0, so EVERY real purchase clears the over-fuel ceiling and false-fires. It also
 * makes this function consistent with `milesSinceLast`, which already returns null unless the odometer
 * strictly advances (`d > 0`). 0-mile windows are additionally ambiguous even with a good odometer — a
 * yard top-off is a legitimate buy-fuel-without-driving — so suppression is the precision-first choice;
 * genuine park-and-hoard is caught by the tank-space / same-station rules, not by this ratio.
 *
 * ── A SOURCE MAY ONLY ANSWER FOR A WINDOW WHOSE ENDS IT COVERS (2026-09-05) ─────────────────────
 * The rule above — "prefer OBD whenever two readings exist" — measured the OBD SUBSET's span and
 * reported it as the WINDOW's. Where a fill in the middle of the window carries no OBD reading that is
 * harmless; where the OLDEST fill does not, everything the truck drove before the first OBD reading
 * disappears, and no total contradicts it.
 *
 * **Measured on production 2026-09-05, and this is not a rounding matter.** Across the 64 fills whose
 * `cumulative_overfuel` case a human had already dismissed as a false positive, this function returned
 * **815 miles on average where the same window's odometers span 1,552** — 53% of the distance the
 * truck covered. 59 of those 64 were understated by more than a fifth. `burnable = windowMiles ÷ MPG`
 * is then roughly half what it should be, the over-fuel ceiling drops by ~100 gallons, and an ordinary
 * two-day fuelling pattern clears it. Recomputed with the span below, **2 of the 51 testable cases
 * still fire**: this defect, not a threshold and not a capacity, is what that queue was made of.
 *
 * One real window, reproduced exactly (vehicle window 2026-08-25 → 08-28):
 *
 *     fill        entered odo   OBD odo      what the old rule saw
 *     08-25        217,390       —           (skipped: no OBD reading)
 *     08-27        218,342       218,341.9   ← its "start"
 *     08-28        219,132       219,132.4   ← its "end"          →   790.5 mi
 *     the window's own ends                                       → 1,742 mi
 *
 * So the precondition is COVERAGE, not presence: OBD answers when the first and the last readable row
 * both carry an OBD reading, and otherwise the entered span answers under the guard it has always had.
 * This is the same principle `distanceByVehicle` states for the odometer collector — a period's ends
 * are BOUNDING readings, and measuring between the readings that happen to sit inside it is a silent
 * undercount. Two files, one rule about what an odometer span means.
 *
 * **What is deliberately NOT added here.** An "entered must agree with OBD where both exist" guard.
 * It is tempting — entered and OBD agree to 0.5 mi at the median on this fleet but by 17.5 mi at p90
 * and 300 mi at p99 — and it was measured before being rejected: it suppresses **no** case in the
 * anomaly population it would protect, and costs 5 of 165 trucks their entire month in the Fuel log's
 * miles tile (1,453,228 → 1,407,799 for 2026-08). A guard with a measured cost and no measured benefit
 * is not caution. The residual risk it would have covered — the oldest fill lacking OBD *and* the
 * entered readings being wrong while still rising — is what the monotonic check below has always been
 * for, and it is named here rather than left to be discovered.
 */
/** This row's OBD odometer, or null. `gps`/`reconstructed` are a different baseline and never count. */
export const obdReading = (r: WindowOdoRow): number | null =>
  r.samsaraSource === "obd" && r.samsaraOdometer != null && Number.isFinite(r.samsaraOdometer)
    ? r.samsaraOdometer
    : null;

/** This row's driver-entered odometer, or null. */
export const enteredReading = (r: WindowOdoRow): number | null =>
  r.enteredOdometer != null && Number.isFinite(r.enteredOdometer) ? r.enteredOdometer : null;

/**
 * Whether each source has a reading at BOTH ENDS of the window — the precondition the header is about.
 *
 * The ends are the first and last rows that carry ANY reading, not the first and last ROWS: a row with
 * neither odometer says nothing about where the window began, so letting it define an end would
 * suppress a window two good readings could have measured.
 */
export function windowEndCoverage(rowsOldestFirst: readonly WindowOdoRow[]): {
  obdCoversEnds: boolean;
  enteredCoversEnds: boolean;
} {
  const readable = rowsOldestFirst.filter((r) => obdReading(r) != null || enteredReading(r) != null);
  const first = readable[0];
  const last = readable[readable.length - 1];
  if (first == null || last == null || readable.length < 2) {
    return { obdCoversEnds: false, enteredCoversEnds: false };
  }
  return {
    obdCoversEnds: obdReading(first) != null && obdReading(last) != null,
    enteredCoversEnds: enteredReading(first) != null && enteredReading(last) != null,
  };
}

export function robustWindowMiles(rowsOldestFirst: WindowOdoRow[]): WindowMilesResult {
  const { obdCoversEnds, enteredCoversEnds } = windowEndCoverage(rowsOldestFirst);
  const obd = rowsOldestFirst.map(obdReading).filter((x): x is number => x != null);
  // COVERAGE, not presence. Two OBD readings in the middle of the window measure the middle of the
  // window; reporting that as the window's distance is the 815-against-1,552 undercount in the header.
  if (obdCoversEnds && obd.length >= 2) {
    // OBD is authoritative when it reaches both ends: use its span, or suppress if it didn't advance.
    // Do NOT fall through to the noisier entered span when the clean source says the truck didn't move.
    const span = Math.max(...obd) - Math.min(...obd);
    return span > MIN_WINDOW_ADVANCE_MI
      ? { miles: span, basis: "samsara_obd" }
      : { miles: null, basis: "none" };
  }

  const entered = rowsOldestFirst.map(enteredReading).filter((x): x is number => x != null);
  if (enteredCoversEnds && entered.length >= 2) {
    const monotonic = entered.every((v, i) => i === 0 || v >= entered[i - 1]! - 1); // no backward jump (±1 float tol)
    const span = Math.max(...entered) - Math.min(...entered);
    // Require REAL advancement, not merely monotonicity — a constant (non-advancing) odometer is
    // monotonic but carries no distance.
    if (monotonic && span > MIN_WINDOW_ADVANCE_MI) return { miles: span, basis: "entered" };
  }
  // Neither source reaches both ends, so neither can say how far the truck went. Null rather than the
  // longer of two partial spans: `cumulative_overfuel` suppresses itself on a null and accuses on a
  // short one, so an unmeasurable window must not be answered with the best guess available.
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
  opts: {
    minSamples?: number;
    minOffsetMiles?: number;
    maxRelSpread?: number;
    window?: number;
  } = {},
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
