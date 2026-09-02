import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accumulateStatsFeedPage,
  feedPageHasData,
  findFuelLevelDrops,
  latestFuelLevel,
  latestOdometerMiles,
  resolveCapacity,
  TANK_FILL_MIN_TOLERANCE_GAL,
  type VehicleFeedSeries,
  type FuelLevelDrop,
  type VehicleView,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { loadSamsaraToken } from "./lib/samsaraToken.js";
import { makeSamsaraStatsFeedFetcher, type SamsaraStatsFeedFetcher } from "./lib/samsara.js";
import { NoSamsaraTokenError, writeVehicleTelematics } from "./samsaraVehicleSync.js";

/** The feed this tier owns. One row per (org, feed) in `samsara_feed_cursors` (migration 0288). */
export const VEHICLE_STATS_FEED = "vehicle_stats";

/**
 * Runaway guard on pages per run — NOT a completeness bound.
 *
 * The walk normally stops because a page came back empty (`feedPageHasData`). This exists only so a
 * vendor that never returns an empty page cannot spin a scheduler tick forever. Measured on the live
 * feed 2026-09-01, a cursorless seed of the whole 192-vehicle fleet drained in **12 pages**, and a
 * steady-state re-poll in one; 200 is two orders of magnitude of headroom over the seed and still
 * terminates. Hitting it is reported, never swallowed — see `pagesCapped` below.
 */
export const STATS_FEED_MAX_PAGES = 200;

export interface VehicleStatsFeedResult {
  /** Vehicles whose stored odometer / fuel level actually changed. */
  updated: number;
  pages: number;
  samples: number;
  /** True when the page cap stopped the walk — the cursor still advanced, so the rest arrives next tick. */
  pagesCapped: boolean;
  /** Whether this run resumed from a stored cursor or seeded the feed from its head. */
  resumed: boolean;
  /** Fuel-level drops filed to `fuel_events`. */
  dropsFiled: number;
  /**
   * Drops seen on trucks whose tank sensor the product has NOT learned to trust, and therefore not
   * filed. Reported rather than dropped silently: this is the number that says what the gate costs,
   * and SAM-S6 is the step that gets to argue with it.
   */
  dropsSuppressedUnreliableSensor: number;
}

type VehicleRow = {
  id: string;
  samsara_vehicle_id: string;
  current_odometer: number | string | null;
  samsara_fuel_percent: number | string | null;
  samsara_fuel_at: string | null;
  fuel_type: string | null;
  tank_capacity_gal: number | string | null;
  tank_sensor_reliable: boolean | null;
  sensor_capacity_gal: number | string | null;
  observed_max_fill_gal: number | string | null;
  baseline_mpg: number | string | null;
};

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Read this org's cursor for a feed. A MISSING TABLE is not an error here.
 *
 * 0288 and this reader ship in two merges, and Railway serves a merge ~9 minutes before `migrate.yml`
 * applies its migration (docs/MIGRATION-DISCIPLINE.md §the-deploy-window). During that window the
 * table does not exist, and the correct behaviour is precisely "no cursor" — the tier seeds from the
 * feed's head, which returns every vehicle's current value and is therefore exactly as complete as the
 * snapshot tier it replaces. The window costs one wide read per tick and loses nothing.
 */
async function readCursor(admin: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("samsara_feed_cursors")
    .select("end_cursor")
    .eq("org_id", orgId)
    .eq("feed", VEHICLE_STATS_FEED)
    .maybeSingle();
  if (error) return null;
  const cur = (data as { end_cursor?: string } | null)?.end_cursor;
  return typeof cur === "string" && cur.trim() ? cur : null;
}

