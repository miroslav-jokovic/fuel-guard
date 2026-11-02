import type { SupabaseClient } from "@supabase/supabase-js";
import { CAMPAIGN_STATES, type CampaignState } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { settingsInForce } from "../settings/settingsVersions.js";
import { agentHasWork, adsWorkers, type CampaignWorkers } from "./workers.js";

/**
 * The `ads-orchestrator` scheduler (A6; `docs/WORKER-DEPLOYMENT.md` § Ads). Every minute it finds the
 * campaigns the agent has work in and enqueues one `ads_step` job for each. It ONLY enqueues: no
 * vendor call, no state write, so a tick on a standby that loses its lane's lease mid-run leaves at
 * most a queued job, which the next holder runs once.
 *
 * ⚠ `dedup_key` = `ads_step:<campaign id>:<state>` (workflow §1.2-4). Without one, the jobs ledger
 * allows ONE active job per (org, kind) (`0095_jobs_queue.sql`), so an org's second campaign would
 * wait silently behind its first. With it, each campaign has its own slot, and a state has at most one
 * step in flight: a tick that finds the same campaign in the same state again gets a conflict, which
 * is the queue saying "already on it", not an error.
 *
 * Every minute because the kill switch's second half lives here: a pressed switch reaches a live ad's
 * pause within one tick. The read is one query over the states the agent can act in, plus one settings
 * read per org found — nothing on almost every tick.
 */
export const ADS_TICK_MS = 60_000;

export type Enqueue = (orgId: string, campaignId: string, state: CampaignState) => Promise<"queued" | "conflict">;

export interface TickResult {
  campaigns: number;
  queued: number;
  conflicts: number;
}

const PAGE = 1000;

export async function orchestratorTick(admin: SupabaseClient, workers: CampaignWorkers, enqueue: Enqueue): Promise<TickResult> {
  const result: TickResult = { campaigns: 0, queued: 0, conflicts: 0 };
  const kill = new Map<string, boolean>();
  // The states the agent could have work in at all — with the switch pressed, the widest set — read
  // from `agentHasWork` rather than listed, so a worker that lands widens the tick by itself.
  const candidates = CAMPAIGN_STATES.filter((s) => agentHasWork(s, workers, true));
  if (candidates.length === 0) return result;
  // Keyset pages: PostgREST answers at most 1,000 rows, and a short page is the only proof of the end.
  for (let after = ""; ;) {
    let q = admin.from("ads_campaigns").select("id, org_id, state").in("state", candidates).order("id").limit(PAGE);
    if (after) q = q.gt("id", after);
    const { data, error } = await q;
    if (error) throw new Error(`ads_campaigns: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; org_id: string; state: CampaignState }>;
    for (const c of rows) {
      result.campaigns += 1;
      if (!kill.has(c.org_id)) kill.set(c.org_id, (await settingsInForce(admin, c.org_id)).kill_switch);
      if (!agentHasWork(c.state, workers, kill.get(c.org_id)!)) continue;
      if ((await enqueue(c.org_id, c.id, c.state)) === "queued") result.queued += 1;
      else result.conflicts += 1;
    }
    if (rows.length < PAGE) return result;
    after = rows[rows.length - 1]!.id;
  }
}

export const adsStepDedupKey = (campaignId: string, state: CampaignState): string => `ads_step:${campaignId}:${state}`;

/** The tick's enqueue: one `ads_step` per campaign + state, through the queue's own dedup slot. */
export function adsStepEnqueue(admin: SupabaseClient, env: Env): Enqueue {
  return async (orgId, campaignId, state) => {
    const r = await dispatchJob(admin, env, "ads_step", { orgId, payload: { campaignId, state }, dedupKey: adsStepDedupKey(campaignId, state) });
    return "conflict" in r ? "conflict" : "queued";
  };
}

export function startAdsOrchestrator(env: Env): void {
  if (!env.ADS_ENABLED) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      const r = await orchestratorTick(admin, adsWorkers(), adsStepEnqueue(admin, env));
      if (r.queued > 0) console.log(`[ads-orchestrator] ${r.queued} step(s) queued of ${r.campaigns} campaign(s) not at rest`);
    } catch (error) {
      console.error(`[ads-orchestrator] tick failed — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void run(), 90_000);
  setInterval(() => void run(), ADS_TICK_MS);
}
