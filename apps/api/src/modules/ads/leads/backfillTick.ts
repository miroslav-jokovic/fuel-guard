import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { dispatchJob } from "../../../queue/dispatch.js";

/**
 * The `ads-leads-backfill` scheduler (B4a2; docs/WORKER-DEPLOYMENT.md, ads row): every hour, one
 * `ads_leads_backfill` job per connected Meta (or simulator) connection, across every carrier — the
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
const PAGE = 500;

export const adsLeadsBackfillDedupKey = (connectionId: string): string => `ads_leads_backfill:${connectionId}`;
export type BackfillEnqueue = (orgId: string, connectionId: string) => Promise<"queued" | "conflict">;

export async function leadsBackfillTick(admin: SupabaseClient, enqueue: BackfillEnqueue): Promise<{ connections: number; queued: number; conflicts: number }> {
  const result = { connections: 0, queued: 0, conflicts: 0 };
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("ads_platform_connections")
      .select("id, org_id")
      .in("provider", ["meta", "simulator"])
      .eq("status", "connected")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`ads_platform_connections: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; org_id: string }>;
    for (const c of rows) {
      result.connections += 1;
      if ((await enqueue(c.org_id, c.id)) === "queued") result.queued += 1;
      else result.conflicts += 1;
    }
    if (rows.length < PAGE) return result;
  }
}

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
