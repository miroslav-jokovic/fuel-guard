import { haversineMiles } from "./ai.js";

/**
 * Samsara telematics matching (docs/10). EFS gives a date-only fueling line + station city/state;
 * Samsara gives a continuous GPS+odometer trace. We find the moment the truck was STOPPED at the
 * EFS station's city — that single moment yields both the TRUTH odometer (for the ±5 check) and the
 * RECOVERED fueling time. All pure + deterministic; the HTTP call lives in the API.
 */

const METERS_PER_MILE = 1609.344;
export const metersToMiles = (m: number): number => Math.round((m / METERS_PER_MILE) * 10) / 10;

/** A unified telematics sample: GPS point with the odometer decorated onto it. */
export interface SamsaraSample {
  time: string; // ISO
  lat: number;
  lng: number;
  speedMph: number | null;
  address: string | null; // reverseGeo.formattedLocation
  odometerMiles: number | null;
  /** 'obd' (from the ECU — most accurate) or 'gps' (Samsara's GPS-derived odometer). null/absent when
   *  no odometer on the ping. Optional for back-compat with hand-built samples. */
  odometerSource?: "obd" | "gps" | null;
}

/** How a resolved fueling-moment odometer was obtained (for display + confidence). */
export type OdometerSource = "obd" | "gps" | "reconstructed";

/** A resolved odometer reading at an instant, with provenance. */
export interface SourcedOdometer {
  miles: number;
  source: OdometerSource;
}

interface RawGpsPoint {
  time?: string;
  latitude?: number;
  longitude?: number;
  speedMilesPerHour?: number;
  reverseGeo?: { formattedLocation?: string };
  decorations?: { obdOdometerMeters?: { value?: number }; gpsOdometerMeters?: { value?: number } };
}
interface RawFuelPercentPoint {
  time?: string;
  value?: number; // tank level as a percentage (0..100)
}
interface RawVehicleStats {
  gps?: RawGpsPoint[];
  fuelPercents?: RawFuelPercentPoint[];
  /** GPS-derived odometer requested as its OWN stat TYPE (types=…,gpsOdometerMeters) — a separate series,
   *  NOT a gps decoration. Used as the odometer fallback for trucks without ECU/OBD coverage. */
  gpsOdometerMeters?: { time?: string; value?: number }[];
}

/** Max time gap to attach a gpsOdometerMeters reading to a GPS ping (their timestamps are close but may not
 *  match exactly). Downstream (odometerAtTimeSourced) interpolates across samples, so this only needs to be
 *  tight enough to associate the right reading. */
const GPS_ODO_MATCH_TOL_MS = 120_000;

/** Parse one vehicle's stats-history into samples. Odometer preference per ping: ECU/OBD (decoration) →
 *  Samsara GPS-derived odometer (the separate gpsOdometerMeters TYPE series, matched by nearest time). */
export function parseSamsaraSamples(vehicle: RawVehicleStats): SamsaraSample[] {
  // Build a sorted series of the GPS-odometer TYPE readings for a nearest-time lookup (fallback source).
  const gpsOdoSeries = (vehicle.gpsOdometerMeters ?? [])
    .map((p) => ({ t: p.time ? parseAsUtcMs(p.time) : NaN, v: p.value }))
    .filter((x): x is { t: number; v: number } => Number.isFinite(x.t) && x.v != null)
    .sort((a, b) => a.t - b.t);
  const nearestGpsOdo = (tMs: number): number | null => {
    if (gpsOdoSeries.length === 0) return null;
    let lo = 0;
    let hi = gpsOdoSeries.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (gpsOdoSeries[mid]!.t < tMs) lo = mid + 1;
      else hi = mid;
    }
    let best: { t: number; v: number } | null = null;
    for (const c of [gpsOdoSeries[lo], gpsOdoSeries[lo - 1]]) {
      if (c && (!best || Math.abs(c.t - tMs) < Math.abs(best.t - tMs))) best = c;
    }
    return best && Math.abs(best.t - tMs) <= GPS_ODO_MATCH_TOL_MS ? best.v : null;
  };

  return (vehicle.gps ?? [])
    .filter((p) => p.time && p.latitude != null && p.longitude != null)
    .map((p) => {
      // Prefer the ECU/OBD odometer decoration; else the GPS-odometer decoration (legacy); else the
      // GPS-odometer TYPE series matched by nearest time. Track which source we used.
      const obd = p.decorations?.obdOdometerMeters?.value;
      const gps = obd != null ? undefined : p.decorations?.gpsOdometerMeters?.value ?? nearestGpsOdo(parseAsUtcMs(p.time!)) ?? undefined;
      const meters = obd ?? gps;
      return {
        time: p.time!,
        lat: p.latitude!,
        lng: p.longitude!,
        speedMph: p.speedMilesPerHour ?? null,
        address: p.reverseGeo?.formattedLocation ?? null,
        odometerMiles: meters != null ? metersToMiles(meters) : null,
        odometerSource: (obd != null ? "obd" : gps != null ? "gps" : null) as "obd" | "gps" | null,
      };
    });
}

