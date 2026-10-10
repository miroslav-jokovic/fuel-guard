import type { SupabaseClient } from "@supabase/supabase-js";
import { parseHosClockReadings } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { loadSamsaraToken } from "./lib/samsaraToken.js";
import { makeSamsaraHosClocksFetcher, type SamsaraHosClocksFetcher } from "./lib/samsara.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";
import { orgsToSync, startTier } from "./lib/tierRunner.js";

/**
 * Every driver's remaining HOS clocks, kept current for the dispatch board (DISPATCH-BOARD-PLAN DB3,
 * table 0450).
 *
 * ── WHY A TIER OF ITS OWN ────────────────────────────────────────────────────────────────────────
 * `/fleet/hos/clocks` already feeds two things: `syncHosCurrentStatus`, which stamps the duty badge onto
 * `drivers` inside the six-hour driver-scores tier, and fuel planning, which asks it live and forgets.
 * A dispatcher deciding whether a truck can make a 06:00 delivery needs the drive and shift time left
 * NOW — a six-hour-old "on duty" answers nothing. One call returns the whole fleet, so polling it every
 * five minutes is 288 requests a day against a 50 req/s budget.
 *
 * ── NOT IN THE JOBS LEDGER, AND KEPT TINY ────────────────────────────────────────────────────────
 * The positions tier's reasoning: a ledger row for every five-minute poll is 288 rows a day per org to
 * record that a poll ran, and the freshness signal is the data's own `fetched_at`. And this does no
 * per-row work in JavaScript beyond one parse — the 2026-10-06 incident (`sync_hos` froze the API for
 * five minutes every six hours) was a per-row loop on the request process, and this tier runs there too.
 *
 * ── REPLACE THE SET ──────────────────────────────────────────────────────────────────────────────
 * The poll writes every driver Samsara returned, stamped with one `fetched_at`, then deletes the org's
 * rows older than that stamp: a driver Samsara stopped returning (deactivated, removed) must not leave
 * a clock behind that the board would read as "11 h of drive left". A failed fetch throws before the
 * delete, so an outage leaves the last good set in place for the reader to call stale.
 *
 * Service role: the `.eq("org_id", …)` on every statement is the only tenant boundary.
 */

export interface HosClocksResult {
  drivers: number;
  removed: number;
}

/** Postgres takes a large batch happily; PostgREST's body limit is the constraint, not the row count. */
const BATCH = 500;

export async function syncHosClocks(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: { clocksFetcher?: SamsaraHosClocksFetcher; now?: Date } = {},
): Promise<HosClocksResult> {
  const token = opts.clocksFetcher ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();
  const raw = await (opts.clocksFetcher ?? makeSamsaraHosClocksFetcher(env, token))();
  const fetchedAt = (opts.now ?? new Date()).toISOString();

  const rows = parseHosClockReadings(raw.data ?? []).map((r) => ({
    org_id: orgId,
    samsara_driver_id: r.driverId,
    samsara_vehicle_id: r.vehicleId,
    duty_status: r.status,
    drive_remaining_ms: r.driveRemainingMs,
    shift_remaining_ms: r.shiftRemainingMs,
    cycle_remaining_ms: r.cycleRemainingMs,
    break_remaining_ms: r.timeUntilBreakMs,
    fetched_at: fetchedAt,
  }));
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await admin
      .from("driver_hos_clocks")
      .upsert(rows.slice(i, i + BATCH), { onConflict: "org_id,samsara_driver_id" });
    if (error) throw new Error(`driver_hos_clocks write failed: ${error.message}`);
  }

  const { error: delErr, count } = await admin
    .from("driver_hos_clocks")
    .delete({ count: "exact" })
    .eq("org_id", orgId)
    .lt("fetched_at", fetchedAt);
  if (delErr) throw new Error(`driver_hos_clocks prune failed: ${delErr.message}`);
  return { drivers: rows.length, removed: count ?? 0 };
}

/**
 * Started by `startSamsaraScheduler`. First tick at five minutes: the deploy window
 * (docs/MIGRATION-DISCIPLINE.md §the-deploy-window) can serve this code before 0450 exists, and a
 * tick inside it simply fails and is repeated by the next one.
 */
export function startHosClocksTier(env: Env): void {
  startTier(env, "hos-clocks", 300_000, env.SAMSARA_HOS_CLOCKS_SYNC_MINUTES * 60_000, async (admin) => {
    for (const orgId of await orgsToSync(admin, env)) {
      try {
        await syncHosClocks(admin, env, orgId);
      } catch (e) {
        if (e instanceof NoSamsaraTokenError) continue; // an unconfigured org is not a failure
        console.error(`[samsara-sched] hos-clocks failed for org ${orgId}:`, e instanceof Error ? e.message : e);
      }
    }
  });
}
