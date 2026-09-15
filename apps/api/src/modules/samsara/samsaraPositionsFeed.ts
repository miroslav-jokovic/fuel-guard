/**
 * WHERE EVERY TRUCK IS, EVERY FIVE SECONDS — the live map's collector (LIVE-MAP-PLAN.md LM4, D-LM1d).
 *
 * ── THERE IS NO WEBHOOK, AND THE VENDOR SAYS SO ITSELF ───────────────────────────────────────────
 * Samsara webhooks carry DISCRETE EVENTS. Four are GA (`AlertIncident`, `DvirSubmitted`,
 * `SevereSpeedingStarted/Ended`) and nothing in the beta set emits a position on a schedule. Samsara's
 * own TMS integration guide prescribes the alternative for live tracking: poll
 * `GET /fleet/vehicles/stats/feed` every 5–30 seconds. Independently, our production token is
 * read-only for Webhooks and Alerts — every write 401s — so no subscription could be created from
 * here even if one existed (D-LM1, and `samsara-webhook-has-no-alert-to-listen-to` measured it).
 *
 * ── THE CADENCE IS THE VENDOR'S FLOOR, NOT AN AMBITION ───────────────────────────────────────────
 * "You should not request updates more frequently than 5 seconds." Five seconds is the bottom of the
 * recommended range, and it costs 0.2 req/s against a 50 req/s per-org limit — 0.4% of the budget for
 * the freshest board the API can give. `SAMSARA_POSITIONS_SYNC_SECONDS` is the knob; the floor is the
 * reason for the default, not the default's justification after the fact.
 *
 * ── WHAT THIS TIER DOES NOT DO ───────────────────────────────────────────────────────────────────
 * It writes ONE row per truck and keeps no history (0341's header carries the owner's ruling and the
 * gap-recovery path at the vendor). It files no alert, notifies nobody, and derives nothing: whether a
 * truck is `moving`, `stopped` or `offline` is LM5's pure layer, so the map, a future report and the
 * driver app cannot disagree about the same truck. A collector that also judged would be the second
 * source of truth this plan is arranged against.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { accumulateGpsFeedPage, feedPageHasData, latestGpsFix, type GpsFix } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { loadSamsaraToken } from "./lib/samsaraToken.js";
import {
  makeSamsaraPositionsFeedFetcher,
  type SamsaraPositionsFeedFetcher,
} from "./lib/samsara.js";
import {
  readFeedCursor,
  persistFeedCursorQuietly,
  VEHICLE_POSITIONS_FEED,
} from "./lib/feedCursor.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";

/**
 * Runaway guard on pages per run — NOT a completeness bound, and copied from `STATS_FEED_MAX_PAGES`
 * for the same reason it exists there.
 *
 * ⚠ The walk stops on an EMPTY page, never on `pagination.hasNextPage`. Measured on the live feed
 * 2026-09-01, twelve pages deep, including on a single-sample page and on an immediate re-poll of an
 * idle fleet: `hasNextPage` is `true` on every page, forever. On a delta feed it means "this stream
 * continues", not "there is more right now", and a `while (hasNextPage)` walk hangs the scheduler tick
 * for good. This cap exists only so a vendor that never returns an empty page cannot do the same.
 *
 * 50 rather than the stats tier's 200: this feed is polled 240× more often, so a seed walk is drained
 * within seconds of the first tick and every subsequent tick reads one page. Hitting the cap is
 * reported (`pagesCapped`) and the cursor still advanced, so the rest arrives 5 seconds later.
 */
export const POSITIONS_FEED_MAX_PAGES = 50;

export interface VehiclePositionsFeedResult {
  /** Trucks whose stored position actually moved forward in time — the RPC's own row count. */
  written: number;
  pages: number;
  /** GPS pings read across every page, before reduction to one fix per truck. */
  fixes: number;
  /** Trucks the feed spoke about that are not mapped to a vehicle row here. */
  unmappedVehicles: number;
  /** True when the page cap stopped the walk — the cursor still advanced. */
  pagesCapped: boolean;
  /** Whether this run resumed from a stored cursor or seeded the feed from its head. */
  resumed: boolean;
  /**
   * The writer function does not exist in this database yet. NOT a failure: 0342 and this reader can
   * be served in the same merge, and Railway serves a merge before `migrate.yml` applies the schema
   * (docs/MIGRATION-DISCIPLINE.md §the-deploy-window). A tick inside that window has nowhere to put
   * its fixes, so it stores no cursor either and the next tick re-reads the same page. Reported rather
   * than swallowed, because "the map is empty and nothing is wrong" needs to be a thing the tier can
   * say out loud.
   */
  writerMissing: boolean;
}

type VehicleRow = { id: string; samsara_vehicle_id: string };

/** The payload row `record_vehicle_positions` destructures. Named for its SQL columns, not camelCase. */
type PositionRow = {
  vehicle_id: string;
  lat: number;
  lng: number;
  heading_degrees: number | null;
  speed_mph: number | null;
  is_ecu_speed: boolean | null;
  formatted_location: string | null;
  sampled_at: string;
};