const norm = (s: string) => s.trim().toLowerCase();

export interface FuelingMatch {
  matchedAt: string; // recovered fueling time
  samsaraOdometerMiles: number | null;
  lat: number;
  lng: number;
  locationMatched: boolean; // truck was actually in the EFS city
}

/**
 * Find the fueling moment: the STOPPED sample whose reverse-geocoded address is in the EFS station's
 * city (the truck was parked there to fuel). Returns null when Samsara never placed the truck in that
 * city that day — itself a strong "card used but truck not there" theft signal the caller can flag.
 */
export function matchFuelingMoment(
  samples: SamsaraSample[],
  efs: { city: string | null; state: string | null; stationName?: string | null },
  opts: { stoppedSpeedMph?: number } = {},
): FuelingMatch | null {
  const stoppedMax = opts.stoppedSpeedMph ?? 3;
  const city = efs.city ? norm(efs.city) : null;
  if (!city) return null;

  const inCity = samples.filter((s) => s.address && norm(s.address).includes(city));
  if (inCity.length === 0) return null;

  // Prefer stopped samples that have an odometer; then most-stopped, then earliest.
  const ranked = [...inCity].sort((a, b) => {
    const aHas = a.odometerMiles != null ? 0 : 1;
    const bHas = b.odometerMiles != null ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    const aSpeed = a.speedMph ?? 0;
    const bSpeed = b.speedMph ?? 0;
    if (aSpeed !== bSpeed) return aSpeed - bSpeed;
    return new Date(a.time).getTime() - new Date(b.time).getTime();
  });

  // Best stopped-in-city sample (fall back to the best in-city sample if none are "stopped").
  const stopped = ranked.find((s) => (s.speedMph ?? 0) <= stoppedMax) ?? ranked[0]!;
  return {
    matchedAt: stopped.time,
    samsaraOdometerMiles: stopped.odometerMiles,
    lat: stopped.lat,
    lng: stopped.lng,
    locationMatched: true,
  };
}

// ---------------------------------------------------------------------------
// Precise location comparison (docs/10 §11)
//
// With the exact fueling TIME (from the timed EFS report) we take the Samsara GPS sample nearest that
// minute and compare its reverse-geocoded STATE to the EFS station's state. State is robust to parse
// and to compare (unlike fuzzy city names), so this is reliable and low-false-positive. City is kept
// as evidence for the reviewer; a same-state city difference is NOT flagged (needs distance/geocoding).
// ---------------------------------------------------------------------------

/** The Samsara sample closest in time to `targetIso`, within `windowMin` minutes. Null if none. */
export function sampleNearestTime(
  samples: SamsaraSample[],
  targetIso: string,
  windowMin = 15,
): SamsaraSample | null {
  const t = new Date(targetIso).getTime();
  const windowMs = windowMin * 60_000;
  let best: SamsaraSample | null = null;
  let bestDelta = Infinity;
  for (const s of samples) {
    const delta = Math.abs(new Date(s.time).getTime() - t);
    if (delta <= windowMs && delta < bestDelta) {
      bestDelta = delta;
      best = s;
    }
  }
  return best;
}

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC","PR",
  // Canadian provinces (EFS fleets often cross the border)
  "AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT",
]);

