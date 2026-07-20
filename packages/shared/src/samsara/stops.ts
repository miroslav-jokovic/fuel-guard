/** Fueling-stop matching + tank-rise fueling-event solver (docs/10 §14). */
import { haversineMiles } from "../ai.js";
import type { SamsaraSample, SourcedOdometer } from "./core.js";
import { cityFromAddress, stateFromAddress, normalizeStateCode, parseAsUtcMs } from "./location.js";
import type { TankReading } from "./reconcile.js";

export interface FuelingStopMatch {
  /** Samsara odometer (miles) at the fueling stop (in-city > in-state > nearest). Null if unresolved. */
  odometerMiles: number | null;
  /** Samsara time the odometer was read (the anchoring stop). */
  matchedAt: string | null;
  /** true = truck was in the EFS state that day; false = confidently never there; null = can't tell. */
  locationMatched: boolean | null;
  /** How the decision was reached — surfaced in evidence so a manager sees the reasoning. */
  basis: "in_city" | "in_state" | "not_in_state" | "no_coverage" | "no_efs_state";
  /** Reverse-geocoded state of the nearest stop we saw (for the "not in state" evidence). */
  observedState: string | null;
  /** Reverse-geocoded city/address of the anchoring or nearest stop (evidence). */
  observedCity: string | null;
  observedAddress: string | null;
}

const cityNorm = (c: string | null | undefined) => (c ?? "").trim().toLowerCase();

/** Minimum number of state-resolvable GPS samples before a "never in the EFS state" day counts as a real
 *  location mismatch. Below this, coverage is too thin to accuse and we report "no_coverage" (unknown). */
// Minimum state-resolvable GPS pings across the fueling day before we'll call a "truck was never in the EFS
// state" mismatch. Set generously (not 3): a handful of stray/neighbor-state pings — while the true
// station-lot pings are unresolved or truncated — must never be enough to accuse. Combined with the
// geocode-required veto in resolveLocationConfidence, a mismatch needs BOTH robust coverage and a geocode.
export const MIN_MISMATCH_COVERAGE = 8;

/**
 * Odometer (miles) interpolated to an exact instant from the day's Samsara odometer track. Samsara
 * doesn't stamp an odometer on every GPS ping, so rather than hoping the nearest ping carries one we
 * interpolate linearly between the two bracketing odometer readings. At a fueling STOP the odometer is
 * flat, so this returns the true stationary reading; between readings it estimates by elapsed time.
 */
export function odometerAtTime(samples: SamsaraSample[], targetIso: string): number | null {
  const pts = samples
    .filter((s) => s.odometerMiles != null)
    .map((s) => ({ t: new Date(s.time).getTime(), odo: s.odometerMiles as number }))
    .sort((a, b) => a.t - b.t);
  if (pts.length === 0) return null;
  const T = new Date(targetIso).getTime();
  if (T <= pts[0]!.t) return pts[0]!.odo;
  const last = pts[pts.length - 1]!;
  if (T >= last.t) return last.odo;
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i]!;
    if (b.t >= T) {
      const a = pts[i - 1]!;
      if (b.t === a.t) return b.odo;
      const frac = (T - a.t) / (b.t - a.t);
      return Math.round((a.odo + (b.odo - a.odo) * frac) * 10) / 10;
    }
  }
  return last.odo;
}

/** Sum of great-circle distance (miles) along the GPS trace between two instants — the truck's DRIVEN
 *  path length. With dense pings this closely approximates road miles (each short segment is near-straight);
 *  it's an under-estimate when pings are sparse. Used to reconstruct an odometer when none was stamped near
 *  the fueling moment. */
