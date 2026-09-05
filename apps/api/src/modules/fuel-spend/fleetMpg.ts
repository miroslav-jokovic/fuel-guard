import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeFleetMpg,
  periodBounds,
  zonedWallTimeToUtcIso,
  type FleetMilesSource,
  type FleetMpgPeriod,
  type FleetMpgSeries,
  type SpendGrain,
} from "@silvicom/shared";
import { eachPage } from "../../lib/paging.js";
import { organizationTimezone } from "../idle/index.js";
import { readFleetDistancePeriods, type FleetDistanceResult } from "../samsara/index.js";

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

/**
 * The wire shape is `FleetMpgPeriod` in `@silvicom/shared` — one home for a contract the API writes
 * and the web reads (CLAUDE.md, `lint:shared-contracts`). The alias is kept because every caller in
 * this app already names it, and renaming a type is not what this step is for.
 */
export type FleetMpgResult = FleetMpgPeriod;
export type { FleetMpgSeries } from "@silvicom/shared";

/**
 * Trucks the caller wants the figure for, or `null` for the whole fleet.
 *
 * An EMPTY array is not the same as `null` and must not be collapsed into it: it is "the units you
 * named are not in this fleet", which has a correct answer (no trucks, no fuel, no figure) and is
 * the answer a filtered screen showing nothing needs to agree with. The same distinction
 * `fuel_range_totals` draws for `p_vehicles` (FUEL-P1).
 */
export type VehicleScope = readonly string[] | null;

interface GallonsByVehicle {
  byVehicle: Map<string, number>;
  /** Fills with no truck. Real fuel, no possible distance — it can only ever be uncovered. */
  unattributed: number;
  total: number;
}

/** One truck-day of tractor fuel, kept at day grain so a series can bucket it without a second read. */
interface GallonDay {
  day: string;
  vehicleId: string | null;
  gallons: number;
}

/**
 * Tractor gallons per truck-day over `[from, to]` inclusive, from this module's own rollup.
 *
 * `fuel_spend_days` is fuel-spend's table, so this is a read of its own staging rather than a reach
 * across a boundary. `vehicle_id` is nullable by design (D-FS2 — a fill we could not attribute is
 * never dropped and never guessed), and those rows are kept: they belong in the period's total, and
 * they can never have a mile behind them.
 *
 * Rows come back at DAY grain rather than pre-summed per truck so that a weekly series folds them
 * itself (D-MPG6) instead of asking the database once per week. The fold is `foldGallons` below, and
 * it is the same fold whether there is one bucket or six.
 */
async function readTractorGallonDays(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
  vehicles: VehicleScope,
): Promise<GallonDay[]> {
  // An explicitly empty scope names no truck, so there is nothing to read and nothing to sum. Asking
  // PostgREST for `.in("vehicle_id", [])` would answer the same, but only by accident of its
  // encoding; saying it here is what makes the empty case a decision rather than a coincidence.
  if (vehicles != null && vehicles.length === 0) return [];
  const out: GallonDay[] = [];
  await eachPage<{ day: string; vehicle_id: string | null; gallons_tractor: number | string }>(
    (a, b) => {
      const q = admin
        .from("fuel_spend_days")
        .select("day, vehicle_id, gallons_tractor")
        // The service role bypasses RLS; this is the only tenant boundary on the read.
        .eq("org_id", orgId)
        .gte("day", from)
        .lte("day", to);
      // A truck scope also drops the unattributed row, and that is right rather than convenient: a
      // fill with no truck is not one of the trucks the caller named, so counting its gallons would
      // charge a filtered figure with fuel outside the filter.
      return (vehicles == null ? q : q.in("vehicle_id", vehicles as string[]))
        .order("day", { ascending: true })
        .range(a, b);
    },
    (rows) => {
      for (const r of rows) {
        const gallons = Number(r.gallons_tractor) || 0;
        if (gallons <= 0) continue;
        out.push({ day: r.day, vehicleId: r.vehicle_id, gallons });
      }
    },
  );
  return out;
}

/** Fold truck-days whose `day` falls in `[from, to]` into the two totals the arithmetic needs. */
function foldGallons(days: readonly GallonDay[], from: string, to: string): GallonsByVehicle {
  const byVehicle = new Map<string, number>();
  let unattributed = 0;
  let total = 0;
  for (const r of days) {
    if (r.day < from || r.day > to) continue;
    total += r.gallons;
    if (r.vehicleId == null) unattributed += r.gallons;
    else byVehicle.set(r.vehicleId, (byVehicle.get(r.vehicleId) ?? 0) + r.gallons);
  }
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
 * A pair of inclusive calendar days as the two instants the odometer reader bounds on, cut on the
 * FLEET's clock. `to` becomes the START of the following local day, which is what makes an inclusive
 * `to` mean the whole of that day.
 */
const instants = (from: string, to: string, tz: string): { fromIso: string; toIso: string } => ({
  fromIso: zonedWallTimeToUtcIso(from, "00:00:00", tz),
  toIso: zonedWallTimeToUtcIso(nextDay(to), "00:00:00", tz),
});

/**
 * Pair one period's measured distance with the fuel it burned, and let `computeFleetMpg` judge.
 *
 * The intersection in the loop is the rule the header describes, and it is the only place either
 * total is decided. Everything above this function reads; everything below it buckets.
 */
function pairPeriod(
  distance: FleetDistanceResult,
  fuel: GallonsByVehicle,
  period: { from: string; to: string; timezone: string },
): FleetMpgResult {
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
    from: period.from,
    to: period.to,
    timezone: period.timezone,
    trucksFuelled: fuel.byVehicle.size,
    unattributedGallons: Math.round(fuel.unattributed * 100) / 100,
    readings: distance.readings,
  };
}

