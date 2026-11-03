import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { metaConnectionsTick, type BackfillEnqueue } from "../leads/backfillTick.js";

/**
 * The `ads-insights` scheduler (B5a; docs/WORKER-DEPLOYMENT.md, ads row): every hour, one `ads_insights` job
 * per Meta (or simulator) connection that is `connected` or `failing` — the same tenant-wide read as the
 * leads backfill (`metaConnectionsTick`), so a dead token's job runs and fails loudly instead of skipping.
 * The job, not the tick, talks to Meta (`queue/handlers/adsInsights.ts` → `insightsPull.ts`).
 *
 * `dedup_key` = `ads_insights:<connection>` (workflow M4): a carrier's second connection gets its own slot,
 * and a tick that finds the last hour's job still running skips — the window is re-read whole every hour,
 * so a skipped hour loses nothing.
 *
 * Off unless `ADS_ENABLED`, like every ads scheduler but the orchestrator's brake. First tick seven minutes
 * after boot: after the backfill's five, so a deploy's restart does not send both reads to Meta together.
 */
export const ADS_INSIGHTS_MS = 60 * 60_000;
const FIRST_TICK_MS = 7 * 60_000;

export const adsInsightsDedupKey = (connectionId: string): string => `ads_insights:${connectionId}`;

export function insightsEnqueue(admin: ReturnType<typeof getSupabaseAdmin>, env: Env): BackfillEnqueue {
  return async (orgId, connectionId) => {
    const r = await dispatchJob(admin, env, "ads_insights", { orgId, payload: { connectionId }, dedupKey: adsInsightsDedupKey(connectionId) });
    return "conflict" in r ? "conflict" : "queued";
  };
}

export function startAdsInsights(env: Env): void {
  if (!env.ADS_ENABLED) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      const r = await metaConnectionsTick(admin, insightsEnqueue(admin, env));
      if (r.queued > 0) console.log(`[ads-insights] ${r.queued} pull(s) queued of ${r.connections} connection(s)`);
    } catch (error) {
      console.error(`[ads-insights] tick failed — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void run(), FIRST_TICK_MS);
  setInterval(() => void run(), ADS_INSIGHTS_MS);
}