/** Full state/province NAME → 2-letter code, so an EFS value that arrives as a full name ("Texas",
 *  "British Columbia") still compares equal to Samsara's 2-letter reverse-geo code and can't cause a
 *  false location mismatch. */
const STATE_NAME_TO_CODE: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA", COLORADO: "CO",
  CONNECTICUT: "CT", DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID",
  ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA", KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME",
  MARYLAND: "MD", MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS", MISSOURI: "MO",
  MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM",
  "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR",
  PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", TENNESSEE: "TN",
  TEXAS: "TX", UTAH: "UT", VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV",
  WISCONSIN: "WI", WYOMING: "WY", "DISTRICT OF COLUMBIA": "DC", "PUERTO RICO": "PR",
  // Canadian provinces/territories
  ALBERTA: "AB", "BRITISH COLUMBIA": "BC", MANITOBA: "MB", "NEW BRUNSWICK": "NB",
  "NEWFOUNDLAND AND LABRADOR": "NL", NEWFOUNDLAND: "NL", "NOVA SCOTIA": "NS", "NORTHWEST TERRITORIES": "NT",
  NUNAVUT: "NU", ONTARIO: "ON", "PRINCE EDWARD ISLAND": "PE", QUEBEC: "QC", SASKATCHEWAN: "SK", YUKON: "YT",
};

/**
 * Normalize a state/province value to its 2-letter US/CA code. Accepts a code ("TX", "tx") OR a full name
 * ("Texas", "TEXAS", "British Columbia"). Returns null when unrecognized — fail-safe: no code means no state
 * comparison, which yields "unknown" (never a false mismatch). Use this on any EFS-provided state before
 * comparing it to a Samsara reverse-geo code.
 */
export function normalizeStateCode(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim().toUpperCase();
  if (US_STATES.has(t)) return t;
  return STATE_NAME_TO_CODE[t] ?? null;
}

/** Extract the 2-letter state/province code from a Samsara formatted address ("…, City, ST, 12345"). */
export function stateFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const tokens = address.split(",").map((s) => s.trim());
  for (let i = tokens.length - 1; i >= 0; i--) {
    const m = tokens[i]!.match(/\b([A-Za-z]{2})\b/);
    if (m && US_STATES.has(m[1]!.toUpperCase())) return m[1]!.toUpperCase();
  }
  return null;
}

/** Extract the city (token just before the state) from a Samsara formatted address. */
export function cityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const tokens = address.split(",").map((s) => s.trim());
  for (let i = tokens.length - 1; i >= 0; i--) {
    const m = tokens[i]!.match(/\b([A-Za-z]{2})\b/);
    if (m && US_STATES.has(m[1]!.toUpperCase())) return i > 0 ? tokens[i - 1]! : null;
  }
  return null;
}

/**
 * Compare the EFS station state to the Samsara address state at the fueling moment.
 * Returns true (same state), false (clearly different state → mismatch), or null (can't tell).
 */
export function compareLocationState(
  efsState: string | null,
  samsaraAddress: string | null,
): boolean | null {
  if (!efsState || !samsaraAddress) return null;
  const s = stateFromAddress(samsaraAddress);
  const efs = normalizeStateCode(efsState);
  if (!s || !efs) return null;
  return s === efs;
}

