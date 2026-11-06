import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { settingsFeedTargets, type OutcomeFeedTargets } from "./feedTarget.js";

/**
 * The `ads-outcome-feed` scheduler (B6; docs/WORKER-DEPLOYMENT.md, ads row): once a day, one `ads_outcome_feed`
 * job per `connected` or `failing` Meta or simulator connection whose carrier has a feed target (`feedTarget.ts`:
 * the settings version in force, Q-AD40). Meta asks
 * for an upload "at least once per day" (CRM guide); an event older than 7 days is refused, so a daily run
 * keeps a day's outage well inside the window. Daily from boot, like `ads-reconcile`, for its reason: no hour
 * matters, and a second clock is a second thing to keep right. `dedup_key` = `ads_outcome_feed:<connection>`.
 *
 * A carrier is queued only when its settings turn the feed on with a dataset; a simulator connection only where
 * `simulatorGate` allows (both in `settingsFeedTargets`).
 * Off unless `ADS_ENABLED`. First tick 20 minutes after boot, after reconcile's 15.
 */
export const ADS_OUTCOME_FEED_MS = 24 * 60 * 60_000;
const FIRST_TICK_MS = 20 * 60_000;
const PAGE = 500;

export const adsOutcomeFeedDedupKey = (connectionId: string): string => `ads_outcome_feed:${connectionId}`;
export type OutcomeEnqueue = (orgId: string, connectionId: string) => Promise<"queued" | "conflict">;

export async function outcomeFeedTick(admin: SupabaseClient, targets: OutcomeFeedTargets, enqueue: OutcomeEnqueue): Promise<{ connections: number; queued: number; off: number }> {
  const result = { connections: 0, queued: 0, off: 0 };
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from("ads_platform_connections").select("id, org_id")
      .in("provider", ["meta", "simulator"]).in("status", ["connected", "failing"]).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`ads_platform_connections: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; org_id: string }>;
    for (const c of rows) {
      result.connections += 1;
      if (!(await targets.targetFor(c.org_id, c.id))) result.off += 1;
      else if ((await enqueue(c.org_id, c.id)) === "queued") result.queued += 1;
    }
    if (rows.length < PAGE) return result;
  }
}

export function startAdsOutcomeFeed(env: Env): void {
  if (!env.ADS_ENABLED) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      const r = await outcomeFeedTick(admin, settingsFeedTargets(admin), async (orgId, connectionId) => {
        const d = await dispatchJob(admin, env, "ads_outcome_feed", { orgId, payload: { connectionId }, dedupKey: adsOutcomeFeedDedupKey(connectionId) });
        return "conflict" in d ? "conflict" : "queued";
      });
      if (r.queued > 0) console.log(`[ads-outcome-feed] ${r.queued} feed run(s) queued of ${r.connections} connection(s)`);
    } catch (error) {
      console.error(`[ads-outcome-feed] tick failed — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void run(), FIRST_TICK_MS);
  setInterval(() => void run(), ADS_OUTCOME_FEED_MS);
}