/**
 * Advance the cursor, AFTER its page has been applied (D-SAM4: at-least-once, never at-most-once).
 *
 * Deliberately an INSERT-or-UPDATE pair rather than `.upsert()`. A partial upsert into a table with
 * NOT NULL columns fails on rows that already exist, because Postgres evaluates NOT NULL on the
 * proposed tuple BEFORE conflict arbitration — the defect that shipped three times and took the Idling
 * and HOS syncs down (incident 2026-08-10, `lint:upserts`). This payload happens to be complete, but
 * the pair is also what makes a failure to persist NON-FATAL: losing a cursor write costs a repeated
 * page next tick, and must never lose the samples this run already applied.
 */
async function advanceCursor(admin: SupabaseClient, orgId: string, cursor: string): Promise<void> {
  const { data, error } = await admin
    .from("samsara_feed_cursors")
    .update({ end_cursor: cursor })
    .eq("org_id", orgId)
    .eq("feed", VEHICLE_STATS_FEED)
    .select("org_id");
  if (error) throw error;
  if ((data ?? []).length > 0) return;
  await admin
    .from("samsara_feed_cursors")
    .insert({ org_id: orgId, feed: VEHICLE_STATS_FEED, end_cursor: cursor });
}

function vehicleView(r: VehicleRow): VehicleView {
  return {
    id: r.id,
    fuelType: (r.fuel_type ?? "diesel") as VehicleView["fuelType"],
    tankCapacityGal: num(r.tank_capacity_gal) ?? 0,
    baselineMpg: num(r.baseline_mpg),
    tankSensorReliable: r.tank_sensor_reliable === true,
    sensorCapacityGal: num(r.sensor_capacity_gal) ?? undefined,
    observedMaxFillGal: num(r.observed_max_fill_gal) ?? undefined,
  };
}

/**
 * File one fuel-level drop as a `fuel_events` row.
 *
 * `external_ref` is derived, not vendor-supplied, and that is what makes the write idempotent: the
 * feed is at-least-once by design, so the same descent WILL arrive twice whenever a cursor write fails
 * after its page was applied. Keying on (vehicle, instant, magnitude) means a re-delivery collides
 * with the row it already wrote instead of doubling an operator's queue. `fuel_events` already carries
 * `unique (org_id, external_ref)` from 0021.
 *
 * ⚠ NO NOTIFICATION. The webhook path emails the org through `notifyFuelDrop`; this one deliberately
 * does not. The detector is new, its threshold is stated rather than tuned, and the alert queue it
 * would join is measured at 2.9% precision (FUEL-SECTION-CONSOLIDATION-PLAN §0.3a). It earns an inbox
 * before it earns an inbox alert — SAM-S6 is where that is decided on evidence.
 */
async function fileDrop(
  admin: SupabaseClient,
  orgId: string,
  vehicle: VehicleRow,
  drop: FuelLevelDrop,
): Promise<boolean> {
  const ref = `feed:${vehicle.samsara_vehicle_id}:${drop.endedAt}:${drop.dropPct}`;
  const { error } = await admin.from("fuel_events").insert({
    org_id: orgId,
    vehicle_id: vehicle.id,
    samsara_vehicle_id: vehicle.samsara_vehicle_id,
    event_type: "fuel_drop",
    happened_at: drop.endedAt,
    drop_pct: drop.dropPct,
    fuel_pct_before: drop.pctBefore,
    fuel_pct_after: drop.pctAfter,
    external_ref: ref,
    raw: { source: "stats_feed", startedAt: drop.startedAt, gallons: drop.gallons },
  });
  if (!error) return true;
  if (error.code === "23505") return false; // already filed — the at-least-once re-delivery
  throw error;
}

export interface StatsFeedOpts {
  /** Injected in tests; production builds one from the org's token. */
  fetcher?: SamsaraStatsFeedFetcher;
}

