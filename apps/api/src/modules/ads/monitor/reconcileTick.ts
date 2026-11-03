import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { metaConnectionsTick, type BackfillEnqueue } from "../leads/backfillTick.js";

/**
 * The `ads-reconcile` scheduler (B5c; docs/WORKER-DEPLOYMENT.md, ads row): once a day, one `ads_reconcile`
 * job per Meta (or simulator) connection that is `connected` or `failing` — the same connection read as the
 * hourly jobs (`metaConnectionsTick`). The job re-reads 28 days of insights and compares what Meta holds with
 * what we hold (`reconcile.ts`).
 *
 * Daily, not at a fixed hour: an interval from boot. The comparison has no time of day it must run at — the
 * hourly checks are the fast path for money, this is the slow net for edits — and an hourly tick that
 * asked "is it 06:00 yet?" would be a second clock to keep right across deploys. `dedup_key` =
 * `ads_reconcile:<connection>`, so a restart inside a day that finds yesterday's job running skips.
 *
 * Off unless `ADS_ENABLED`. First tick fifteen minutes after boot, after the hourly jobs' first runs.
 */
export const ADS_RECONCILE_MS = 24 * 60 * 60_000;
const FIRST_TICK_MS = 15 * 60_000;

export const adsReconcileDedupKey = (connectionId: string): string => `ads_reconcile:${connectionId}`;

export function reconcileEnqueue(admin: ReturnType<typeof getSupabaseAdmin>, env: Env): BackfillEnqueue {
  return async (orgId, connectionId) => {
    const r = await dispatchJob(admin, env, "ads_reconcile", { orgId, payload: { connectionId }, dedupKey: adsReconcileDedupKey(connectionId) });
    return "conflict" in r ? "conflict" : "queued";
  };
}

export function startAdsReconcile(env: Env): void {
  if (!env.ADS_ENABLED) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      const r = await metaConnectionsTick(admin, reconcileEnqueue(admin, env));
      if (r.queued > 0) console.log(`[ads-reconcile] ${r.queued} reconcile(s) queued of ${r.connections} connection(s)`);
    } catch (error) {
      console.error(`[ads-reconcile] tick failed — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void run(), FIRST_TICK_MS);
  setInterval(() => void run(), ADS_RECONCILE_MS);
}