// Hours to ADD to local time to get UTC (standard time; DST ignored → ≤1h slack, absorbed by the
// matching window). Used only to APPROXIMATE the fueling instant so we can pick the right stop — the
// odometer/location itself comes from the physical Samsara stop, so this never has to be exact.
const STATE_UTC_OFFSET: Record<string, number> = {
  // Eastern
  CT: 5, DE: 5, FL: 5, GA: 5, IN: 5, MA: 5, MD: 5, ME: 5, MI: 5, NC: 5, NH: 5, NJ: 5, NY: 5, OH: 5,
  PA: 5, RI: 5, SC: 5, VA: 5, VT: 5, WV: 5, DC: 5, ON: 5, QC: 5,
  // Atlantic (Canada)
  NB: 4, NS: 4, PE: 4, NL: 4,
  // Central
  AL: 6, AR: 6, IA: 6, IL: 6, KS: 6, LA: 6, MN: 6, MO: 6, MS: 6, ND: 6, NE: 6, OK: 6, SD: 6, TN: 6,
  TX: 6, WI: 6, MB: 6,
  // Mountain
  AZ: 7, CO: 7, ID: 7, MT: 7, NM: 7, UT: 7, WY: 7, AB: 7,
  // Pacific
  CA: 8, NV: 8, OR: 8, WA: 8, BC: 8,
  AK: 9, HI: 10,
};

/**
 * Parse a timestamp as UTC even when it carries no timezone designator. A tz-less ISO string
 * ("2026-06-30T14:30:00") is interpreted as LOCAL time by `new Date`, which makes results depend on
 * the server's timezone — so we append 'Z' when no offset/zone is present to force UTC deterministically.
 */
function parseAsUtcMs(iso: string): number {
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso.trim());
  return new Date(hasZone ? iso : `${iso}Z`).getTime();
}

/**
 * Approximate the fueling instant (ms, UTC) from a report's naive-UTC time + the station state.
 * @deprecated EFS instants are now converted station-local → true UTC at parse time (efsInstant),
 * so callers should treat `fueled_at` as UTC directly. Kept for legacy data paths/tests only.
 */