/**
 * LIVE STATS via the DELTA FEED — refresh odometer + fuel level for mapped vehicles, and file the
 * fuel-level drops that only a delta feed can see (SAM-S2, D-SAM4/D-SAM2; Q-SAM5 answered (a)).
 *
 * This replaces a `GET /fleet/vehicles/stats` snapshot poll. The endpoint is the smaller half of the
 * change: a snapshot shows where a value IS and never where it WAS, so a truck that loses 40 gallons
 * at 10:07 and is refilled by 10:19 was, to this product, a truck nothing happened to
 * (SAMSARA-COLLECTION-PLAN §0.2). The cadence stays at SAMSARA_STATS_SYNC_MINUTES and is now a LATENCY
 * knob rather than a completeness one — which is the whole point, and is what lets S5 tune it on
 * evidence instead of on nerves.
 */
export async function syncVehicleStatsFromSamsara(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: StatsFeedOpts = {},
): Promise<VehicleStatsFeedResult> {
  const token = opts.fetcher ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();
  const fetch = opts.fetcher ?? makeSamsaraStatsFeedFetcher(env, token);

  const startCursor = await readCursor(admin, orgId);
  const result: VehicleStatsFeedResult = {
    updated: 0, pages: 0, samples: 0, pagesCapped: false,
    resumed: startCursor != null, dropsFiled: 0, dropsSuppressedUnreliableSensor: 0,
  };

  // ── Walk the delta, accumulating across pages ─────────────────────────────────────────────────
  // A descent that straddles a page boundary is one event, so pages are merged before anything is
  // judged. The cursor advances per page — the unit the vendor gives us — but the APPLY happens once
  // at the end, which is why `advanceCursor` is only reached after `applySeries` below.
  const series = new Map<string, VehicleFeedSeries>();
  let cursor = startCursor;
  for (let page = 0; page < STATS_FEED_MAX_PAGES; page++) {
    const body = await fetch(cursor ?? undefined);
    result.pages++;
    if (!feedPageHasData(body)) break;
    const before = countSamples(series);
    accumulateStatsFeedPage(body, series);
    result.samples += countSamples(series) - before;
    const next = body.pagination?.endCursor;
    if (typeof next !== "string" || !next.trim() || next === cursor) break;
    cursor = next;
    // ⚠ NOT `while (pagination.hasNextPage)`. Measured on the live feed 2026-09-01: it is `true` on
    // every page, forever, including an immediate re-poll of an idle fleet. The plan's §0.5 check 3
    // recorded `false` and does not reproduce. An empty page is the end of the delta.
    if (page === STATS_FEED_MAX_PAGES - 1) result.pagesCapped = true;
  }

  if (series.size === 0) {
    if (cursor && cursor !== startCursor) await persistQuietly(admin, orgId, cursor);
    return result;
  }

  await applySeries(admin, orgId, series, result);

  // Only now — a cursor that moved past samples we failed to apply would lose them silently, which is
  // the exact failure this whole step exists to end.
  if (cursor && cursor !== startCursor) await persistQuietly(admin, orgId, cursor);
  return result;
}

function countSamples(series: Map<string, VehicleFeedSeries>): number {
  let n = 0;
  for (const s of series.values()) n += s.fuel.length + s.odometer.length;
  return n;
}

