import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeFleetMpg,
  zonedWallTimeToUtcIso,
  type FleetMilesSource,
  type FleetMpg,
} from "@silvicom/shared";
import { eachPage } from "../../lib/paging.js";
import { organizationTimezone } from "../idle/index.js";
import { readFleetDistance } from "../samsara/index.js";

/**
 * The fleet's miles per gallon, assembled (M3, D-MPG1).
 *
 * One reader for a number eight surfaces print. It pairs a MEASURED distance with the fuel that
 * distance burned and calls `computeFleetMpg`; the arithmetic and every refusal live there, and the
 * miles come from `samsara`'s own reader over its own staging (D-SEP1). This file's whole job is the
 * pairing, and the pairing is where the remaining judgement is.
 *
 * ── THE PAIRING RULE, AND WHY IT IS AN INTERSECTION ─────────────────────────────────────────────
 * Miles and gallons are summed over **the same trucks**: those with a measured distance AND fuel in
 * the period. That is not fastidiousness, it is the only pairing that cannot lie in one direction:
 *
 *  · A truck with miles and no fuel (it ran on what was already in the tank) would add distance to
 *    the numerator with nothing in the denominator — MPG reads high.
 *  · A truck with fuel and no measured miles would add fuel with no distance — MPG reads low, which
 *    is the failure D-MPG4's coverage floor exists to catch and is worth never creating on purpose.
 *
 * Both trucks are still COUNTED. The second appears in `trucksUnmeasured` and its gallons stay in
 * the period's total, so `measuredShare` tells the reader exactly how much of the fleet's fuel the
 * figure speaks for. Nothing is dropped quietly; things are dropped loudly or not at all.
 *
 * ── THE TANK BOUNDARY, WHICH IS REAL AND IS NOT SOLVED HERE ────────────────────────────────────
 * Fuel is bought in one instant and burned over the following days, so a period's purchases are not
 * exactly its consumption. Over a month the two ends cancel to second order on a steady fleet; over
 * a single day they do not, and a caller asking for one day is asking a question the data cannot
 * answer well. `measuredShare` does not detect this — it is a coverage figure, not a timing one — so
 * it is stated here rather than papered over. The fix, if it is ever needed, is tank-level
 * reconciliation (the fuel module already models it), not a fudge in this file.
 *
 * ── WHY TRACTOR GALLONS AND NOT ALL GALLONS (D-MPG5) ───────────────────────────────────────────
 * Reefer fuel runs a refrigeration unit and DEF is an emissions consumable; neither moves a truck.
 * They are excluded by reading `gallons_tractor` explicitly rather than by relying on the fact that
 * reefer fills happen to carry no `computed_mpg` today — measured 2026-07, that coincidence makes no
 * difference to two decimal places, which is exactly why it must not be what the exclusion rests on.
 */

export interface FleetMpgResult extends FleetMpg {
  /** The period, echoed back as the caller's own days. */
  from: string;
  to: string;
  /** The fleet clock the days were resolved on — the boundary both sources were cut at. */
  timezone: string;
  /** Trucks that bought fuel in the period. The population `truckCoverage` is a share of. */
  trucksFuelled: number;
  /** Tractor gallons on fills we could not attribute to any truck (D-FS2). Part of `gallons`, never of `gallonsWithMiles`. */
  unattributedGallons: number;
  /** Odometer readings the window held, lookback included. Zero means the collector has not run yet. */
  readings: number;
}

interface GallonsByVehicle {
  byVehicle: Map<string, number>;
  /** Fills with no truck. Real fuel, no possible distance — it can only ever be uncovered. */
  unattributed: number;
  total: number;
}

/**
 * Tractor gallons per truck over `[from, to]` inclusive, from this module's own rollup.
 *
 * `fuel_spend_days` is fuel-spend's table, so this is a read of its own staging rather than a reach
 * across a boundary. `vehicle_id` is nullable by design (D-FS2 — a fill we could not attribute is
 * never dropped and never guessed), and those gallons are kept separately: they belong in the
 * period's total, and they can never have a mile behind them.
 */
async function readTractorGallons(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<GallonsByVehicle> {
  const byVehicle = new Map<string, number>();
  let unattributed = 0;
  let total = 0;
  await eachPage<{ vehicle_id: string | null; gallons_tractor: number | string }>(
    (a, b) =>
      admin
        .from("fuel_spend_days")
        .select("vehicle_id, gallons_tractor")
        // The service role bypasses RLS; this is the only tenant boundary on the read.
        .eq("org_id", orgId)
        .gte("day", from)
        .lte("day", to)
        .order("day", { ascending: true })
        .range(a, b),
    (rows) => {
      for (const r of rows) {
        const gallons = Number(r.gallons_tractor) || 0;
        if (gallons <= 0) continue;
        total += gallons;
        if (r.vehicle_id == null) unattributed += gallons;
        else byVehicle.set(r.vehicle_id, (byVehicle.get(r.vehicle_id) ?? 0) + gallons);
      }
    },
  );
  return { byVehicle, unattributed, total };
}

/** The fleet's operating clock — the boundary both the odometer slots and the spend days are cut on. */
async function readTimezone(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await admin
    .from("organizations")
    .select("operating_hours")
    .eq("id", orgId)
    .maybeSingle();
  return organizationTimezone(data?.operating_hours);
}

const nextDay = (ymd: string): string =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Fleet MPG for `[from, to]`, both inclusive calendar days on the fleet's own clock.
 *
 * The days become instants on that clock before they reach the odometer reader, because a reading is
 * an instant and a spend day is a date: resolving them on the server's timezone instead would cut
 * the two sources at different moments and put a few hours of driving on the wrong side of a month
 * end. `to` is exclusive at the START of the day after, which is what makes an inclusive `to` mean
 * the whole of that day.
 */
export async function getFleetMpg(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<FleetMpgResult> {
  const tz = await readTimezone(admin, orgId);
  const fromIso = zonedWallTimeToUtcIso(from, "00:00:00", tz);
  const toIso = zonedWallTimeToUtcIso(nextDay(to), "00:00:00", tz);

  const [distance, fuel] = await Promise.all([
    readFleetDistance(admin, orgId, fromIso, toIso),
    readTractorGallons(admin, orgId, from, to),
  ]);

  const measuredMiles = new Map<string, number>();
  for (const v of distance.perVehicle) {
    if (v.miles != null) measuredMiles.set(v.vehicleId, v.miles);
  }

  let miles = 0;
  let gallonsWithMiles = 0;
  let trucksMeasured = 0;
  let trucksUnmeasured = 0;
  for (const [vehicleId, gallons] of fuel.byVehicle) {
    const vehicleMiles = measuredMiles.get(vehicleId);
    if (vehicleMiles == null) {
      trucksUnmeasured += 1;
      continue;
    }
    miles += vehicleMiles;
    gallonsWithMiles += gallons;
    trucksMeasured += 1;
  }

  // `measured` while the odometer readings are the source. The label is not decoration: a caller
  // that cannot tell a measured mile from an allocated one cannot judge the figure (D-MPG1).
  const milesSource: FleetMilesSource = "measured";
  const mpg = computeFleetMpg({
    miles,
    milesSource,
    gallons: fuel.total,
    gallonsWithMiles,
    trucksMeasured,
    trucksUnmeasured,
  });

  return {
    ...mpg,
    from,
    to,
    timezone: tz,
    trucksFuelled: fuel.byVehicle.size,
    unattributedGallons: Math.round(fuel.unattributed * 100) / 100,
    readings: distance.readings,
  };
}
