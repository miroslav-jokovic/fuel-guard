import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { metaConnectionsTick, type ConnectionEnqueue } from "../connections/connectionsTick.js";

/**
 * The `ads-leads-backfill` scheduler (B4a2; docs/WORKER-DEPLOYMENT.md, ads row): every hour, one
 * `ads_leads_backfill` job per Meta (or simulator) connection that is `connected` OR `failing`, across every carrier — the
 * scheduler's one tenant-wide read, the same shape as the orchestrator's tick. The job, not the tick, talks
 * to Meta and to recruiting's sink (`queue/handlers/adsLeadsBackfill.ts`).
 *
 * `dedup_key` = `ads_leads_backfill:<connection>` (workflow M4: without a key, one active job per
 * (org, kind), so a carrier's second connection would wait behind its first). A tick that finds a
 * connection's last job still running is the queue saying "already on it": the window overlaps, so
 * nothing is missed by skipping an hour.
 *
 * Off unless `ADS_ENABLED`, like every ads scheduler; first tick five minutes after boot, so a deploy's
 * restart does not stampede Meta with every carrier's read at once.
 */
export const ADS_LEADS_BACKFILL_MS = 60 * 60_000;
const FIRST_TICK_MS = 5 * 60_000;

export const adsLeadsBackfillDedupKey = (connectionId: string): string => `ads_leads_backfill:${connectionId}`;
export type BackfillEnqueue = ConnectionEnqueue;

export const leadsBackfillTick = metaConnectionsTick;

export function leadsBackfillEnqueue(admin: SupabaseClient, env: Env): BackfillEnqueue {
  return async (orgId, connectionId) => {
    const r = await dispatchJob(admin, env, "ads_leads_backfill", {
      orgId, payload: { connectionId }, dedupKey: adsLeadsBackfillDedupKey(connectionId),
    });
    return "conflict" in r ? "conflict" : "queued";
  };
}

export function startAdsLeadsBackfill(env: Env): void {
  if (!env.ADS_ENABLED) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      const r = await leadsBackfillTick(admin, leadsBackfillEnqueue(admin, env));
      if (r.queued > 0) console.log(`[ads-leads-backfill] ${r.queued} backfill(s) queued of ${r.connections} connection(s)`);
    } catch (error) {
      console.error(`[ads-leads-backfill] tick failed — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void run(), FIRST_TICK_MS);
  setInterval(() => void run(), ADS_LEADS_BACKFILL_MS);
}