export function approxFuelingUtcMs(posNaiveIso: string, state: string | null): number {
  const base = parseAsUtcMs(posNaiveIso);
  const off = state ? STATE_UTC_OFFSET[state.trim().toUpperCase()] : undefined;
  return off != null ? base + off * 3_600_000 : base;
}

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
  for (let i = 1; i < pts.length; i++) d += haversineMiles(pts[i - 1]!.lat, pts[i - 1]!.lng, pts[i]!.lat, pts[i]!.lng);
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
  const pts = samples
    .filter((s) => s.odometerMiles != null)
    .map((s) => ({ t: parseAsUtcMs(s.time), odo: s.odometerMiles as number, src: (s.odometerSource ?? "obd") as "obd" | "gps" }))
    .sort((a, b) => a.t - b.t);
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
      (a, b) => Math.abs(new Date(a.time).getTime() - target) - Math.abs(new Date(b.time).getTime() - target),
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
    return { odometerMiles: odoAt(pick), matchedAt: pick?.time ?? null, locationMatched: null, basis: "no_efs_state", ...ev(pick) };
  }

  // Was the truck in the EFS state at ANY point in the fetched day — moving OR stopped?
  const inStateAny = samples.some((s) => stateFromAddress(s.address) === efsState);
  if (inStateAny) {
    const inStateStops = stopped.filter((s) => stateFromAddress(s.address) === efsState);
    const inCityStops = efsCity ? inStateStops.filter((s) => cityNorm(cityFromAddress(s.address)) === efsCity) : [];
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
    return { odometerMiles: null, matchedAt: null, locationMatched: false, basis: "not_in_state", ...ev(pick) };
  }
  return { odometerMiles: null, matchedAt: null, locationMatched: null, basis: "no_coverage", observedState: null, observedCity: null, observedAddress: null };
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
function detectFuelRises(readings: TankReading[], minRisePct: number, maxWindowMs = 2 * 3_600_000): Rise[] {
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
  efs: { state: string | null; city?: string | null; gallons: number | null; tankCapacityGal: number | null; reportedAtIso: string },
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
    return pool.sort((a, b) => Math.abs(parseAsUtcMs(a.time) - arrival) - Math.abs(parseAsUtcMs(b.time) - arrival))[0] ?? null;
  };

  // Rank rises: prefer one whose stop is in the EFS state, then closest magnitude to the billed gallons,
  // then (weak) closest to the reported time. When expected magnitude is unknown, prefer the biggest rise.
  const scored = rises
    .map((rise) => {
      const anchor = anchorFor(rise);
      const inState = !!(efsState && anchor && stateFromAddress(anchor.address) === efsState);
      const magScore = expectedPct != null ? Math.abs(rise.delta - expectedPct) : -rise.delta;
      const timeGap = anchor ? Math.abs(parseAsUtcMs(anchor.time) - target) : Number.MAX_SAFE_INTEGER;
      return { rise, anchor, inState, magScore, timeGap };
    })
    // Guard against picking a small noise rise when a real fill was expected.
    .filter((c) => (expectedPct != null ? c.rise.delta >= Math.max(minRise, expectedPct * 0.4) : true));
  if (scored.length === 0) return null;

  scored.sort(
    (a, b) => Number(b.inState) - Number(a.inState) || a.magScore - b.magScore || a.timeGap - b.timeGap,
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
  const toleranceGal = Math.round(Math.max(args.toleranceGal ?? 15, gallonsBilled * fracTol) * 10) / 10;
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

interface RawSamsaraVehicle {
  id?: string;
  name?: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: string | number;
  licensePlate?: string;
}

export interface SamsaraVehicle {
  samsaraId: string;
  name: string; // Samsara display name — usually the unit number
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  licensePlate: string | null;
}

const clean = (s: string | undefined): string | null => {
  const t = s?.trim();
  return t ? t : null;
};

interface RawStatValue {
  value?: number;
  time?: string;
}
interface RawVehicleStat {
  id?: string;
  obdOdometerMeters?: RawStatValue;
  gpsOdometerMeters?: RawStatValue;
  fuelPercent?: RawStatValue; // Samsara returns this SINGULAR in the stats response
  fuelPercents?: RawStatValue;
}

export interface VehicleFuelLevel {
  percent: number; // 0..100
  time: string | null;
}

/** Parse `GET /fleet/vehicles/stats?types=fuelPercents` into a map of Samsara vehicle id → tank level %. */
export function parseVehicleFuelPercents(response: { data?: RawVehicleStat[] }): Map<string, VehicleFuelLevel> {
  const out = new Map<string, VehicleFuelLevel>();
  for (const v of response.data ?? []) {
    if (!v.id) continue;
    const fp = v.fuelPercent ?? v.fuelPercents; // Samsara uses `fuelPercent` (singular) in responses
    const p = fp?.value;
    if (p != null && p >= 0 && p <= 100) {
      out.set(String(v.id), { percent: Math.round(p * 10) / 10, time: fp?.time ?? null });
    }
  }
  return out;
}

/**
 * Parse `GET /fleet/vehicles/stats?types=obdOdometerMeters,gpsOdometerMeters` into a map of Samsara
 * vehicle id → current odometer in MILES. Prefers OBD (dash-accurate); falls back to GPS odometer.
 * Samsara reports odometer in meters; entries without either reading are omitted.
 */
export function parseVehicleStatsOdometer(response: { data?: RawVehicleStat[] }): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of response.data ?? []) {
    if (!v.id) continue;
    const meters = v.obdOdometerMeters?.value ?? v.gpsOdometerMeters?.value;
    if (meters != null) out.set(String(v.id), metersToMiles(meters));
  }
  return out;
}

interface RawSamsaraDriver {
  id?: string;
  name?: string;
  phone?: string;
  username?: string;
  driverActivationStatus?: string;
}

export interface SamsaraDriver {
  samsaraId: string;
  name: string;
  phone: string | null;
  active: boolean;
}

interface RawAssignment {
  startTime?: string;
  endTime?: string;
  driver?: { id?: string };
  driverId?: string;
}
interface RawAssignmentGroup extends RawAssignment {
  vehicle?: { id?: string };
  vehicleId?: string;
  id?: string;
  assignments?: RawAssignment[];
  driverAssignments?: RawAssignment[];
}