export function pathDistanceMiles(samples: SamsaraSample[], aIso: string, bIso: string): number {
  const lo = Math.min(parseAsUtcMs(aIso), parseAsUtcMs(bIso));
  const hi = Math.max(parseAsUtcMs(aIso), parseAsUtcMs(bIso));
  const pts = samples
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ t: parseAsUtcMs(s.time), lat: s.lat, lng: s.lng }))
    .filter((p) => p.t >= lo && p.t <= hi)
    .sort((a, b) => a.t - b.t);
  let d = 0;
  for (let i = 1; i < pts.length; i++)
    d += haversineMiles(pts[i - 1]!.lat, pts[i - 1]!.lng, pts[i]!.lat, pts[i]!.lng);
  return Math.round(d * 10) / 10;
}

/**
 * Odometer AT an instant, WITH provenance. Three tiers, strongest first:
 *   1. read/interpolate — an odometer reading brackets the instant within `maxInterpGapMin` on each side
 *      (at a stop the track is flat, so this is the true stationary reading). Source = the ping's obd|gps.
 *   2. reconstruct — no reading is that close, but one exists within `maxReconstructGapMin`: take it and add
 *      the DRIVEN path distance to the instant (nearest before → +dist, after → −dist). Source = 'reconstructed'.
 *   3. null — no odometer reading anywhere near.
 * This is what lets a truck whose odometer wasn't stamped exactly at the fill still get a fueling-time value,
 * without ever falling back to a stale whole-day clamp.
 */
export function odometerAtTimeSourced(
  samples: SamsaraSample[],
  targetIso: string,
  opts: { maxInterpGapMin?: number; maxReconstructGapMin?: number } = {},
): SourcedOdometer | null {
  const interpGap = (opts.maxInterpGapMin ?? 30) * 60_000;
  const reconGap = (opts.maxReconstructGapMin ?? 180) * 60_000;
  const raw = samples
    .filter((s) => s.odometerMiles != null)
    .map((s) => ({
      t: parseAsUtcMs(s.time),
      odo: s.odometerMiles as number,
      src: (s.odometerSource ?? "obd") as "obd" | "gps",
    }))
    .sort((a, b) => a.t - b.t);
  if (raw.length === 0) return null;
  // SINGLE-SOURCE: OBD and Samsara's GPS-derived odometer use different baselines (often tens of
  // thousands of miles apart). Interpolating across sources blends two scales → a phantom fueling-time
  // odometer. When the truck has ANY OBD reading in the window, resolve from OBD only; otherwise GPS only.
  const hasObd = raw.some((p) => p.src === "obd");
  const single = raw.filter((p) => p.src === (hasObd ? "obd" : "gps"));
  // DESPIKE: an odometer is physically monotone non-decreasing. Drop backward jumps (a reading below the
  // last kept value) and isolated up-spikes (implausible rate up that the next reading immediately reverts
  // below) — a single bad OBD sample must never define the fueling-time reading.
  const MAX_PLAUSIBLE_MPH = 100;
  const pts: typeof single = [];
  for (let i = 0; i < single.length; i++) {
    const cur = single[i]!;
    const prev = pts[pts.length - 1];
    const next = single[i + 1];
    if (prev) {
      if (cur.odo < prev.odo - 1) continue; // odometer went backward → bad sample
      const dtHr = Math.max((cur.t - prev.t) / 3_600_000, 1 / 60);
      const upMph = (cur.odo - prev.odo) / dtHr;
      if (next && upMph > MAX_PLAUSIBLE_MPH && next.odo < cur.odo - 1) continue; // isolated up-spike
    }
    pts.push(cur);
  }
  if (pts.length === 0) return null;
  const T = parseAsUtcMs(targetIso);
  const round1 = (n: number) => Math.round(n * 10) / 10;

  // Tier 1 — bracketed within the tight gap on both sides → read / interpolate.
  let before: (typeof pts)[number] | null = null;
  let after: (typeof pts)[number] | null = null;
  for (const p of pts) {
    if (p.t <= T) before = p;
    if (p.t >= T && after == null) after = p;
  }
  if (before && after && T - before.t <= interpGap && after.t - T <= interpGap) {
    if (after.t === before.t) return { miles: round1(before.odo), source: before.src };
    const frac = (T - before.t) / (after.t - before.t);
    return { miles: round1(before.odo + (after.odo - before.odo) * frac), source: before.src };
  }

  // Tier 2 — nearest reading within the wider gap + driven path distance → reconstructed.
  let near: (typeof pts)[number] | null = null;
  let nd = Infinity;
  for (const p of pts) {
    const d = Math.abs(p.t - T);
    if (d <= reconGap && d < nd) {
      nd = d;
      near = p;
    }
  }
  if (near) {
    const dist = pathDistanceMiles(samples, new Date(near.t).toISOString(), targetIso);
    const miles = near.t <= T ? near.odo + dist : near.odo - dist;
    return { miles: round1(miles), source: "reconstructed" };
  }
  return null;
}

