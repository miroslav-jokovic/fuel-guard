/**
 * One truck's GPS trail over a window, from Samsara — the read the live map's driven path makes
 * (DISPATCH-BOARD-V2-PLAN §5.3, DBV6). `vehicle_positions` holds one row per truck, so there is no
 * breadcrumb of ours to read: the history is Samsara's, asked for on demand when a dispatcher opens a
 * route, never polled.
 *
 * It returns raw points, oldest first. Thinning and drawing are the map's judgement, as with
 * `readVehiclePositions`. The org's token and the truck's Samsara id are this module's to resolve; a
 * missing one is an answer (`unavailable`), not an error, so the map can say why there is no line.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { loadSamsaraToken } from "./lib/samsaraToken.js";
import { makeSamsaraVehicleTrailFetcher } from "./lib/samsara.js";

export interface TrailPoint {
  lat: number;
  lng: number;
  time: string;
}

export type VehicleTrail =
  | { ok: true; points: TrailPoint[] }
  | { ok: false; unavailable: "no_token" | "not_linked" };

export async function readVehicleTrail(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  vehicleId: string,
  startIso: string,
  endIso: string,
): Promise<VehicleTrail> {
  const { data, error } = await admin
    .from("vehicles")
    .select("samsara_vehicle_id")
    .eq("org_id", orgId)
    .eq("id", vehicleId)
    .maybeSingle();
  if (error) throw new Error(`vehicles read failed: ${error.message}`);
  const samsaraId = (data as { samsara_vehicle_id: string | null } | null)?.samsara_vehicle_id ?? null;
  if (!samsaraId) return { ok: false, unavailable: "not_linked" };
  const token = await loadSamsaraToken(admin, env, orgId);
  if (!token) return { ok: false, unavailable: "no_token" };

  const answer = await makeSamsaraVehicleTrailFetcher(env, token)([samsaraId], startIso, endIso);
  const raw = (answer.data.find((a) => String(a.id ?? "") === samsaraId)?.gps ?? []) as {
    time?: string; latitude?: number; longitude?: number;
  }[];
  const points = raw
    .filter((g): g is { time: string; latitude: number; longitude: number } =>
      typeof g.time === "string" && Number.isFinite(g.latitude) && Number.isFinite(g.longitude))
    .map((g) => ({ lat: g.latitude, lng: g.longitude, time: g.time }))
    // Pages arrive in order, but nothing in Samsara's contract promises it; a line drawn out of time
    // order zigzags across the map.
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return { ok: true, points };
}