export interface VehicleDriverLink {
  vehicleSamsaraId: string;
  driverSamsaraId: string;
}

const assignmentDriverId = (a: RawAssignment): string | undefined => a.driver?.id ?? a.driverId;

/**
 * Parse `GET /fleet/driver-vehicle-assignments?filterBy=vehicles` into each truck's CURRENT driver =
 * the MOST RECENT assignment per vehicle (latest startTime). Samsara returns completed HOS driving
 * segments (each with a past endTime), so "active right now" filtering would drop them all; the latest
 * segment's driver is who last drove the truck. Tolerant of the flat shape (driver+vehicle on the row)
 * and the grouped shape (vehicle with a nested `assignments`/`driverAssignments` array). `nowIso` is
 * kept for signature compatibility.
 */
export function parseCurrentAssignments(
  response: { data?: RawAssignmentGroup[] },
  _nowIso?: string,
): VehicleDriverLink[] {
  // Per vehicle, remember the assignment with the latest start.
  const latest = new Map<string, { start: number; driverId: string }>();
  const consider = (vehicleId: string | undefined, a: RawAssignment) => {
    const driverId = assignmentDriverId(a);
    if (!vehicleId || !driverId) return;
    const start = new Date(a.startTime ?? 0).getTime();
    const prev = latest.get(vehicleId);
    if (!prev || start >= prev.start) latest.set(vehicleId, { start, driverId: String(driverId) });
  };

  for (const g of response.data ?? []) {
    const nested = g.assignments ?? g.driverAssignments;
    if (nested) {
      const vehicleId = g.vehicle?.id ?? g.vehicleId ?? g.id;
      for (const a of nested) consider(vehicleId, a);
    } else if (assignmentDriverId(g)) {
      consider(g.vehicle?.id ?? g.vehicleId, g); // flat row: don't treat g.id as a vehicle id
    }
  }

  return [...latest.entries()].map(([vehicleSamsaraId, v]) => ({
    vehicleSamsaraId,
    driverSamsaraId: v.driverId,
  }));
}

// ── Trailer (unpowered asset) sync — GET /fleet/trailers ────────────────────────────────────────
interface RawSamsaraTrailer {
  id?: string;
  name?: string;
  make?: string;
  model?: string;
  year?: string | number;
  licensePlate?: string;
  serialNumber?: string;
}

export interface SamsaraTrailer {
  samsaraId: string;
  name: string; // usually the trailer unit number
  make: string | null;
  model: string | null;
  year: number | null;
  licensePlate: string | null;
  serial: string | null;
}

/** Parse `GET /fleet/trailers` (pages merged) into trailer identities. */
export function parseSamsaraTrailers(response: { data?: RawSamsaraTrailer[] }): SamsaraTrailer[] {
  return (response.data ?? [])
    .filter((t) => t.id != null && String(t.id).trim() !== "")
    .map((t) => {
      const yr = t.year != null ? parseInt(String(t.year), 10) : NaN;
      return {
        samsaraId: String(t.id),
        name: clean(t.name) ?? String(t.id),
        make: clean(t.make),
        model: clean(t.model),
        year: Number.isFinite(yr) ? yr : null,
        licensePlate: clean(t.licensePlate),
        serial: clean(t.serialNumber),
      };
    });
}

interface RawAssoc {
  startTime?: string;
  assignedAtMs?: number;
  tractorId?: string | number;
  vehicleId?: string | number;
  vehicle?: { id?: string | number };
}
interface RawTrailerAssignment extends RawAssoc {
  endTime?: string;
  name?: string;
  trailer?: { id?: string | number };
  trailerId?: string | number;
  id?: string | number; // v1 `trailers[]` rows: this IS the trailer id
  currentAssociation?: RawAssoc;
  association?: RawAssoc;
  assignments?: RawTrailerAssignment[];
}

export interface TrailerVehicleLink {
  trailerSamsaraId: string;
  vehicleSamsaraId: string;
}