/** A cursor we could not store costs a repeated page next tick. It must never fail the run. */
async function persistQuietly(admin: SupabaseClient, orgId: string, cursor: string): Promise<void> {
  try {
    await advanceCursor(admin, orgId, cursor);
  } catch (e) {
    console.error(
      `[samsara-stats-feed] cursor write failed for org ${orgId} — the page will be re-read:`,
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * Write what the delta said: current values onto `vehicles`, drops into `fuel_events`.
 *
 * DIFF-BEFORE-WRITE is carried over unchanged from the snapshot tier (perf finding, 2026-08): this
 * runs every few minutes and blindly stamping every mapped truck put 862k+ vehicle updates into
 * pg_stat_statements, most of them writing identical values, because a parked truck's odometer and
 * fuel level do not move. The delta feed reduces the candidates but does not remove the case — a
 * sample can repeat a value it already had.
 */
async function applySeries(
  admin: SupabaseClient,
  orgId: string,
  series: Map<string, VehicleFeedSeries>,
  result: VehicleStatsFeedResult,
): Promise<void> {
  const { data: rows } = await admin
    .from("vehicles")
    .select(
      "id, samsara_vehicle_id, current_odometer, samsara_fuel_percent, samsara_fuel_at, fuel_type, " +
        "tank_capacity_gal, tank_sensor_reliable, sensor_capacity_gal, observed_max_fill_gal, baseline_mpg",
    )
    .eq("org_id", orgId)
    .not("samsara_vehicle_id", "is", null);

  for (const r of (rows ?? []) as unknown as VehicleRow[]) {
    const s = series.get(r.samsara_vehicle_id);
    if (!s) continue; // the feed said nothing about this truck → leave it be

    const odo = latestOdometerMiles(s);
    const fuel = latestFuelLevel(s);
    const patch: {
      current_odometer?: number;
      samsara_fuel_percent?: number;
      samsara_fuel_at?: string | null;
    } = {};
    if (odo != null && num(r.current_odometer) !== odo) patch.current_odometer = odo;
    if (fuel && (num(r.samsara_fuel_percent) !== fuel.percent || r.samsara_fuel_at !== fuel.time)) {
      patch.samsara_fuel_percent = fuel.percent;
      patch.samsara_fuel_at = fuel.time;
    }
    if (Object.keys(patch).length > 0) {
      // Through the module's pinned writer rather than a second write site for the same table here:
      // `vehicles` belongs to roster, and this module is grandfathered for ONE out-of-owner write,
      // on a list that may shrink and not grow. See `writeVehicleTelematics` for the whole argument.
      await writeVehicleTelematics(admin, orgId, r.id, patch);
      result.updated++;
    }

    await fileDropsFor(admin, orgId, r, s, result);
  }
}

/**
 * The reliability gate, and why it is this one.
 *
 * A tank-level drop is only evidence if the sensor reporting it is one the product has LEARNED to
 * trust. This is not a new judgement: `ruleEligible` already gates `tank_fill_short` and
 * `tank_chronic_short` on `tank_sensor_reliable`, and the fuel plan measured what that gate is worth —
 * those two rules fired 19 times with **zero** false positives, against `cumulative_overfuel`'s 89
 * fires / 55 false / 0 confirmed, which is ungated (§0.3a). Reusing the gate is the difference between
 * adding a detector to a 2.9%-precision queue and adding one to the part of it that works.
 *
 * It is narrow today — `tank_sensor_reliable` is true for 12 of 195 trucks (6.2%) — and that number is
 * itself a symptom of the hole S3/S4 close: the learner has never seen telematics for 76.8% of fills.
 * It widens on its own as the backfill lands, which is why the suppressed count is reported rather
 * than discarded. SAM-S6 re-measures and is allowed to conclude the gate should move.
 */
async function fileDropsFor(
  admin: SupabaseClient,
  orgId: string,
  r: VehicleRow,
  s: VehicleFeedSeries,
  result: VehicleStatsFeedResult,
): Promise<void> {
  if (s.fuel.length < 2) return;
  // Capacity comes from `resolveCapacity` — sensor-measured over entered, with the observed-fill floor
  // — never the raw entered figure. In production 101 of the 145 trucks with a learned capacity
  // disagree with their entered one by more than 15%, so a gallons figure computed off the entered
  // number is wrong for most of the fleet in a way nobody would see.
  const drops = findFuelLevelDrops(s.fuel, {
    capacityGal: resolveCapacity(vehicleView(r)).gallons,
    minGallons: TANK_FILL_MIN_TOLERANCE_GAL,
  });
  if (drops.length === 0) return;
  if (r.tank_sensor_reliable !== true) {
    result.dropsSuppressedUnreliableSensor += drops.length;
    return;
  }
  for (const d of drops) {
    if (await fileDrop(admin, orgId, r, d)) result.dropsFiled++;
  }
}
