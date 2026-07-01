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
}

/** Parse one vehicle's stats-history (types=gps, decorations=obdOdometerMeters) into samples. */
export function parseSamsaraSamples(vehicle: RawVehicleStats): SamsaraSample[] {
  return (vehicle.gps ?? [])
    .filter((p) => p.time && p.latitude != null && p.longitude != null)
    .map((p) => {
      const meters = p.decorations?.obdOdometerMeters?.value ?? p.decorations?.gpsOdometerMeters?.value;
      return {
        time: p.time!,
        lat: p.latitude!,
        lng: p.longitude!,
        speedMph: p.speedMilesPerHour ?? null,
        address: p.reverseGeo?.formattedLocation ?? null,
        odometerMiles: meters != null ? metersToMiles(meters) : null,
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
  if (!s) return null;
  return s === efsState.trim().toUpperCase();
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

/** Approximate the fueling instant (ms, UTC) from the report's naive-UTC time + the station state. */
export function approxFuelingUtcMs(posNaiveIso: string, state: string | null): number {
  const base = parseAsUtcMs(posNaiveIso);
  const off = state ? STATE_UTC_OFFSET[state.trim().toUpperCase()] : undefined;
  return off != null ? base + off * 3_600_000 : base;
}

export interface FuelingStopMatch {
  /** Samsara odometer (miles) at the confirmed fueling stop — the ±5 reference. Null if unresolved. */
  odometerMiles: number | null;
  /** Samsara time of that stop (real fueling instant). */
  matchedAt: string | null;
  /** true = truck was stopped in the EFS state; false = confidently elsewhere; null = can't tell. */
  locationMatched: boolean | null;
}

/**
 * Anchor on the PHYSICAL stop, not the timestamp's time zone (docs/10 §12). Among stopped samples that
 * carry an odometer + a reverse-geocoded state, keep those whose state matches the EFS station's state,
 * then pick the one closest to the approximate fueling time. That stop's odometer is the true odometer
 * at fueling — reliable regardless of the report's local-vs-UTC time. When no stop is in the EFS state
 * but the truck was clearly stopped elsewhere that window, it's a real location mismatch.
 */
export function matchFuelingStop(
  samples: SamsaraSample[],
  efs: { state: string | null },
  posNaiveIso: string,
  opts: { stoppedMph?: number } = {},
): FuelingStopMatch {
  const stoppedMax = opts.stoppedMph ?? 5;
  const efsState = efs.state?.trim().toUpperCase() || null;
  const target = approxFuelingUtcMs(posNaiveIso, efsState);
  const nearest = (list: SamsaraSample[]) =>
    list.sort(
      (a, b) => Math.abs(new Date(a.time).getTime() - target) - Math.abs(new Date(b.time).getTime() - target),
    )[0]!;

  const stopped = samples.filter((s) => (s.speedMph ?? 0) <= stoppedMax && s.odometerMiles != null && s.address);

  if (efsState) {
    const inState = stopped.filter((s) => stateFromAddress(s.address) === efsState);
    if (inState.length) {
      const pick = nearest(inState);
      return { odometerMiles: pick.odometerMiles, matchedAt: pick.time, locationMatched: true };
    }
    // No stop in the EFS state: only call it a mismatch if we actually saw the truck stopped somewhere
    // with a resolvable state (i.e., we have real coverage) — otherwise it's just unknown.
    const sawElsewhere = stopped.some((s) => stateFromAddress(s.address) != null);
    return { odometerMiles: null, matchedAt: null, locationMatched: sawElsewhere ? false : null };
  }

  // No EFS state to match on → best-effort odometer from the nearest stop; location unknown.
  if (stopped.length) {
    const pick = nearest(stopped);
    return { odometerMiles: pick.odometerMiles, matchedAt: pick.time, locationMatched: null };
  }
  return { odometerMiles: null, matchedAt: null, locationMatched: null };
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
