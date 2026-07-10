import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAssetGps, inferTrailerPairing, type GpsSample, type TruckTrack } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { makeSamsaraTrailerGpsFetcher, makeSamsaraVehiclesGpsFetcher } from "../lib/samsara.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";

/** Days of GPS history to match over — enough to establish the current hauler without an unbounded fetch. */
const WINDOW_DAYS = 5;
/** How many trucks per Samsara GPS call (comma-separated vehicleIds); keeps each request bounded. */
const TRUCK_BATCH = 40;

export interface ReeferPairingResult {
  /** Reefer trailers eligible for inference (reefer, has a gateway, not manually pinned). */
  candidates: number;
  /** Trailers we set a confident inferred pairing for. */
  paired: number;
}

/**
 * Pair reefer trailers to the tractor they travel with, by GPS CO-LOCATION — the reliable path when drivers
 * don't select the trailer in the Samsara app but the reefer has an Asset Gateway reporting GPS. Fetches each
 * reefer's GPS + all trucks' GPS over a recent window and runs the pure matcher. NEVER touches a trailer whose
 * pairing was set manually (pairing_source = 'manual'). Best-effort: a Samsara fetch failure throws and the
 * caller can log it, but it never corrupts existing data.
 */
export async function inferReeferPairings(admin: SupabaseClient, env: Env, orgId: string): Promise<ReeferPairingResult> {
  const token = await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  const { data: trs } = await admin
    .from("trailers")
    .select("id, samsara_asset_id, pairing_source")
    .eq("org_id", orgId)
    .eq("is_reefer", true)
    .neq("status", "retired")
    .not("samsara_asset_id", "is", null);
  // Manual pairings are authoritative — never overwrite them.
  const reefers = ((trs ?? []) as { id: string; samsara_asset_id: string; pairing_source: string | null }[]).filter(
    (t) => t.pairing_source !== "manual",
  );
  if (reefers.length === 0) return { candidates: 0, paired: 0 };

  const { data: vs } = await admin.from("vehicles").select("id, samsara_vehicle_id").eq("org_id", orgId).not("samsara_vehicle_id", "is", null);
  const vehicles = (vs ?? []) as { id: string; samsara_vehicle_id: string }[];
  if (vehicles.length === 0) return { candidates: reefers.length, paired: 0 };

  const endIso = new Date().toISOString();
  const startIso = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  // Reefer GPS (all reefers in one paginated call set).
  const trailerGps = parseAssetGps(await makeSamsaraTrailerGpsFetcher(env, token)(reefers.map((r) => r.samsara_asset_id), startIso, endIso));

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
  for (const r of reefers) {
    const match = inferTrailerPairing(trailerGps.get(r.samsara_asset_id) ?? [], tracks);
    if (match) {
      await admin
        .from("trailers")
        .update({ assigned_vehicle_id: match.vehicleId, pairing_source: "inferred", pairing_confidence: match.confidence })
        .eq("id", r.id)
        .eq("org_id", orgId);
      paired++;
    }
  }
  return { candidates: reefers.length, paired };
}
