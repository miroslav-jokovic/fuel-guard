/**
 * One Out of route warning on our own map (OUT-OF-ROUTE-MAP-ANALYSIS-2026-11-27, option A; D-ORM1–6).
 * The owner, 2026-11-27: see on our map "where the truck left its route, the route it should be on, where
 * it went, and whether it is back" instead of opening Samsara.
 *
 * Composed here because `livemap` already reads all three halves and owns none of them: the truck's GPS
 * (samsara's `readVehicleTrail`, DBV6), its load and stops (loads), and the HERE route (routing, through
 * `loadRouteRequest` so the request — and the cache row — is the live map's own). The verdict and the
 * sentence are shared and pure (`offRouteView.ts`). Nothing is stored (D-ORM5): the trail is Samsara's
 * for at least 180 days (measured), and the route is cached by the routing module for a day.
 *
 * ── THE PLANNED LINE (D-ORM2, Q-ORM2 ruled (a)) ──────────────────────────────────────────────────
 * The load the truck was on when Samsara said it left (`loadAtInstant`), routed pickup → stops →
 * delivery. Before the truck had left the pickup — on its way to it — the line it should have been on is
 * the way TO the pickup, routed from its first fix of the window (45 min before the alert, when Samsara
 * still had it on route) and drawn as its own leg, labelled as ours. With no load at all, the path is
 * drawn alone and the sentence says there is nothing to compare with.
 *
 * ── FAILURE IS A SENTENCE (D-ORM6) ───────────────────────────────────────────────────────────────
 * HERE down or unkeyed: the path and the stops are still drawn, the line is not, and `notes` says why
 * (the 2026-10-19 lesson: never a 500 for a vendor outage). Samsara failing is the caller's to word: it
 * is the half without which there is nothing to show.
 *
 * Cached 60 s per warning, by `readDrivenPathCached`'s rules: the TTL runs from when the read started,
 * concurrent callers share one read, a failed read is not cached.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadAtInstant,
  milesFromMeters,
  offRouteVerdict,
  offRouteWindow,
  thinPath,
  type LatLng,
  type OffRouteView,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { HereUnavailableError, NoHereKeyError } from "../../lib/here.js";
import { readLoadForRoute, readTruckLoadSpans } from "../loads/index.js";
import { getOrComputeRoute } from "../routing/index.js";
import { readVehicleTrail } from "../samsara/index.js";
import { loadRouteRequest, ORIGIN_GRID_DEG, snap, type RouteEnds } from "./liveMapLoadRoute.js";

export interface OffRouteQuery {
  /** Our `vehicles.id` for the warning's truck. */
  vehicleId: string;
  happenedAt: string;
  endedAt: string | null;
  stillActive: boolean;
  /** The alert configuration's own distance (D-ORM4). */
  thresholdMeters: number;
}

const NOTES = {
  not_linked: "This truck is not linked to Samsara, so where it drove cannot be drawn.",
  no_token: "Samsara is not connected for this company, so where the truck drove cannot be drawn.",
  no_gps: "Samsara has no GPS for this truck in that window.",
  no_load: "There was no load on this truck at that time.",
  no_stops: "The load has fewer than two stops with a location, so its route cannot be drawn.",
  no_truck: "The truck is not on the roster, so its route cannot be planned.",
  routing: "The routing service is not answering, so the planned route cannot be drawn right now.",
} as const;

async function routeOrNull(admin: SupabaseClient, env: Env, ends: RouteEnds, points: LatLng[], notes: string[]): Promise<LatLng[] | null> {
  try {
    return (await getOrComputeRoute(admin, env, { origin: points[0]!, via: points.slice(1, -1), destination: points.at(-1)!, ...ends })).polyline;
  } catch (e) {
    if (e instanceof NoHereKeyError || e instanceof HereUnavailableError) {
      if (!notes.includes(NOTES.routing)) notes.push(NOTES.routing);
      return null;
    }
    throw e;
  }
}