/**
 * Timezone-robust location + odometer match (docs/10 §12, revised). The fueling instant is a true UTC
 * instant (station-local POS time converted at parse; worst case ±1h for split-timezone states), but we
 * still ask a robust question over the whole fetched day: was the truck EVER in the EFS station's state?
 * If yes, location is confirmed (a passing highway point earlier that day no longer causes a false
 * mismatch). We only call it a real mismatch when we have solid GPS coverage that day and the truck was
 * NEVER in that state. Odometer is read at the best stop: in the EFS city, else in the EFS state, else
 * the nearest stop — anchored by the fueling instant only to disambiguate multiple candidates.
 */
export function matchFuelingStop(
  samples: SamsaraSample[],
  efs: { state: string | null; city?: string | null },
  fueledAtUtcIso: string,
  opts: { stoppedMph?: number } = {},
): FuelingStopMatch {
  const stoppedMax = opts.stoppedMph ?? 5;
  const efsState = normalizeStateCode(efs.state);
  const efsCity = cityNorm(efs.city);
  const target = parseAsUtcMs(fueledAtUtcIso);
  const nearest = (list: SamsaraSample[]) =>
    [...list].sort(
      (a, b) =>
        Math.abs(new Date(a.time).getTime() - target) -
        Math.abs(new Date(b.time).getTime() - target),
    )[0] ?? null;

  // Stops are matched by LOCATION (speed + address) — we intentionally do NOT require an odometer on the
  // stop's own ping, because the odometer is recovered separately by interpolating the day's track.
  const stopped = samples.filter((s) => (s.speedMph ?? 0) <= stoppedMax && s.address);
  const odoAt = (s: SamsaraSample | null) => (s ? odometerAtTime(samples, s.time) : null);
  const ev = (s: SamsaraSample | null) => ({
    observedState: s ? stateFromAddress(s.address) : null,
    observedCity: s ? cityFromAddress(s.address) : null,
    observedAddress: s?.address ?? null,
  });

  if (!efsState) {
    const pick = nearest(stopped);
    return {
      odometerMiles: odoAt(pick),
      matchedAt: pick?.time ?? null,
      locationMatched: null,
      basis: "no_efs_state",
      ...ev(pick),
    };
  }

  // Was the truck in the EFS state at ANY point in the fetched day — moving OR stopped?
  const inStateAny = samples.some((s) => stateFromAddress(s.address) === efsState);
  if (inStateAny) {
    const inStateStops = stopped.filter((s) => stateFromAddress(s.address) === efsState);
    const inCityStops = efsCity
      ? inStateStops.filter((s) => cityNorm(cityFromAddress(s.address)) === efsCity)
      : [];
    const anchor = nearest(inCityStops) ?? nearest(inStateStops) ?? nearest(stopped);
    return {
      odometerMiles: odoAt(anchor),
      matchedAt: anchor?.time ?? null,
      locationMatched: true,
      basis: inCityStops.length ? "in_city" : "in_state",
      ...ev(anchor),
    };
  }

  // Never in the EFS state. Only call it a real mismatch when coverage is ROBUST — a handful of pings that
  // happened to resolve a neighboring state (sparse reverse-geo, a stray GPS point, a corner-cut across a
  // line) is too thin to accuse. Below the floor we return "no_coverage" (unknown), which never flags.
  const resolvable = samples.filter((s) => stateFromAddress(s.address) != null);
  if (resolvable.length >= MIN_MISMATCH_COVERAGE) {
    const pick = nearest(stopped) ?? nearest(resolvable);
    return {
      odometerMiles: null,
      matchedAt: null,
      locationMatched: false,
      basis: "not_in_state",
      ...ev(pick),
    };
  }
  return {
    odometerMiles: null,
    matchedAt: null,
    locationMatched: null,
    basis: "no_coverage",
    observedState: null,
    observedCity: null,
    observedAddress: null,
  };
}

