/** Samsara entity parsing: vehicles, drivers, assignments, trailers. */
import { haversineMiles } from "../ai.js";
import { metersToMiles } from "./core.js";

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
export function parseVehicleFuelPercents(response: {
  data?: RawVehicleStat[];
}): Map<string, VehicleFuelLevel> {
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
export function parseVehicleStatsOdometer(response: {
  data?: RawVehicleStat[];
}): Map<string, number> {
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

export interface AssignmentInterval {
  vehicleSamsaraId: string;
  driverSamsaraId: string;
  startMs: number;
  endMs: number | null; // null = open / ongoing
}

/** Parse driver-vehicle-assignments into time-ranged INTERVALS (not collapsed to the latest), so an idle event
 *  without a Samsara operator can be attributed to whoever had the truck at that time. Tolerant of the flat and
 *  grouped shapes, same as parseCurrentAssignments. */
export function parseAssignmentIntervals(response: {
  data?: RawAssignmentGroup[];
}): AssignmentInterval[] {
  const out: AssignmentInterval[] = [];
  const push = (vehicleId: string | undefined, a: RawAssignment) => {
    const driverId = assignmentDriverId(a);
    if (!vehicleId || !driverId) return;
    const startMs = a.startTime ? new Date(a.startTime).getTime() : NaN;
    if (!Number.isFinite(startMs)) return;
    const endRaw = a.endTime ? new Date(a.endTime).getTime() : null;
    out.push({
      vehicleSamsaraId: String(vehicleId),
      driverSamsaraId: String(driverId),
      startMs,
      endMs: endRaw != null && Number.isFinite(endRaw) ? endRaw : null,
    });
  };
  for (const g of response.data ?? []) {
    const nested = g.assignments ?? g.driverAssignments;
    if (nested) {
      const vehicleId = g.vehicle?.id ?? g.vehicleId ?? g.id;
      for (const a of nested) push(vehicleId, a);
    } else if (assignmentDriverId(g)) {
      push(g.vehicle?.id ?? g.vehicleId, g);
    }
  }
  return out;
}

/** A driver↔vehicle observation from a Samsara idle event's operator (both are Samsara ids). */
export interface OperatorObservation {
  vehicleSamsaraId: string;
  driverSamsaraId: string;
  startMs: number;
  endMs: number; // start + duration
}

/**
 * Collapse operator-tagged idle events into contiguous driver↔vehicle assignment INTERVALS — the durable
 * source of driver attribution when Samsara's formal driver-vehicle-assignments feed is sparse but every idle
 * event still carries an `operator`. Per vehicle: sort by time, merge consecutive same-driver events into a
 * run, then make the runs contiguous (each driver "holds" the truck until the next different-driver event —
 * last-known-driver), leaving the final run open-ended (current driver). Pure + deterministic (input order
 * independent). Feed the result into driver_vehicle_assignments alongside the endpoint-derived intervals.
 */
export function mergeOperatorAssignments(events: OperatorObservation[]): AssignmentInterval[] {
  const byVeh = new Map<string, OperatorObservation[]>();
  for (const e of events) {
    if (!e.vehicleSamsaraId || !e.driverSamsaraId || !Number.isFinite(e.startMs)) continue;
    const arr = byVeh.get(e.vehicleSamsaraId) ?? [];
    arr.push(e);
    byVeh.set(e.vehicleSamsaraId, arr);
  }
  const out: AssignmentInterval[] = [];
  for (const [veh, evs] of byVeh) {
    evs.sort((a, b) => a.startMs - b.startMs || a.driverSamsaraId.localeCompare(b.driverSamsaraId));
    const runs: { driver: string; start: number; end: number }[] = [];
    for (const e of evs) {
      const end = Number.isFinite(e.endMs) && e.endMs > e.startMs ? e.endMs : e.startMs;
      const last = runs[runs.length - 1];
      if (last && last.driver === e.driverSamsaraId) last.end = Math.max(last.end, end);
      else runs.push({ driver: e.driverSamsaraId, start: e.startMs, end });
    }
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i]!;
      // Hold until the next run starts; the newest run stays open (current driver).
      const endMs = i < runs.length - 1 ? runs[i + 1]!.start : null;
      out.push({ vehicleSamsaraId: veh, driverSamsaraId: r.driver, startMs: r.start, endMs });
    }
  }
  return out;
}

/** Which driver had a vehicle at `whenMs`? Prefer the interval that COVERS the time; otherwise the most recent
 *  interval that started before it (last-known driver), but only if within `maxStaleMs` (default 24h) so we don't
 *  attribute an idle to a driver who left the truck days ago. Returns the Samsara driver id, or null. */
export function matchAssignmentAt(
  intervals: AssignmentInterval[],
  vehicleSamsaraId: string,
  whenMs: number,
  opts: { maxStaleMs?: number } = {},
): string | null {
  const maxStale = opts.maxStaleMs ?? 24 * 3_600_000;
  let covering: AssignmentInterval | null = null;
  let lastBefore: AssignmentInterval | null = null;
  for (const iv of intervals) {
    if (iv.vehicleSamsaraId !== vehicleSamsaraId) continue;
    if (whenMs >= iv.startMs && (iv.endMs == null || whenMs <= iv.endMs)) {
      if (!covering || iv.startMs > covering.startMs) covering = iv;
    } else if (iv.startMs <= whenMs) {
      if (!lastBefore || iv.startMs > lastBefore.startMs) lastBefore = iv;
    }
  }
  if (covering) return covering.driverSamsaraId;
  if (lastBefore) {
    const ref = lastBefore.endMs ?? lastBefore.startMs;
    if (whenMs - ref <= maxStale) return lastBefore.driverSamsaraId;
  }
  return null;
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
const assocStart = (a: RawAssoc): number =>
  a.assignedAtMs != null ? a.assignedAtMs : new Date(a.startTime ?? 0).getTime();

/**
 * Parse trailer↔tractor assignments into each trailer's CURRENT tractor (latest start). Tolerant of:
 *  - v1 `{ trailers: [{ id, currentAssociation: { tractorId, assignedAtMs } }] }`
 *  - v2/grouped `{ data: [{ trailer:{id}, assignments:[{ vehicleId, startTime }] }] }`
 *  - flat `{ data: [{ trailer:{id}, vehicle:{id}, startTime }] }`
 */
export function parseTrailerAssignments(response: {
  trailers?: RawTrailerAssignment[];
  data?: RawTrailerAssignment[];
}): TrailerVehicleLink[] {
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
      const trailerId =
        g.trailer?.id != null
          ? String(g.trailer.id)
          : g.trailerId != null
            ? String(g.trailerId)
            : g.id != null
              ? String(g.id)
              : undefined;
      for (const a of g.assignments) consider(trailerId, a);
    } else {
      const trailerId =
        g.trailer?.id != null
          ? String(g.trailer.id)
          : g.trailerId != null
            ? String(g.trailerId)
            : undefined;
      if (assocTractorId(g)) consider(trailerId, g);
    }
  }

  return [...latest.entries()].map(([trailerSamsaraId, v]) => ({
    trailerSamsaraId,
    vehicleSamsaraId: v.vehicleId,
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
