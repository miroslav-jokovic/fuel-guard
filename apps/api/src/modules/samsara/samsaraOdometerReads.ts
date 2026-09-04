import type { SupabaseClient } from "@supabase/supabase-js";
import {
  distanceByVehicle,
  fleetDistance,
  type OdometerCounter,
  type VehicleDistance,
  type VehicleOdometerReading,
} from "@silvicom/shared";

/**
 * The collector's read interface over its own odometer staging (M2, D-SEP1 — nothing outside
 * `samsara` touches `samsara_odometer_readings`; the MPG harness asks HERE).
 *
 * It reads readings and hands them to `distanceByVehicle`, which does the subtracting. This file
 * does no arithmetic on metres beyond what the rule needs, and it never decides a period: both are
 * the caller's (D-FLEET9, D-MPG1).
 *
 * ── THE LOOKBACK IS THE WHOLE TRICK, AND GETTING IT WRONG IS A SILENT UNDERCOUNT ────────────────
 * A period's distance is `odometer(end) − odometer(start)`, where each end is **the last reading at
 * or before that instant** — what a dashboard odometer would have shown at that moment. The
 * collector keeps one reading per truck per day, late in the day, so the readings strictly INSIDE a
 * Monday-to-Monday week run Monday evening to Sunday evening: six days of driving reported as seven
 * days' worth, a 14% undercount that no total contradicts. W3a found that while building the rule
 * and fixed it there; the obligation it puts on every caller is to hand in readings from BEFORE the
 * period, and this is the caller.
 *
 * `LOOKBACK_DAYS` is how far before. Thirty days rather than a handful because the failure is
 * asymmetric: too short and a truck that was parked for a fortnight loses its opening odometer and
 * drops out of the fleet total entirely (reported as unmeasured, so at least it is visible — but it
 * is a truck we could have measured). Too long costs rows, and rows are nearly free here: one
 * reading per truck per day per counter is ~380 a day for this fleet, so thirty days of lookback is
 * ~11,000 rows.
 *
 * ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────────────────────────
 * It does not invent a population. A truck that staged no readings at all in the window simply does
 * not appear, and the caller — which knows which trucks bought fuel — is the one that can say
 * whether that absence matters. Returning a guessed roster from here would put a coverage decision
 * inside a reader.
 */

/** How far before the period's start to look for each truck's opening odometer. See the header. */
export const ODOMETER_LOOKBACK_DAYS = 30;

/** Rows per page. The identity index is (org, vehicle, source, day); paging is ordered by pk. */
const PAGE = 1000;

export interface FleetDistanceReading {
  vehicleId: string;
  readingAt: string;
  meters: number;
  source: OdometerCounter;
}

export interface FleetDistanceResult {
  /** Miles across every truck that could be measured. */
  miles: number;
  measuredVehicles: number;
  /** Trucks that staged readings but could not be measured over this period — counted, never zeroed. */
  unmeasuredVehicles: number;
  /** Per truck, with the counter used and the two instants differenced, so a figure can be checked. */
  perVehicle: VehicleDistance[];
  /** Readings the window actually held, including the lookback. Zero means the collector has not run. */
  readings: number;
  /** The instant the lookback began, so a caller can say what "no opening odometer" was measured against. */
  lookbackFrom: string;
}

interface ReadingRow {
  vehicle_id: string;
  reading_at: string;
  meters: number | string;
  source: string;
}

const isCounter = (s: string): s is OdometerCounter =>
  s === "obd" || s === "gps_distance" || s === "gps_odometer";

/**
 * Every truck's distance over `[fromIso, toIso)`, differenced from the readings Samsara asserted.
 *
 * `opts.lookbackDays` widens the search for each truck's OPENING odometer; it never widens the
 * period, which stays exactly what the caller asked for — `distanceByVehicle` bounds on the period's
 * own instants and ignores anything after `toIso`.
 */
export async function readFleetDistance(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
  opts: { lookbackDays?: number } = {},
): Promise<FleetDistanceResult> {
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    throw new RangeError("readFleetDistance needs two valid ISO instants");
  }
  if (toMs < fromMs) {
    throw new RangeError("readFleetDistance was given a period that ends before it starts");
  }
  const lookbackDays = opts.lookbackDays ?? ODOMETER_LOOKBACK_DAYS;
  const lookbackFrom = new Date(fromMs - lookbackDays * 86_400_000).toISOString();

  const readings: VehicleOdometerReading[] = [];
  for (let from = 0; ; from += PAGE) {
    // The service role bypasses RLS, so this `.eq("org_id", …)` is the only tenant boundary between
    // one carrier's odometers and another's.
    const { data, error } = await admin
      .from("samsara_odometer_readings")
      .select("vehicle_id, reading_at, meters, source")
      .eq("org_id", orgId)
      .gte("reading_at", lookbackFrom)
      .lte("reading_at", toIso)
      // Unordered `.range()` paging repeats and drops rows across pages — the lesson financialReads
      // learned the expensive way. Ordered by the identity's leading columns, which the unique index
      // already covers.
      .order("vehicle_id", { ascending: true })
      .order("reading_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`samsara_odometer_readings read failed: ${error.message}`);
    const rows = (data ?? []) as ReadingRow[];
    for (const r of rows) {
      const meters = Number(r.meters);
      // A row that fails either of these is a row the collector could not have written (0311 checks
      // both). Skipping rather than throwing keeps one corrupt row from costing a fleet its figure;
      // the count below still reports what the window held.
      if (!Number.isFinite(meters) || !isCounter(r.source)) continue;
      readings.push({
        vehicleId: r.vehicle_id,
        readingAt: r.reading_at,
        meters,
        source: r.source,
      });
    }
    if (rows.length < PAGE) break;
  }

  const perVehicle = distanceByVehicle(readings, fromIso, toIso);
  const fleet = fleetDistance(perVehicle);
  return {
    miles: fleet.miles,
    measuredVehicles: fleet.measuredVehicles,
    unmeasuredVehicles: fleet.unmeasuredVehicles,
    perVehicle,
    readings: readings.length,
    lookbackFrom,
  };
}
