/**
 * The live map's board — where every truck is, what it is doing, and what it is carrying
 * (LIVE-MAP-PLAN.md LM6, D-LM11).
 *
 * ── IT OWNS NO TABLE, AND READS ALL FOUR THROUGH THEIR OWNERS ────────────────────────────────────
 * `vehicle_positions` belongs to `samsara`, `vehicles` and `drivers` to `roster`, `loads` and
 * `load_stops` to `loads`. Only the first is machine-sealed (`layer=raw`, `check-table-access.mjs`);
 * the other two are core tables this module could legally select from. It does not, and that is a
 * decision rather than an oversight — D-ARC3 gives every table one owner, and reaching past one
 * because no gate happens to stop you is how `drivers` came to be touched from 54 files.
 *
 * ── THE SHAPE IS THREE READS, NOT ONE JOIN ───────────────────────────────────────────────────────
 * PostgREST can embed related rows, but an embed would have to cross a module boundary inside a
 * single query string and would put the join in the URL rather than in code anyone can read. Three
 * owner-interface reads and two `Map` lookups is the same work, bounded by fleet size (~200), and
 * each read is independently org-scoped and independently testable.
 *
 * ── EVERY STATE IS COMPUTED AGAINST ONE CLOCK ────────────────────────────────────────────────────
 * `generatedAt` is taken once and passed to every `deriveVehicleState`. Reading the clock per truck
 * would let a slow board rank two trucks by when their row happened to be processed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveVehicleState,
  positionAgeSeconds,
  ENGINE_ON_BOUND_SECONDS,
  OFFLINE_BOUND_SECONDS,
  STOPPED_SPEED_MPH,
  type LiveMapBoard,
  type LiveMapVehicle,
} from "@silvicom/shared";
import { readVehiclePositions } from "../samsara/index.js";
import { readFleetIdentities } from "../roster/index.js";
import { readLiveLoadContext } from "../loads/index.js";

/**
 * Why the caller is seeing the whole fleet.
 *
 * D-LM3 scopes a dispatcher to the loads they dispatch, resolved through `movement.dispatcher_user_id`
 * and `tms_dispatchers`. McLeod has not granted `VIEW CHANGE TRACKING`, that table does not exist in
 * this database, and D-LM18 therefore ships the board fleet-wide rather than faking a personal scope.
 *
 * ⚠ The banner is REQUIRED, not decorative. A dispatcher who believes they are looking at their own
 * trucks, and is actually looking at everyone's, will mis-read an empty column as "nothing of mine is
 * late". Saying so out loud is the difference between a limitation and a lie.
 */
export const FLEET_WIDE_SCOPE_REASON =
  "Showing every truck in the fleet. Per-dispatcher scoping needs the dispatcher on each load from " +
  "McLeod, which this carrier has not granted yet.";

/**
 * `Q-LM8a` RULED, 2026-09-15 (LM8): a RETIRED truck is not on the dispatcher's board.
 *
 * LM6 deliberately left this undecided rather than guess it inside a reader — "should a
 * decommissioned truck appear on the live map" is a product question, and 28 of the 199 rows
 * `vehicle_positions` held that day were retired vehicles the collector still hears from. The board
 * is a dispatcher's answer to "where is my fleet and what is it doing", not an inventory: a truck
 * that has been sold or scrapped is not work anybody can dispatch, and a seventh of the markers
 * being un-actionable is how a map stops being read.
 *
 * ⚠ THE PREDICATE IS `<> retired`, NOT `= active`, and the difference is not pedantry. `vehicle_status`
 * is `active | maintenance | retired` (migration 0001), so filtering to `active` would ALSO drop every
 * truck sitting in the shop — which is precisely a thing a dispatcher wants to see on a map. This
 * carrier happens to have no `maintenance` rows today (235 active, 37 retired, measured on production
 * 2026-09-16), so the two spellings are indistinguishable right now and would stay that way until the
 * first truck went into the shop and quietly vanished from the board.
 *
 * It lives HERE and not in `readFleetIdentities` for the same reason that reader exists at all: the
 * ruling is the live map's, not the roster's, and `FleetIdentity.status` is carried across that
 * interface exactly so this module can apply its own. Widening it later is deleting this predicate.
 */
const HIDDEN_VEHICLE_STATUS = "retired";

export interface LiveMapBoardOptions {
  /** Injected by tests; production takes the clock once, here. */
  now?: Date;
}

export async function readLiveMapBoard(
  admin: SupabaseClient,
  orgId: string,
  opts: LiveMapBoardOptions = {},
): Promise<LiveMapBoard> {
  const now = opts.now ?? new Date();

  // Sequential rather than concurrent on purpose: three small reads against one Postgres, and a
  // Promise.all here would trade a few milliseconds for a failure mode where one rejection leaves two
  // queries in flight against a pool this process shares with every other request.
  const positions = await readVehiclePositions(admin, orgId);
  const identities = await readFleetIdentities(admin, orgId);
  const loads = await readLiveLoadContext(admin, orgId);

  const vehicles: LiveMapVehicle[] = [];
  for (const p of positions.rows) {
    const identity = identities.byVehicleId.get(p.vehicle_id);
    // A position whose vehicle the roster does not carry. Skipped rather than drawn as an anonymous
    // dot: a marker with no unit number is something a dispatcher cannot act on, and the collector
    // already counts the unmapped case where it can be fixed (`unmappedVehicles`, LM4).
    if (!identity) continue;
    // Q-LM8a, above. A null status is drawn: it means the roster row predates the column or was
    // written by something that did not set it, and "we do not know" is not "retired".
    if (identity.status === HIDDEN_VEHICLE_STATUS) continue;

    const state = deriveVehicleState({ sampledAt: p.sampled_at, speedMph: p.speed_mph }, now);
    vehicles.push({
      vehicleId: p.vehicle_id,
      unitNumber: identity.unitNumber,
      driver: identity.driver,
      position: {
        lat: p.lat,
        lng: p.lng,
        headingDegrees: p.heading_degrees,
        speedMph: p.speed_mph,
        isEcuSpeed: p.is_ecu_speed,
        formattedLocation: p.formatted_location,
        sampledAt: p.sampled_at,
        receivedAt: p.received_at,
      },
      state,
      // `?? 0` is unreachable — `sampled_at` is NOT NULL in 0341 and the row came from that table —
      // but the contract says number and a cast would be a lie the type system stops checking.
      ageSeconds: Math.round(positionAgeSeconds(p.sampled_at, now) ?? 0),
      load: toLoadContext(loads.byVehicleId.get(p.vehicle_id)),
    });
  }

  return {
    generatedAt: now.toISOString(),
    scope: "all",
    scopeReason: FLEET_WIDE_SCOPE_REASON,
    bounds: {
      stoppedSpeedMph: STOPPED_SPEED_MPH,
      engineOnBoundSeconds: ENGINE_ON_BOUND_SECONDS,
      offlineBoundSeconds: OFFLINE_BOUND_SECONDS,
    },
    vehicles,
    truncated: positions.truncated || identities.truncated || loads.truncated,
  };
}

function toLoadContext(
  load: Awaited<ReturnType<typeof readLiveLoadContext>>["byVehicleId"] extends Map<string, infer T>
    ? T | undefined
    : never,
): LiveMapVehicle["load"] {
  if (!load) return null;
  return { id: load.loadId, ref: load.ref, status: load.status, nextStop: load.nextStop };
}
