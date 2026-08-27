import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAssetGps, inferTrailerPairing, type GpsSample, type TruckTrack } from "@silvicom/shared";
import type { Env } from "../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { makeSamsaraTrailerGpsFetcher, makeSamsaraVehiclesGpsFetcher } from "../lib/samsara.js";
import { NoSamsaraTokenError } from "../modules/samsara/index.js";

/** Days of GPS history to match over — enough to establish the current hauler without an unbounded fetch. */
const WINDOW_DAYS = 5;
/** How many trucks per Samsara GPS call (comma-separated vehicleIds); keeps each request bounded. */
const TRUCK_BATCH = 40;
/** How many trailers per Samsara GPS call — same bounding as trucks (a fleet can have 150+ gateway trailers). */
const TRAILER_BATCH = 40;

export interface TrailerPairingResult {
  /** Trailers eligible for inference (has a gateway, not manually pinned) — reefer or dry van. */
  candidates: number;
  /** Trailers we set a confident inferred pairing for. */
  paired: number;
}

/**
 * Pair trailers to the tractor they travel with, by GPS CO-LOCATION — the reliable path when drivers don't
 * select the trailer in the Samsara app but the trailer has an Asset Gateway reporting GPS. Covers EVERY
 * gateway-equipped trailer, reefer or dry van: the fleet's dry vans all carry gateways too, and the Samsara
 * trailer-assignment feed returns nothing for this org, so co-location is the only working pairing signal.
 * (This used to be reefer-only, which left 150+ gateway dry vans unpaired.) Fetches each trailer's GPS + all
 * trucks' GPS over a recent window and runs the pure matcher. NEVER touches a trailer whose pairing was set
 * manually. Best-effort: a Samsara fetch failure throws and the caller logs it, but it never corrupts data.
 */
export async function inferTrailerPairings(admin: SupabaseClient, env: Env, orgId: string): Promise<TrailerPairingResult> {
  const token = await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  const { data: trs } = await admin
    .from("trailers")
    .select("id, samsara_asset_id, pairing_source")
    .eq("org_id", orgId)
    .neq("status", "retired")
    .not("samsara_asset_id", "is", null); // a gateway (asset id) is required for GPS co-location
  // Manual pairings are authoritative — never overwrite them.
  const trailers = ((trs ?? []) as { id: string; samsara_asset_id: string; pairing_source: string | null }[]).filter(
    (t) => t.pairing_source !== "manual",
  );
  if (trailers.length === 0) return { candidates: 0, paired: 0 };

  const { data: vs } = await admin.from("vehicles").select("id, samsara_vehicle_id").eq("org_id", orgId).not("samsara_vehicle_id", "is", null);
  const vehicles = (vs ?? []) as { id: string; samsara_vehicle_id: string }[];
  if (vehicles.length === 0) return { candidates: trailers.length, paired: 0 };

  const endIso = new Date().toISOString();
  const startIso = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  // Trailer GPS, batched (a fleet may have 150+ gateway trailers — don't pass them all in one URL).
  const trailerFetcher = makeSamsaraTrailerGpsFetcher(env, token);
  const trailerGps = new Map<string, GpsSample[]>();
  for (let i = 0; i < trailers.length; i += TRAILER_BATCH) {
    const batch = trailers.slice(i, i + TRAILER_BATCH);
    const raw = await trailerFetcher(batch.map((t) => t.samsara_asset_id), startIso, endIso);
    for (const [samsaraId, gps] of parseAssetGps(raw)) trailerGps.set(samsaraId, gps as GpsSample[]);
  }

  // Truck GPS, batched, keyed by our vehicle id.
  const truckFetcher = makeSamsaraVehiclesGpsFetcher(env, token);
  const vehIdBySamsara = new Map(vehicles.map((v) => [v.samsara_vehicle_id, v.id]));
  const tracks: TruckTrack[] = [];
  for (let i = 0; i < vehicles.length; i += TRUCK_BATCH) {
    const batch = vehicles.slice(i, i + TRUCK_BATCH);
    const raw = await truckFetcher(batch.map((v) => v.samsara_vehicle_id), startIso, endIso);
    for (const [samsaraId, gps] of parseAssetGps(raw)) {
      tracks.push({ vehicleId: vehIdBySamsara.get(samsaraId) ?? samsaraId, gps: gps as GpsSample[] });
    }
  }

  let paired = 0;
  for (const t of trailers) {
    const match = inferTrailerPairing(trailerGps.get(t.samsara_asset_id) ?? [], tracks);
    if (match) {
      await admin
        .from("trailers")
        .update({ assigned_vehicle_id: match.vehicleId, pairing_source: "inferred", pairing_confidence: match.confidence })
        .eq("id", t.id)
        .eq("org_id", orgId);
      paired++;
    }
  }
  return { candidates: trailers.length, paired };
}
