/** Samsara samples + odometer/fueling-moment matching (docs/10). */
import { parseAsUtcMs } from "./location.js";
import type { StatsFeedPage } from "./statsFeed.js";

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

/**
 * One GPS ping exactly as Samsara sends it, under `types=gps` on both `/fleet/vehicles/stats` and
 * `/fleet/vehicles/stats/feed`.
 *
 * `headingDegrees` and `isEcuSpeed` were added for the live map (LIVE-MAP-PLAN.md LM4). They have been
 * arriving on every one of these pings since the stats tier was built and were being discarded with the
 * rest of the fix — the collector for the map was, literally, already running (§0, "one thing nobody
 * had noticed we already own"). Neither is a second integration and neither costs a request.
 *
 * ⚠ `accuracyMeters` is NOT here, and asking for it is the one thing that would force a second
 * integration: it exists only on `/fleet/assets/location-and-speed/stream`. Nothing in the map needs
 * it, so nothing in the map reaches for that endpoint.
 */
export interface RawGpsPoint {
  time?: string;
  latitude?: number;
  longitude?: number;
  speedMilesPerHour?: number;
  /** Degrees clockwise from true north. Samsara reports `[0, 360)`; the column checks the same range. */
  headingDegrees?: number;
  /** Samsara's own flag for "this speed came from the ECU, not from GPS". Absent is not `false`. */
  isEcuSpeed?: boolean;
  reverseGeo?: { formattedLocation?: string };
  decorations?: { obdOdometerMeters?: { value?: number }; gpsOdometerMeters?: { value?: number } };
}
interface RawFuelPercentPoint {
  time?: string;
  value?: number; // tank level as a percentage (0..100)
}
export interface RawVehicleStats {
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
      const gps =
        obd != null
          ? undefined
          : (p.decorations?.gpsOdometerMeters?.value ??
            nearestGpsOdo(parseAsUtcMs(p.time!)) ??
            undefined);
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

// ── The live map's fix: where a truck is RIGHT NOW (LIVE-MAP-PLAN.md LM4) ───────────────────────

/**
 * One position, cleaned. The shape `vehicle_positions` stores and the map draws.
 *
 * A fix is only ever the LATEST one per truck — this product keeps no history of positions and
 * `vehicle_positions` has no way to store a second row (0341's header is the owner's ruling and the
 * reasoning). So there is no `GpsFix[]` anywhere downstream of `latestGpsFix`, deliberately.
 */
export interface GpsFix {
  /** Vendor `gps.time` — when the truck was THERE, never when we heard about it. */
  time: string;
  lat: number;
  lng: number;
  headingDegrees: number | null;
  speedMph: number | null;
  /** Samsara's flag. `null` when the ping carried no speed at all — absent is not "not from the ECU". */
  isEcuSpeed: boolean | null;
  /** `reverseGeo.formattedLocation`, verbatim. No external geocoder is involved anywhere in this path. */
  formattedLocation: string | null;
}

/** A heading Samsara could actually have meant: `[0, 360)`, matching the column's own check. */
const isHeading = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 360;

/**
 * Merge one `types=gps` FEED page into an accumulator keyed by Samsara vehicle id.
 *
 * ⚠ This reads the FEED shape, where `gps` is an ARRAY of pings. The SNAPSHOT
 * (`GET /fleet/vehicles/stats?types=gps`) returns `gps` as a SINGULAR object, and
 * `parseVehicleGpsSnapshots` in `entities.ts` is the parser for that one. Pointing either at the
 * other's payload yields `undefined` for every truck, silently — which is precisely why
 * `statsFeed.ts`'s header argues for two functions rather than one defensive one, and why this is a
 * third function rather than a flag on an existing one.
 *
 * A page carrying several pings for one truck is normal and is the point of a delta feed: they are all
 * kept here and resolved once, by `latestGpsFix`, after every page has been merged. Discarding all but
 * the last within a page would be wrong at a page boundary, where the newest ping for a truck can sit
 * on the earlier page.
 */
export function accumulateGpsFeedPage(
  page: StatsFeedPage,
  into: Map<string, GpsFix[]>,
): Map<string, GpsFix[]> {
  const rows = Array.isArray(page.data) ? (page.data as { id?: string | number; gps?: unknown }[]) : [];
  for (const v of rows) {
    if (v?.id == null || !Array.isArray(v.gps)) continue;
    const key = String(v.id);
    let fixes = into.get(key);
    if (!fixes) {
      fixes = [];
      into.set(key, fixes);
    }
    for (const p of v.gps as RawGpsPoint[]) {
      // A ping without a time or a coordinate is not a position. Dropped rather than coerced: a fix
      // defaulted to (0, 0) draws a truck in the Gulf of Guinea, and a fix defaulted to `now` makes a
      // stale one look live — the two failures the map is least able to survive.
      if (!p || typeof p.time !== "string" || !Number.isFinite(Date.parse(p.time))) continue;
      if (typeof p.latitude !== "number" || typeof p.longitude !== "number") continue;
      if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
      const speed = typeof p.speedMilesPerHour === "number" && Number.isFinite(p.speedMilesPerHour)
        ? p.speedMilesPerHour
        : null;
      fixes.push({
        time: p.time,
        lat: p.latitude,
        lng: p.longitude,
        headingDegrees: isHeading(p.headingDegrees) ? p.headingDegrees : null,
        speedMph: speed,
        // Tied to the speed on purpose: the flag is a statement ABOUT a speed, so claiming `false`
        // for a ping that carried no speed would invent a measurement (the D-LM12 lesson, and the
        // reason the column is nullable in 0341).
        isEcuSpeed: speed == null ? null : p.isEcuSpeed === true,
        formattedLocation:
          typeof p.reverseGeo?.formattedLocation === "string" && p.reverseGeo.formattedLocation.trim()
            ? p.reverseGeo.formattedLocation
            : null,
      });
    }
  }
  return into;
}

/**
 * The one fix a truck's row should carry: the NEWEST by vendor time, across every page of the run.
 *
 * Ties go to the fix seen last. Samsara does not mint two pings for one truck at one instant, so the
 * rule only has to be deterministic, not clever.
 */
export function latestGpsFix(fixes: readonly GpsFix[]): GpsFix | null {
  let best: GpsFix | null = null;
  let bestMs = -Infinity;
  for (const f of fixes) {
    const t = Date.parse(f.time);
    if (!Number.isFinite(t) || t < bestMs) continue;
    best = f;
    bestMs = t;
  }
  return best;
}

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

