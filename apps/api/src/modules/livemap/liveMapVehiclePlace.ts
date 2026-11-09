/**
 * The named truck place a stopped truck is at (D-LM31) — the card's "At: Pilot · Truck stop" line.
 *
 * ── ON DEMAND, NEVER PER POLL ────────────────────────────────────────────────────────────────────
 * Asked only when a dispatcher opens a truck's card, never for the whole board every 5 seconds: one
 * Browse per opened card, against HERE's ~30,000 free a month (third-party 2026 figures, not HERE's
 * own page). Moving and offline trucks are not looked up at all (`placeLookupApplies`).
 *
 * ── THE POSITION COMES OFF THE ORG'S OWN BOARD ───────────────────────────────────────────────────
 * The truck's fix and state are read from `readLiveMapBoardCached`, the same per-org answer the map
 * itself polls, so this route restates neither the board's org filter nor its state rule, and the
 * card names the place for the fix the dispatcher is looking at. A vehicle id from another org is not
 * on this org's board, so it is a 404 here without a second tenancy check to forget.
 *
 * ── CACHED BY COORDINATE, 24 HOURS, IN MEMORY ────────────────────────────────────────────────────
 * A parked truck sits on one fix for hours and gets opened again and again; a truck stop does not move.
 * The key is the fix rounded to 4 decimals (~11 m), and it carries NO org: the answer is HERE's public
 * place data for a point, and two carriers' trucks at the same Love's get the same true answer.
 * ⚠ The 24 h is held in memory only and never written to the database — HERE's base-plan terms on
 * storing search results were read from third-party summaries (30 days), not from HERE, so this stays
 * far inside them rather than leaning on them. A failed lookup is not cached (`hereBrowse` throws).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TRUCK_PLACE_CATEGORIES,
  TRUCK_PLACE_SEARCH_RADIUS_M,
  pickTruckPlace,
  placeKey,
  placeLookupApplies,
  type LiveMapTruckPlace,
  type LiveMapVehiclePlace,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { createCoalescingCache } from "../../lib/coalescingCache.js";
import { hereBrowse } from "../../lib/hereGeocode.js";
import { readLiveMapBoardCached } from "./liveMapBoardCache.js";

export const PLACE_CACHE_TTL_MS = 24 * 60 * 60_000;

const places = createCoalescingCache<LiveMapTruckPlace | null>(PLACE_CACHE_TTL_MS, 5_000);

export type VehiclePlaceAnswer = { ok: true; data: LiveMapVehiclePlace } | { ok: false; status: 404; code: "not_found"; message: string };

export async function readVehiclePlace(admin: SupabaseClient, env: Env, orgId: string, vehicleId: string): Promise<VehiclePlaceAnswer> {
  const board = await readLiveMapBoardCached(admin, orgId);
  const vehicle = board.vehicles.find((v) => v.vehicleId === vehicleId);
  if (!vehicle) return { ok: false, status: 404, code: "not_found", message: "That truck is not on the map" };
  if (!placeLookupApplies(vehicle.state)) return { ok: true, data: { vehicleId, place: null } };
  const { lat, lng } = vehicle.position;
  const place = await places.get(placeKey(lat, lng), async () =>
    pickTruckPlace(await hereBrowse(env, { lat, lng }, TRUCK_PLACE_SEARCH_RADIUS_M, TRUCK_PLACE_CATEGORIES.map((c) => c.id))),
  );
  return { ok: true, data: { vehicleId, place } };
}

/** Drop everything. For tests only — production entries age out on their own. */
export function __resetVehiclePlaceCache(): void {
  places.invalidate();
}