const assocTractorId = (a: RawAssoc): string | undefined => {
  const v = a.tractorId ?? a.vehicleId ?? a.vehicle?.id;
  return v != null ? String(v) : undefined;
};
const assocStart = (a: RawAssoc): number => (a.assignedAtMs != null ? a.assignedAtMs : new Date(a.startTime ?? 0).getTime());

/**
 * Parse trailer↔tractor assignments into each trailer's CURRENT tractor (latest start). Tolerant of:
 *  - v1 `{ trailers: [{ id, currentAssociation: { tractorId, assignedAtMs } }] }`
 *  - v2/grouped `{ data: [{ trailer:{id}, assignments:[{ vehicleId, startTime }] }] }`
 *  - flat `{ data: [{ trailer:{id}, vehicle:{id}, startTime }] }`
 */
export function parseTrailerAssignments(response: { trailers?: RawTrailerAssignment[]; data?: RawTrailerAssignment[] }): TrailerVehicleLink[] {
  const latest = new Map<string, { start: number; vehicleId: string }>();
  const consider = (trailerId: string | undefined, a: RawAssoc) => {
    const vehicleId = assocTractorId(a);
    if (!trailerId || !vehicleId) return;
    const start = assocStart(a);
    const prev = latest.get(trailerId);
    if (!prev || start >= prev.start) latest.set(trailerId, { start, vehicleId });
  };

  // v1: a list of trailers, each carrying its current association.
  for (const t of response.trailers ?? []) {
    const trailerId = t.id != null ? String(t.id) : undefined;
    const assoc = t.currentAssociation ?? t.association;
    if (assoc) consider(trailerId, assoc);
    else if (assocTractorId(t)) consider(trailerId, t);
  }

  // v2 / generic `data`.
  for (const g of response.data ?? []) {
    if (g.assignments) {
      const trailerId = g.trailer?.id != null ? String(g.trailer.id) : g.trailerId != null ? String(g.trailerId) : g.id != null ? String(g.id) : undefined;
      for (const a of g.assignments) consider(trailerId, a);
    } else {
      const trailerId = g.trailer?.id != null ? String(g.trailer.id) : g.trailerId != null ? String(g.trailerId) : undefined;
      if (assocTractorId(g)) consider(trailerId, g);
    }
  }

  return [...latest.entries()].map(([trailerSamsaraId, v]) => ({ trailerSamsaraId, vehicleSamsaraId: v.vehicleId }));
}

/** Parse a Samsara `/fleet/drivers` list response (pages merged) into driver identities. */
export function parseSamsaraDrivers(response: { data?: RawSamsaraDriver[] }): SamsaraDriver[] {
  return (response.data ?? [])
    .filter((d) => d.id != null && String(d.id).trim() !== "")
    .map((d) => ({
      samsaraId: String(d.id),
      name: clean(d.name) ?? String(d.id),
      phone: clean(d.phone),
      active: d.driverActivationStatus ? d.driverActivationStatus === "active" : true,
    }));
}

/** Parse a Samsara `/fleet/vehicles` list response (one or more pages merged) into vehicle identities. */
export function parseSamsaraVehicles(response: { data?: RawSamsaraVehicle[] }): SamsaraVehicle[] {
  return (response.data ?? [])
    .filter((v) => v.id != null && String(v.id).trim() !== "")
    .map((v) => {
      const yr = v.year != null ? parseInt(String(v.year), 10) : NaN;
      return {
        samsaraId: String(v.id),
        name: clean(v.name) ?? String(v.id),
        vin: clean(v.vin),
        make: clean(v.make),
        model: clean(v.model),
        year: Number.isFinite(yr) ? yr : null,
        licensePlate: clean(v.licensePlate),
      };
    });
}

/** Distance (mi) between the EFS station coords (if known) and the matched Samsara point. */
export function locationDistanceMiles(
  efs: { lat: number | null; lng: number | null },
  match: { lat: number; lng: number },
): number | null {
  if (efs.lat == null || efs.lng == null) return null;
  return Math.round(haversineMiles(efs.lat, efs.lng, match.lat, match.lng) * 10) / 10;
}
