/**
 * The road a load's truck actually drove (DISPATCH-BOARD-V2-PLAN §5.3, DBV6): Samsara's GPS history
 * since the truck left the pickup, thinned by the shared `thinPath`, for the live map to draw where it
 * used to draw the plan up to the truck ("covered").
 *
 * ── ON DEMAND, CACHED 60 SECONDS ─────────────────────────────────────────────────────────────────
 * Asked for only when a dispatcher opens a route, beside the route's own request, never per row or per
 * poll. One answer per load is kept for `DRIVEN_PATH_CACHE_TTL_MS`: the truck moves a mile a minute, so a
 * second viewer or a toggle off and on inside a minute costs no Samsara call and misses at most that
 * mile. Same rules as the board's cache (`liveMapBoardCache.ts`): the TTL runs from when the read
 * STARTED, concurrent callers share one read, and a failed read is not cached. Keyed per load, so
 * expired entries are swept on each call rather than left to grow for the life of the process.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { drivenPathWindow, thinPath, type LiveMapDrivenPath } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { readLoadForRoute } from "../loads/index.js";
import { readVehicleTrail } from "../samsara/index.js";

export const DRIVEN_PATH_CACHE_TTL_MS = 60_000;

export type DrivenPathAnswer =
  | { ok: true; path: LiveMapDrivenPath }
  | { ok: false; status: 404; code: string; message: string };

const NOTES = {
  not_departed: "The truck has not left the pickup yet, so there is no driven path to draw.",
  no_truck: "This load has no truck on it.",
  not_linked: "This truck is not linked to Samsara, so its driven path cannot be drawn.",
  no_token: "Samsara is not connected for this organization.",
  no_gps: "Samsara has no GPS for this truck since it left the pickup.",
} as const;

export async function readDrivenPath(admin: SupabaseClient, env: Env, orgId: string, loadId: string, now: Date): Promise<DrivenPathAnswer> {
  const load = await readLoadForRoute(admin, orgId, loadId);
  if (!load) return { ok: false, status: 404, code: "not_found", message: "That load no longer exists" };
  const empty = (note: string, since: string | null = null, capped = false): DrivenPathAnswer =>
    ({ ok: true, path: { loadId: load.id, points: [], since, capped, note } });
  if (!load.vehicleId) return empty(NOTES.no_truck);
  const window = drivenPathWindow(load.departedAt, now);
  if (!window) return empty(NOTES.not_departed);

  const trail = await readVehicleTrail(admin, env, orgId, load.vehicleId, window.startIso, now.toISOString());
  if (!trail.ok) return empty(NOTES[trail.unavailable], window.startIso, window.capped);
  if (trail.points.length < 2) return empty(NOTES.no_gps, window.startIso, window.capped);
  return {
    ok: true,
    path: {
      loadId: load.id,
      points: thinPath(trail.points.map(({ lat, lng }) => ({ lat, lng }))),
      since: window.startIso,
      capped: window.capped,
      note: null,
    },
  };
}

interface Entry {
  startedAtMs: number;
  answer: Promise<DrivenPathAnswer>;
}
const entries = new Map<string, Entry>();

export async function readDrivenPathCached(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  loadId: string,
  nowMs: number = Date.now(),
): Promise<DrivenPathAnswer> {
  for (const [k, e] of entries) if (nowMs - e.startedAtMs >= DRIVEN_PATH_CACHE_TTL_MS) entries.delete(k);
  // The org is in the key: a load id is a uuid, but the answer is this org's read and must stay its own.
  const key = `${orgId}:${loadId}`;
  const hit = entries.get(key);
  if (hit) return hit.answer;
  const answer = readDrivenPath(admin, env, orgId, loadId, new Date(nowMs));
  const entry: Entry = { startedAtMs: nowMs, answer };
  entries.set(key, entry);
  answer.catch(() => {
    if (entries.get(key) === entry) entries.delete(key);
  });
  return answer;
}

/** Drop everything. For tests only — production entries age out on their own. */
export function __resetDrivenPathCache(): void {
  entries.clear();
}
