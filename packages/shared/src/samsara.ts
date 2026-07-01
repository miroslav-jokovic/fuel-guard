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
    const p = v.fuelPercents?.value;
    if (p != null && p >= 0 && p <= 100) {
      out.set(String(v.id), { percent: Math.round(p * 10) / 10, time: v.fuelPercents?.time ?? null });
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
 * Parse `GET /fleet/driver-vehicle-assignments?filterBy=vehicles` into current vehicle→driver links.
 * Keeps the assignment active at `nowIso` (no endTime, or an endTime still in the future) with the
 * latest start. Tolerant of both shapes Samsara may return: a vehicle GROUP with a nested
 * `assignments`/`driverAssignments` array, or a FLAT row with the driver + times on the item itself.
 */
export function parseCurrentAssignments(
  response: { data?: RawAssignmentGroup[] },
  nowIso: string,
): VehicleDriverLink[] {
  const now = new Date(nowIso).getTime();
  const out: VehicleDriverLink[] = [];
  for (const g of response.data ?? []) {
    const nested = g.assignments ?? g.driverAssignments;
    let vehicleId: string | undefined;
    let list: RawAssignment[];
    if (nested) {
      vehicleId = g.vehicle?.id ?? g.vehicleId ?? g.id; // grouped-by-vehicle: g.id is the vehicle id
      list = nested;
    } else if (assignmentDriverId(g)) {
      vehicleId = g.vehicle?.id ?? g.vehicleId; // flat row: don't treat g.id as a vehicle id
      list = [g];
    } else {
      continue;
    }
    if (!vehicleId) continue;

    const active = list.filter((a) => !a.endTime || new Date(a.endTime).getTime() >= now);
    if (active.length === 0) continue;
    const pick = active.sort(
      (a, b) => new Date(b.startTime ?? 0).getTime() - new Date(a.startTime ?? 0).getTime(),
    )[0]!;
    const driverId = assignmentDriverId(pick);
    if (driverId) out.push({ vehicleSamsaraId: String(vehicleId), driverSamsaraId: String(driverId) });
  }
  return out;
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