export async function readOffRouteView(admin: SupabaseClient, env: Env, orgId: string, q: OffRouteQuery, nowMs: number): Promise<OffRouteView> {
  const window = offRouteWindow(q.happenedAt, q.endedAt, nowMs);
  const notes: string[] = [];
  const [trail, spans] = await Promise.all([
    readVehicleTrail(admin, env, orgId, q.vehicleId, new Date(window.startMs).toISOString(), new Date(window.endMs).toISOString()),
    readTruckLoadSpans(admin, orgId, q.vehicleId),
  ]);
  const points = trail.ok ? trail.points : [];
  if (!trail.ok) notes.push(NOTES[trail.unavailable]);
  else if (points.length < 2) notes.push(NOTES.no_gps);

  let planned: OffRouteView["planned"] = null;
  const pick = loadAtInstant(spans, Date.parse(q.happenedAt), nowMs);
  const load = pick ? await readLoadForRoute(admin, orgId, pick.loadId) : null;
  if (!pick || !load) notes.push(NOTES.no_load);
  else {
    const stops = load.stops.map((s) => ({ lat: s.lat, lng: s.lng, kind: s.kind, name: s.name }));
    const request = await loadRouteRequest(admin, orgId, q.vehicleId, load.trailerIsReefer);
    if (!request) notes.push(NOTES.no_truck);
    else if (stops.length < 2) notes.push(NOTES.no_stops);
    const stopPoints = stops.map(({ lat, lng }) => ({ lat, lng }));
    const route = request && stops.length >= 2 ? await routeOrNull(admin, env, request.ends, stopPoints, notes) : null;
    const beforePickup = pick.relation === "to_pickup" || !load.departedAt || Date.parse(load.departedAt) > Date.parse(q.happenedAt);
    const from = points[0];
    const toPickup =
      request && beforePickup && from && stops.length > 0
        ? await routeOrNull(admin, env, request.ends, [{ lat: snap(from.lat, ORIGIN_GRID_DEG), lng: snap(from.lng, ORIGIN_GRID_DEG) }, stopPoints[0]!], notes)
        : null;
    planned = { loadRef: load.ref, relation: beforePickup ? "to_pickup" : "on_load", route, toPickup, stops };
  }

  const thresholdMiles = milesFromMeters(q.thresholdMeters);
  const lines = [planned?.route, planned?.toPickup].filter((l): l is LatLng[] => Array.isArray(l) && l.length >= 2);
  return {
    thresholdMiles,
    samsara: { happenedAt: q.happenedAt, endedAt: q.endedAt, stillActive: q.stillActive },
    window: { start: new Date(window.startMs).toISOString(), end: new Date(window.endMs).toISOString(), capped: window.capped },
    path: thinPath(points.map(({ lat, lng }) => ({ lat, lng }))),
    planned,
    notes,
    verdict: offRouteVerdict(points, lines, thresholdMiles, { stillActive: q.stillActive }),
  };
}

export const OFF_ROUTE_CACHE_TTL_MS = 60_000;
const entries = new Map<string, { startedAtMs: number; answer: Promise<OffRouteView> }>();

/** Keyed per org and warning: a warning id is a uuid, but the answer is this org's read. */
export function readOffRouteViewCached(admin: SupabaseClient, env: Env, orgId: string, warningId: string, q: OffRouteQuery, nowMs: number = Date.now()): Promise<OffRouteView> {
  for (const [k, e] of entries) if (nowMs - e.startedAtMs >= OFF_ROUTE_CACHE_TTL_MS) entries.delete(k);
  const key = `${orgId}:${warningId}`;
  const hit = entries.get(key);
  if (hit) return hit.answer;
  const answer = readOffRouteView(admin, env, orgId, q, nowMs);
  const entry = { startedAtMs: nowMs, answer };
  entries.set(key, entry);
  answer.catch(() => {
    if (entries.get(key) === entry) entries.delete(key);
  });
  return answer;
}

/** Drop everything. For tests only — production entries age out on their own. */
export function __resetOffRouteCache(): void {
  entries.clear();
}
