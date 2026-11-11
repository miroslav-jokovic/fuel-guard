import type { SupabaseClient } from "@supabase/supabase-js";
import type { LiveMapVehicle, VehicleMapState } from "@silvicom/shared";
import { readLiveMapBoardCached } from "./liveMapBoardCache.js";

/**
 * The assistant's `fleet_now` tool (F21 R6b, 2026-11-10): the live map's board, asked in words. "How
 * many drivers are moving right now" was asked in production and could not be answered: no tool read
 * positions.
 *
 * ── WHY IT CALLS `readLiveMapBoardCached` AND NOTHING ELSE ───────────────────────────────────────
 * That is `GET /api/livemap/positions`, the Dashboard's Dispatch tab, and the same 5-second cache. Each
 * truck's state (moving, stopped, parked, offline) is `deriveVehicleState`, computed ONCE on the board
 * "so the map and any other reader cannot disagree" (`livemapContract.ts`). This file only counts the
 * board's rows by that state and lists the ones asked for. It never re-derives a state from a speed,
 * because a second rule would put a truck the map shows parked in the assistant's "moving" count.
 *
 * Gated as its page is: `dispatch` bought, then `dispatch: view` (`assistantContract.ts`).
 *
 * ORG-SCOPED: the board reader filters `org_id` on every read.
 */

export const FLEET_NOW_STATES = ["moving", "stopped", "parked", "offline"] as const satisfies readonly VehicleMapState[];
/** Trucks listed per answer. A fleet is ~200; the count is always whole, the list is a sample. */
export const MAX_FLEET_NOW_TRUCKS = 25;

export interface AssistantFleetNowInput {
  state?: unknown;
  limit?: unknown;
}

const truck = (v: LiveMapVehicle) => ({
  unit: v.unitNumber,
  driver: v.driver?.name ?? null,
  state: v.state,
  speed_mph: v.position.speedMph,
  location: v.position.formattedLocation,
  // How old the position is, in seconds, against the board's own clock (`generatedAt`).
  position_age_seconds: v.ageSeconds,
  in_shop: v.inShop,
  load: v.load?.ref ?? null,
  next_stop: v.load?.nextStop ? [v.load.nextStop.city, v.load.nextStop.state].filter(Boolean).join(", ") || null : null,
});

export async function assistantFleetNow(admin: SupabaseClient, orgId: string, input: AssistantFleetNowInput): Promise<unknown> {
  const board = await readLiveMapBoardCached(admin, orgId);
  const state = (FLEET_NOW_STATES as readonly string[]).includes(String(input.state)) ? (input.state as VehicleMapState) : null;
  const limit = Math.min(Math.max(Math.trunc(Number(input.limit)) || MAX_FLEET_NOW_TRUCKS, 1), MAX_FLEET_NOW_TRUCKS);

  const counts = Object.fromEntries(FLEET_NOW_STATES.map((s) => [s, 0])) as Record<VehicleMapState, number>;
  const withDriver = Object.fromEntries(FLEET_NOW_STATES.map((s) => [s, 0])) as Record<VehicleMapState, number>;
  for (const v of board.vehicles) {
    counts[v.state] += 1;
    if (v.driver) withDriver[v.state] += 1;
  }

  const result: Record<string, unknown> = {
    source: "Live map (Dashboard, Dispatch tab), the same board and the same truck states that map shows",
    as_of: board.generatedAt,
    scope: board.scopeReason,
    trucks_on_map: board.vehicles.length,
    by_state: counts,
    // "How many DRIVERS are moving" is the trucks moving with a driver assigned.
    with_a_driver_by_state: withDriver,
    in_shop: board.vehicles.filter((v) => v.inShop).length,
    // Not retired, but never positioned (no gateway yet): counted, never silently absent (LS3).
    trucks_never_positioned: board.untracked.length,
    state_rules: {
      stopped_below_mph: board.bounds.stoppedSpeedMph,
      offline_after_seconds_silent: board.bounds.offlineBoundSeconds,
    },
  };
  if (state) {
    const rows = board.vehicles.filter((v) => v.state === state);
    result.trucks = rows.slice(0, limit).map(truck);
    if (rows.length > limit) result.trucks_note = `${limit} of ${rows.length} ${state} trucks listed.`;
  }
  return result;
}