export interface PositionsFeedOpts {
  /** Injected in tests; production builds one from the org's token. */
  fetcher?: SamsaraPositionsFeedFetcher;
}

/**
 * Postgres and PostgREST each have their own way of saying "no such function", and the deploy window
 * produces both depending on whether PostgREST has reloaded its schema cache. Neither is an outage.
 */
const isMissingWriter = (e: { code?: string; message?: string } | null): boolean =>
  e?.code === "42883" || e?.code === "PGRST202" || /record_vehicle_positions/.test(e?.message ?? "");

export async function syncVehiclePositionsFromSamsara(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: PositionsFeedOpts = {},
): Promise<VehiclePositionsFeedResult> {
  const token = opts.fetcher ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();
  const fetch = opts.fetcher ?? makeSamsaraPositionsFeedFetcher(env, token);

  const startCursor = await readFeedCursor(admin, orgId, VEHICLE_POSITIONS_FEED);
  const result: VehiclePositionsFeedResult = {
    written: 0, pages: 0, fixes: 0, unmappedVehicles: 0,
    pagesCapped: false, resumed: startCursor != null, writerMissing: false,
  };

  // ── Walk the delta, accumulating across pages ─────────────────────────────────────────────────
  // Merged before anything is reduced: the newest ping for a truck can sit on an EARLIER page than
  // one of its older pings, so choosing a winner per page would pick the wrong fix at a boundary.
  const byVehicle = new Map<string, GpsFix[]>();
  let cursor = startCursor;
  for (let page = 0; page < POSITIONS_FEED_MAX_PAGES; page++) {
    const body = await fetch(cursor ?? undefined);
    result.pages++;
    if (!feedPageHasData(body)) break;
    accumulateGpsFeedPage(body, byVehicle);
    const next = body.pagination?.endCursor;
    if (typeof next !== "string" || !next.trim() || next === cursor) break;
    cursor = next;
    if (page === POSITIONS_FEED_MAX_PAGES - 1) result.pagesCapped = true;
  }
  for (const fixes of byVehicle.values()) result.fixes += fixes.length;

  if (byVehicle.size > 0) await applyFixes(admin, orgId, byVehicle, result);

  // Only now. A cursor moved past fixes we failed to store would lose them silently — and because this
  // table holds the CURRENT position and no history, "silently" would mean a truck frozen on the map
  // at its last stored place with nothing anywhere recording that we skipped its next one.
  if (!result.writerMissing && cursor && cursor !== startCursor) {
    await persistFeedCursorQuietly(admin, orgId, VEHICLE_POSITIONS_FEED, cursor);
  }
  return result;
}

/**
 * Resolve Samsara ids to our vehicles, reduce each truck to its newest fix, and write the tick.
 *
 * The vehicle read is deliberately narrow — two columns — and org-scoped in the query, because `admin`
 * is the SERVICE ROLE and bypasses RLS: this `.eq("org_id", …)` is the only tenant boundary the read
 * has, and `expectOrgScoped` is the test that proves it did not get dropped.
 */
async function applyFixes(
  admin: SupabaseClient,
  orgId: string,
  byVehicle: Map<string, GpsFix[]>,
  result: VehiclePositionsFeedResult,
): Promise<void> {
  const { data: rows } = await admin
    .from("vehicles")
    .select("id, samsara_vehicle_id")
    .eq("org_id", orgId)
    .not("samsara_vehicle_id", "is", null);

  const idBySamsara = new Map<string, string>();
  for (const r of (rows ?? []) as unknown as VehicleRow[]) idBySamsara.set(r.samsara_vehicle_id, r.id);

  const payload: PositionRow[] = [];
  for (const [samsaraId, fixes] of byVehicle) {
    const vehicleId = idBySamsara.get(samsaraId);
    if (!vehicleId) {
      // A truck Samsara reports and the roster does not carry yet. Counted, never invented: creating a
      // vehicle row from a GPS ping would make the identity tier's job a race, and `vehicles` is
      // roster-owned (D-ARC3). The identity tier picks it up within 12 hours and its next fix lands.
      result.unmappedVehicles++;
      continue;
    }
    const fix = latestGpsFix(fixes);
    if (!fix) continue;
    payload.push({
      vehicle_id: vehicleId,
      lat: fix.lat,
      lng: fix.lng,
      heading_degrees: fix.headingDegrees,
      speed_mph: fix.speedMph,
      is_ecu_speed: fix.isEcuSpeed,
      formatted_location: fix.formattedLocation,
      sampled_at: fix.time,
    });
  }
  if (payload.length === 0) return;

  const { data, error } = await admin.rpc("record_vehicle_positions", { p_org: orgId, p_rows: payload });
  if (error) {
    if (isMissingWriter(error)) {
      result.writerMissing = true;
      return;
    }
    throw error;
  }
  result.written = typeof data === "number" ? data : 0;
}