// ── Tank-rise fueling-event solver (docs/10 §14) ────────────────────────────────────────────────
// The EFS report time is a settlement/authorization stamp that can differ from the real pump time, so
// anchoring on "the stop nearest the reported time" is circular. Instead we find the moment the truck's
// fuel level STEPPED UP by ~the billed gallons — physically the fueling event, independent of the EFS
// clock. This yields the true time, the odometer at that instant (flat, because parked), and the observed
// location. Returns null when no confident rise is found so the caller falls back to matchFuelingStop.

/** Minimum tank-level rise (percentage points) to trust a fueling event from telematics. */
export const MIN_FUEL_RISE_PCT = 6;

export interface FuelingEvent {
  at: string; // actual fueling instant (ISO) — the telematics anchor, not the EFS report time
  odometerMiles: number | null;
  observedState: string | null;
  observedCity: string | null;
  observedAddress: string | null;
  observedLat: number | null;
  observedLng: number | null;
  pctBefore: number;
  pctAfter: number;
  riseGalObserved: number | null; // observed rise converted to gallons (needs tank capacity)
  expectedGal: number | null; // billed gallons (what we expected the rise to be)
}

interface Rise {
  before: TankReading;
  after: TankReading;
  delta: number;
}

/**
 * Detect fuel-level rises: a low reading followed, WITHIN a fueling-length window, by a materially higher
 * one. Window-bounding keeps the "before" point at the actual arrival low instead of drifting to an
 * earlier reading, and it naturally separates two fills on the same day.
 */
function detectFuelRises(
  readings: TankReading[],
  minRisePct: number,
  maxWindowMs = 2 * 3_600_000,
): Rise[] {
  const r = [...readings].sort((a, b) => parseAsUtcMs(a.time) - parseAsUtcMs(b.time));
  const rises: Rise[] = [];
  let i = 0;
  while (i < r.length - 1) {
    const start = parseAsUtcMs(r[i]!.time);
    let peak = i;
    for (let j = i + 1; j < r.length && parseAsUtcMs(r[j]!.time) - start <= maxWindowMs; j++) {
      if (r[j]!.percent > r[peak]!.percent) peak = j;
    }
    // "before" = the arrival LOW between the window start and the peak (not simply r[i]).
    let lo = i;
    for (let k = i; k <= peak; k++) if (r[k]!.percent < r[lo]!.percent) lo = k;
    const delta = r[peak]!.percent - r[lo]!.percent;
    if (peak > lo && delta >= minRisePct) {
      rises.push({ before: r[lo]!, after: r[peak]!, delta });
      i = peak; // continue after this fill's peak
    } else {
      i++;
    }
  }
  return rises;
}

/**
 * Find the fueling event by tank-level rise. `efs.reportedAtIso` is used ONLY as a weak tiebreaker
 * between multiple same-day fills — never as the primary anchor. Returns null when there's no fuel-%
 * data or no rise clears the threshold (caller falls back to the stop-nearest-time logic).
 */
