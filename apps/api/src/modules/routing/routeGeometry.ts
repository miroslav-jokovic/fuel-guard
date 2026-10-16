/**
 * Cache-through HERE route geometry. Keyed by (stops + truck profile + hazmat/tunnel + engine version) so most
 * days are cache hits and HERE calls stay well under the free/cheap tier. Returns the decoded polyline the
 * corridor match + deviation detection use. Read-only w.r.t. Samsara; only writes our own cache row.
 *
 * ── A DAY OLD, AND IT IS ASKED AGAIN (DISPATCH-BOARD-V2-PLAN §5.2, 2026-10-16) ───────────────────
 * A row used to be served for as long as it existed (retention drops it at 180 days). One early HERE
 * choice — I-80 rather than I-76 — then stood for the whole load and every load after it on the same
 * stops, whatever closures came in. A row older than `ROUTE_CACHE_MAX_AGE_MS` is recomputed and its
 * `created_at` restamped, so a stop pair costs at most one HERE call a day.
 */
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HereRouteRequest, LatLng, RouteStep } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { fetchTruckRoute } from "../../lib/here.js";

/** Bump when the routing request shape/logic changes so old cache rows are bypassed. */
const ENGINE_VERSION = "here-v8-5"; // request shape unchanged since v8-5. Instruction km/m is stripped on read
                                    // in fuelPlanning (stripStepDistance) — no request/cache change needed.

export const ROUTE_CACHE_MAX_AGE_MS = 24 * 3_600_000;

export interface RouteGeometry {
  polyline: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
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
    av: req.avoidTunnels ?? false,
    // Absent for a route between stops, so every key cached before the field existed still matches.
    ...(req.originCourseDegrees != null ? { c: Math.round(req.originCourseDegrees) % 360 } : {}),
  };
  return crypto.createHash("sha1").update(JSON.stringify(norm)).digest("hex");
}

/** Return the cached geometry for this request, computing + caching via HERE on a miss. */
export async function getOrComputeRoute(
  admin: SupabaseClient,
  env: Env,
  req: HereRouteRequest,
  now: Date = new Date(),
): Promise<RouteGeometry> {
  const cacheKey = cacheKeyFor(req);
  let hit: { polyline: unknown; distance_meters: unknown; duration_seconds: unknown; actions?: unknown; created_at?: unknown } | null;
  const withActions = await admin
    .from("route_geometries")
    .select("polyline, distance_meters, duration_seconds, actions, created_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (withActions.error) {
    // actions column not migrated yet: read the base columns so planning still works.
    const base = await admin
      .from("route_geometries")
      .select("polyline, distance_meters, duration_seconds, created_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    hit = base.data;
  } else {
    hit = withActions.data;
  }
  const fresh = hit && (typeof hit.created_at !== "string" || now.getTime() - Date.parse(hit.created_at) <= ROUTE_CACHE_MAX_AGE_MS);
  if (hit && fresh) {
    return {
      polyline: hit.polyline as LatLng[],
      distanceMeters: Number(hit.distance_meters),
      durationSeconds: Number(hit.duration_seconds ?? 0),
      steps: (hit.actions as RouteStep[] | null) ?? [],
      cacheKey,
      cached: true,
    };
  }
  const route = await fetchTruckRoute(env, req);
  // `created_at` restamped: on a refresh the conflict UPDATE would otherwise keep the old day.
  const base = {
    cache_key: cacheKey, polyline: route.polyline, distance_meters: route.distanceMeters, duration_seconds: route.durationSeconds,
    created_at: now.toISOString(),
  };
  const wrote = await admin.from("route_geometries").upsert({ ...base, actions: route.steps }, { onConflict: "cache_key" });
  if (wrote.error) {
    // pre-0060 deploy: persist without the actions column (directions still returned live this request).
    await admin.from("route_geometries").upsert(base, { onConflict: "cache_key" });
  }
  return { ...route, cacheKey, cached: false };
}
