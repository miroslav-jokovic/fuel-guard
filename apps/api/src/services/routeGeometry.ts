/**
 * Cache-through HERE route geometry. Keyed by (stops + truck profile + hazmat/tunnel + engine version) so most
 * days are cache hits and HERE calls stay well under the free/cheap tier. Returns the decoded polyline the
 * corridor match + deviation detection use. Read-only w.r.t. Samsara; only writes our own cache row.
 */
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HereRouteRequest, LatLng } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { fetchTruckRoute } from "../lib/here.js";

/** Bump when the routing request shape/logic changes so old cache rows are bypassed. */
const ENGINE_VERSION = "here-v8-1";

export interface RouteGeometry {
  polyline: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  cacheKey: string;
  cached: boolean;
}

function cacheKeyFor(req: HereRouteRequest): string {
  const norm = {
    v: ENGINE_VERSION,
    o: req.origin,
    w: req.via ?? [],
    d: req.destination,
    p: req.profile,
    h: [...(req.hazmat ?? [])].sort(),
    t: req.tunnelCategory ?? null,
  };
  return crypto.createHash("sha1").update(JSON.stringify(norm)).digest("hex");
}

/** Return the cached geometry for this request, computing + caching via HERE on a miss. */
export async function getOrComputeRoute(admin: SupabaseClient, env: Env, req: HereRouteRequest): Promise<RouteGeometry> {
  const cacheKey = cacheKeyFor(req);
  const { data: hit } = await admin
    .from("route_geometries")
    .select("polyline, distance_meters, duration_seconds")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (hit) {
    return {
      polyline: hit.polyline as LatLng[],
      distanceMeters: Number(hit.distance_meters),
      durationSeconds: Number(hit.duration_seconds ?? 0),
      cacheKey,
      cached: true,
    };
  }
  const route = await fetchTruckRoute(env, req);
  await admin
    .from("route_geometries")
    .upsert(
      { cache_key: cacheKey, polyline: route.polyline, distance_meters: route.distanceMeters, duration_seconds: route.durationSeconds },
      { onConflict: "cache_key" },
    );
  return { ...route, cacheKey, cached: false };
}