export function findFuelingEvent(
  samples: SamsaraSample[],
  fuelReadings: TankReading[],
  efs: {
    state: string | null;
    city?: string | null;
    gallons: number | null;
    tankCapacityGal: number | null;
    reportedAtIso: string;
  },
  opts: { stoppedMph?: number; minRisePct?: number } = {},
): FuelingEvent | null {
  const minRise = opts.minRisePct ?? MIN_FUEL_RISE_PCT;
  const stoppedMax = opts.stoppedMph ?? 5;
  if (fuelReadings.length < 2) return null;

  const rises = detectFuelRises(fuelReadings, minRise);
  if (rises.length === 0) return null;

  const efsState = normalizeStateCode(efs.state);
  const tank = efs.tankCapacityGal && efs.tankCapacityGal > 0 ? efs.tankCapacityGal : null;
  const expectedPct = tank && efs.gallons != null ? (efs.gallons / tank) * 100 : null;
  const target = parseAsUtcMs(efs.reportedAtIso);

  const pad = 20 * 60_000; // widen the stop search a little around the rise window
  const anchorFor = (rise: Rise): SamsaraSample | null => {
    const lo = parseAsUtcMs(rise.before.time) - pad;
    const hi = parseAsUtcMs(rise.after.time) + pad;
    const inWin = samples.filter((s) => {
      const t = parseAsUtcMs(s.time);
      return t >= lo && t <= hi;
    });
    const stopped = inWin.filter((s) => (s.speedMph ?? 0) <= stoppedMax && s.address);
    const pool = stopped.length ? stopped : inWin;
    const arrival = parseAsUtcMs(rise.before.time);
    return (
      pool.sort(
        (a, b) =>
          Math.abs(parseAsUtcMs(a.time) - arrival) - Math.abs(parseAsUtcMs(b.time) - arrival),
      )[0] ?? null
    );
  };

  // Rank rises: prefer one whose stop is in the EFS state, then closest magnitude to the billed gallons,
  // then (weak) closest to the reported time. When expected magnitude is unknown, prefer the biggest rise.
  const scored = rises
    .map((rise) => {
      const anchor = anchorFor(rise);
      const inState = !!(efsState && anchor && stateFromAddress(anchor.address) === efsState);
      const magScore = expectedPct != null ? Math.abs(rise.delta - expectedPct) : -rise.delta;
      const timeGap = anchor
        ? Math.abs(parseAsUtcMs(anchor.time) - target)
        : Number.MAX_SAFE_INTEGER;
      return { rise, anchor, inState, magScore, timeGap };
    })
    // Guard against picking a small noise rise when a real fill was expected.
    .filter((c) =>
      expectedPct != null ? c.rise.delta >= Math.max(minRise, expectedPct * 0.4) : true,
    );
  if (scored.length === 0) return null;

  scored.sort(
    (a, b) =>
      Number(b.inState) - Number(a.inState) || a.magScore - b.magScore || a.timeGap - b.timeGap,
  );
  const best = scored[0]!;
  const at = best.anchor?.time ?? best.rise.before.time;
  const riseGal = tank ? Math.round((best.rise.delta / 100) * tank * 10) / 10 : null;

  return {
    at,
    odometerMiles: odometerAtTime(samples, at),
    observedState: best.anchor ? stateFromAddress(best.anchor.address) : null,
    observedCity: best.anchor ? cityFromAddress(best.anchor.address) : null,
    observedAddress: best.anchor?.address ?? null,
    observedLat: best.anchor?.lat ?? null,
    observedLng: best.anchor?.lng ?? null,
    pctBefore: best.rise.before.percent,
    pctAfter: best.rise.after.percent,
    riseGalObserved: riseGal,
    expectedGal: efs.gallons ?? null,
  };
}

/**
 * Location confidence, from strongest to weakest:
 *  - gps_confirmed: the truck's GPS came within the proximity radius of the geocoded station.
 *  - in_state:      the truck was in the EFS station's state that day (no station coords to be precise).
 *  - mismatch:      solid GPS coverage, but the truck was never in that state / never near the station.
 *  - unknown:       not enough GPS coverage (or no geocode) to say.
 */
