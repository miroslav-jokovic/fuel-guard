import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { relinkDispatchMovements } from "./dispatchProjection.js";

/**
 * The relink pass on a clock (LOADS-ACTIVITY-PLAN D-LA3; PLATFORM-RELIABILITY-PLAN D-RLY12) — moved
 * out of `POST /api/tms/dispatch-movements`, where it re-read 60 days of movements after every
 * one-movement batch. `relinkDispatchMovements` says what it does and why it moved.
 *
 * One process fleet-wide, like every scheduler (`docs/WORKER-DEPLOYMENT.md`): registered in the
 * `general` lane (`schedulers.ts`), so it runs where that lane's lease is held. Two copies would only
 * write the same links twice — the pass reads what is stale and writes what the projection says — but
 * the lease means there are not two.
 *
 * Every ten minutes: a driver added to the roster gets their closed deliveries back within the same
 * coffee break, and a pass that finds nothing stale costs ~10 reads.
 */
export const RELINK_EVERY_MINUTES = 10;
/**
 * How far back the pass looks: the Activity view's longest question is weeks, and 60 days keeps it to
 * the ~1,500 movements a 25-a-day carrier closes (1,025 measured 2026-10-21).
 */
export const RELINK_WINDOW_DAYS = 60;

/** The orgs whose agent can post movements: an enabled integration with an ingest token, as `orgForIngestToken` accepts. */
async function agentIntegrations(admin: SupabaseClient): Promise<{ orgId: string; provider: string }[]> {
  const { data, error } = await admin
    .from("org_integrations")
    .select("org_id, provider")
    .eq("enabled", true)
    .not("ingest_token_hash", "is", null);
  if (error) throw new Error(`org_integrations read: ${error.message}`);
  return ((data ?? []) as { org_id: string; provider: string }[]).map((r) => ({ orgId: r.org_id, provider: r.provider }));
}

/** One pass over every agent's org. A failing org is logged and retried next pass; it never stops the others. */
export async function runRelinkPass(admin: SupabaseClient, nowMs: number = Date.now()): Promise<{ relinked: number; failed: number }> {
  const since = new Date(nowMs - RELINK_WINDOW_DAYS * 86_400_000).toISOString();
  let relinked = 0;
  let failed = 0;
  for (const { orgId, provider } of await agentIntegrations(admin)) {
    try {
      const out = await relinkDispatchMovements(admin, orgId, provider, since);
      relinked += out.relinked;
      if (out.relinked > 0) console.log(`[mcleod-relink] org ${orgId}: relinked ${out.relinked} load(s)`);
    } catch (error) {
      failed++;
      console.error(`[mcleod-relink] org ${orgId}: pass failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { relinked, failed };
}

export function startMcleodRelinkScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runRelinkPass(getSupabaseAdmin(env));
    } catch (error) {
      console.error(`[mcleod-relink] pass failed — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void run(), 3 * 60_000);
  setInterval(() => void run(), RELINK_EVERY_MINUTES * 60_000);
}