/**
 * The calendar buckets `[from, to]` covers at `grain`, oldest first, each CLAMPED to the window.
 *
 * Clamped for the reason `spendSeries` clamps: a report covering "to 2026-08-24" that prints a row
 * labelled "2026-08-24 – 2026-08-30" reads as a bug in the dates rather than as a week in progress.
 * A clamped bucket also asks the odometer reader for the days the caller actually asked about, so a
 * part-week's miles and its gallons cover the same days.
 */
function bucketWindow(from: string, to: string, grain: SpendGrain): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let cursor = from;
  while (cursor <= to) {
    const b = periodBounds(cursor, grain);
    out.push({ from: b.from < from ? from : b.from, to: b.to > to ? to : b.to });
    cursor = nextDay(b.to);
  }
  return out;
}

/**
 * Fleet MPG for `[from, to]`, both inclusive calendar days on the fleet's own clock.
 *
 * The days become instants on that clock before they reach the odometer reader, because a reading is
 * an instant and a spend day is a date: resolving them on the server's timezone instead would cut
 * the two sources at different moments and put a few hours of driving on the wrong side of a month
 * end. `to` is exclusive at the START of the day after, which is what makes an inclusive `to` mean
 * the whole of that day.
 *
 * `vehicles` narrows the figure to a named set of trucks — the Fuel log's own truck filter (FUEL-P1),
 * so the tile and the rows beneath it answer for the same trucks. `null` is the whole fleet.
 *
 * ⚠ A single DAY is a legal question and is answered rather than refused, but D-MPG6 measured what it
 * is worth: 1–3 September 2026 read 7.46, 6.90 and 6.38 over almost identical distances, because the
 * fleet filled more tanks on the third. That is the tank boundary in the header, not a change in
 * efficiency, and it is why no shipped surface asks this at day grain.
 */
export async function getFleetMpg(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
  vehicles: VehicleScope = null,
): Promise<FleetMpgResult> {
  const tz = await readTimezone(admin, orgId);
  const [[distance], gallonDays] = await Promise.all([
    readFleetDistancePeriods(admin, orgId, [instants(from, to, tz)]),
    readTractorGallonDays(admin, orgId, from, to, vehicles),
  ]);
  return pairPeriod(distance!, foldGallons(gallonDays, from, to), { from, to, timezone: tz });
}

/**
 * The same figure for the window AND for each calendar bucket inside it — one read, many pairings.
 *
 * ── THE TOTAL IS NOT THE MEAN OF THE BUCKETS, AND MUST NOT BE ──────────────────────────────────
 * `total` is computed over the whole window as its own period: one odometer difference per truck
 * across the entire span, over the entire span's fuel. Summing the buckets' miles instead would be a
 * different measurement — every bucket edge cuts an interval, and a truck measurable across a month
 * is not necessarily measurable in each of its weeks, so the two populations differ. Averaging the
 * buckets' MPGs would be worse still: a mean of ratios, which is the error §1.1 of the plan spends a
 * paragraph establishing this module does not make.
 *
 * So a page showing a headline figure and a trend beneath it shows two honest measurements of the
 * same fleet at two grains, and the headline is not reconstructed from the picture.
 *
 * ── WHY THE GRAIN IS WEEK OR COARSER, IN THE TYPE ─────────────────────────────────────────────
 * D-MPG6 rules on what a surface may SHOW, and §2 adds that the API does not refuse a legal question
 * — which is why `getFleetMpg` still answers for a single day, with the caveat in its own header. A
 * daily SERIES is a different thing: it is not a period somebody asked about, it is the artefact the
 * ruling removed, and the dashboard's old trend hid the 17% three-day swing rather than avoiding it
 * because both sides of each day's ratio had been spread across the same interval. So the grain is
 * `"week" | "month"` in the contract, and a caller that wants a day asks `getFleetMpg` for that day.
 */
export async function getFleetMpgSeries(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
  grain: FleetMpgSeries["grain"],
  vehicles: VehicleScope = null,
): Promise<FleetMpgSeries> {
  const tz = await readTimezone(admin, orgId);
  const buckets = bucketWindow(from, to, grain);
  // The window itself leads, so `distances[0]` is the total and the buckets follow in order. One
  // fetch of the staging table covers all of them (M4, `readFleetDistancePeriods`).
  const windows = [{ from, to }, ...buckets];
  const [distances, gallonDays] = await Promise.all([
    readFleetDistancePeriods(admin, orgId, windows.map((w) => instants(w.from, w.to, tz))),
    readTractorGallonDays(admin, orgId, from, to, vehicles),
  ]);

  const paired = windows.map((w, i) =>
    pairPeriod(distances[i]!, foldGallons(gallonDays, w.from, w.to), { ...w, timezone: tz }),
  );
  return { total: paired[0]!, periods: paired.slice(1), grain };
}
