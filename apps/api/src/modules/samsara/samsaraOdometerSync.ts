import type { SupabaseClient } from "@supabase/supabase-js";
import {
  lastReadingEachDay,
  type OdometerCounter,
  type OdometerStatSample,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { organizationTimezone } from "../idle/index.js";
import { loadSamsaraToken } from "./lib/samsaraToken.js";
import type { SamsaraNumericStatEvent } from "./lib/samsara.js";
import {
  makeSamsaraOdometerFetcher,
  type OdometerHistoryFetcher,
  type SamsaraOdometerVehicleRecord,
} from "./lib/samsaraOdometer.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";

/**
 * Stage Samsara's cumulative odometer counters as READINGS (W3b, D-FLEET9).
 *
 * ── THIS COLLECTOR MEASURES NO DISTANCE, AND THAT IS THE WHOLE DESIGN ───────────────────────────
 * It resolves a token, fetches the counter history, joins Samsara's vehicle id to ours, keeps the
 * last reading of each local day per counter, and writes metres at the vendor's own instant. It
 * never subtracts. "The ECU read 663,428,113 metres at 23:50:04" is a fact Samsara asserts; "412
 * miles on 3 July" is a subtraction across a boundary somebody chose, and choosing it here would put
 * a reporting decision inside an extraction layer — the exact mistake W1 exists to undo for the
 * general ledger. `distanceByVehicle` (packages/shared/src/tmsCost/vehicleDistance.ts) owns the
 * arithmetic, the source ranking and the three refusals.
 *
 * ── WHY IT WRITES ONLY TWO OF THE THREE COUNTERS ───────────────────────────────────────────────
 * Samsara ranks them `obdOdometerMeters` → `gpsDistanceMeters` → `gpsOdometerMeters`, and the third
 * is GPS distance added to a value somebody typed into the vendor's console. Its accuracy is
 * therefore a property of that typing, not of the fleet, and requesting it would spend a third of the
 * per-request type budget on the counter the rule is least likely to reach. The schema and the
 * shared vocabulary both keep `gps_odometer` legal (migration 0311), so a later decision to collect
 * it is a change here and not a migration.
 *
 * ── AN INCOMPLETE FETCH REFUSES TO WRITE ───────────────────────────────────────────────────────
 * Truncation is worse for this collector than for most: it keeps the LAST reading of each day, so a
 * page-capped walk does not thin the data evenly — it removes precisely the readings that would have
 * been kept, and the rows it does write look entirely healthy while reporting an earlier odometer.
 * So the batch throws, the job fails visibly, and the next tick re-fetches the same window.
 *
 * ── THE WINDOW IS ROLLING, AND RE-COLLECTION IS THE POINT ──────────────────────────────────────
 * The day in progress has a "last reading so far", which the next run replaces. The upsert is keyed
 * on (org, vehicle, source, day), so a re-run of any window converges rather than duplicating, and a
 * missed tick costs nothing as long as the window is wider than the gap.
 */

/**
 * How far back each tick re-collects. Four days covers one skipped run plus a margin, at a cost of
 * roughly four days × two counters per truck per tick — bounded, because only one row per day per
 * counter is ever stored regardless of how many samples the window contained.
 */
export const ODOMETER_SOURCE_WINDOW_DAYS = 4;

/** Trucks per stats-history call. Matches the idle capability sync; keeps each request bounded. */
const BATCH = 20;

/** How many staged rows go in one write. PostgREST is happier with bounded payloads than with one. */
const WRITE_CHUNK = 500;

/**
 * Samsara's series name → the counter vocabulary the distance rule and migration 0311 share. Read
 * from one place because a second spelling of "obd" would not fail anything; it would simply file
 * readings the rule never looks at.
 */
const COUNTER_SERIES: ReadonlyArray<{
  counter: OdometerCounter;
  read: (record: SamsaraOdometerVehicleRecord) => SamsaraNumericStatEvent[] | undefined;
}> = [
  { counter: "obd", read: (r) => r.obdOdometerMeters },
  { counter: "gps_distance", read: (r) => r.gpsDistanceMeters },
];

export interface OdometerSyncResult {
  /** Trucks with a Samsara id — the population the window was asked for. */
  vehicles: number;
  /** Trucks Samsara returned at least one usable reading for. */
  vehiclesWithData: number;
  /** Trucks that reported nothing in the window. Counted, never inferred as zero miles. */
  vehiclesWithoutData: number;
  /** Rows staged, across every truck and both counters. */
  readings: number;
  /** Rows staged per counter — the fleet's ECU coverage, visible without a second query. */
  obdReadings: number;
  gpsDistanceReadings: number;
  batches: number;
  windowDays: number;
}

export interface OdometerSyncOptions {
  /** Widen the rolling window — how a backfill is run without a second code path. */
  sinceDays?: number;
  /** Window end (default now), so a chunked historical slice can be an explicit range. */
  endIso?: string;
  /** Injected in tests; the real fetcher is built from the org's token. */
  fetcherOverride?: OdometerHistoryFetcher;
}

interface VehicleRow {
  id: string;
  samsara_vehicle_id: string;
}

interface StagedReading {
  org_id: string;
  vehicle_id: string;
  source: OdometerCounter;
  day: string;
  reading_at: string;
  meters: number;
  tz_offset_minutes: number;
  synced_at: string;
}

/** Samsara's `{time, value}` pairs, read as the shared rule's sample shape. */
function toSamples(events: SamsaraNumericStatEvent[] | undefined): OdometerStatSample[] {
  const out: OdometerStatSample[] = [];
  for (const e of events ?? []) {
    if (typeof e.time !== "string" || typeof e.value !== "number") continue;
    out.push({ time: e.time, meters: e.value });
  }
  return out;
}

function stageVehicle(
  orgId: string,
  vehicleId: string,
  record: SamsaraOdometerVehicleRecord | undefined,
  orgTz: string,
  nowIso: string,
): StagedReading[] {
  if (!record) return [];
  const rows: StagedReading[] = [];
  for (const { counter, read } of COUNTER_SERIES) {
    for (const reading of lastReadingEachDay(toSamples(read(record)), orgTz)) {
      rows.push({
        org_id: orgId,
        vehicle_id: vehicleId,
        source: counter,
        day: reading.day,
        reading_at: reading.readingAt,
        meters: reading.meters,
        tz_offset_minutes: reading.tzOffsetMinutes,
        synced_at: nowIso,
      });
    }
  }
  return rows;
}

async function writeReadings(
  admin: SupabaseClient,
  rows: StagedReading[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    // A FULL payload on a COMPOSITE conflict target — every NOT NULL column of 0311 that has no
    // default is present, so this is a legitimate insert-or-replace rather than the partial upsert
    // `lint:upserts` forbids (Postgres checks NOT NULL before conflict arbitration).
    const { error } = await admin
      .from("samsara_odometer_readings")
      .upsert(rows.slice(i, i + WRITE_CHUNK), { onConflict: "org_id,vehicle_id,source,day" });
    if (error) throw new Error(`Could not stage odometer readings: ${error.message}`);
  }
}

export async function syncVehicleOdometerReadings(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  options: OdometerSyncOptions = {},
): Promise<OdometerSyncResult> {
  const token = options.fetcherOverride ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  // The service role bypasses RLS, so this `.eq("org_id", …)` is the only tenant boundary between
  // one carrier's odometers and another's.
  const { data: vehicleRows, error: vehErr } = await admin
    .from("vehicles")
    .select("id, samsara_vehicle_id")
    .eq("org_id", orgId)
    .not("samsara_vehicle_id", "is", null);
  if (vehErr) throw new Error(`Could not read vehicles: ${vehErr.message}`);
  const vehicles = ((vehicleRows ?? []) as VehicleRow[]).filter((v) => v.samsara_vehicle_id);

  const windowDays = options.sinceDays ?? ODOMETER_SOURCE_WINDOW_DAYS;
  if (vehicles.length === 0) {
    return {
      vehicles: 0,
      vehiclesWithData: 0,
      vehiclesWithoutData: 0,
      readings: 0,
      obdReadings: 0,
      gpsDistanceReadings: 0,
      batches: 0,
      windowDays,
    };
  }

  // The day is a SLOT cut on the fleet's operating clock — the same boundary vehicle_engine_days
  // uses, borrowed from the idle pipeline rather than re-derived (the "fuel -> idle" edge already
  // does this for price days).
  const { data: orgRow } = await admin
    .from("organizations")
    .select("operating_hours")
    .eq("id", orgId)
    .maybeSingle();
  const orgTz = organizationTimezone(orgRow?.operating_hours);

  const endMs = options.endIso != null ? Date.parse(options.endIso) : Date.now();
  if (!Number.isFinite(endMs)) {
    throw new RangeError("Odometer sync endIso must be a valid ISO timestamp");
  }
  const endIso = new Date(endMs).toISOString();
  const startIso = new Date(endMs - windowDays * 86_400_000).toISOString();
  const fetcher = options.fetcherOverride ?? makeSamsaraOdometerFetcher(env, token);
  const nowIso = new Date().toISOString();

  let vehiclesWithData = 0;
  let vehiclesWithoutData = 0;
  let obdReadings = 0;
  let gpsDistanceReadings = 0;
  let batches = 0;

  for (let i = 0; i < vehicles.length; i += BATCH) {
    const batch = vehicles.slice(i, i + BATCH);
    const fetched = await fetcher(
      batch.map((v) => v.samsara_vehicle_id),
      startIso,
      endIso,
    );
    if (!fetched.complete) {
      throw new Error(
        `Samsara odometer history was truncated after ${fetched.pages} pages for org ${orgId}; no readings were staged for this batch`,
      );
    }
    batches += 1;
    const bySamsaraId = new Map<string, SamsaraOdometerVehicleRecord>();
    for (const record of fetched.data) bySamsaraId.set(String(record.id ?? ""), record);

    const rows: StagedReading[] = [];
    for (const vehicle of batch) {
      const staged = stageVehicle(
        orgId,
        vehicle.id,
        bySamsaraId.get(vehicle.samsara_vehicle_id),
        orgTz,
        nowIso,
      );
      // A truck that reported nothing writes NO ROW — not a zero. History thins at the old edge
      // (10.8% no_data at 2026-01), and a zero-metre reading reads as a counter that reset, which is
      // a hardware event the distance rule is right to refuse.
      if (staged.length > 0) vehiclesWithData += 1;
      else vehiclesWithoutData += 1;
      for (const row of staged) {
        if (row.source === "obd") obdReadings += 1;
        else gpsDistanceReadings += 1;
      }
      rows.push(...staged);
    }
    await writeReadings(admin, rows);
  }

  return {
    vehicles: vehicles.length,
    vehiclesWithData,
    vehiclesWithoutData,
    readings: obdReadings + gpsDistanceReadings,
    obdReadings,
    gpsDistanceReadings,
    batches,
    windowDays,
  };
}
