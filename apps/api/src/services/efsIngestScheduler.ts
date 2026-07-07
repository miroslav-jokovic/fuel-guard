import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { runJob } from "./jobs.js";
import { runEfsIngest, buildIngestSource } from "./efsAutoIngest.js";

/**
 * Automated EFS report ingestion scheduler (in-process on the single Railway instance, like the Samsara
 * and digest schedulers). Every EFS_INGEST_MINUTES it lists each org's delivered reports and ingests
 * them through the idempotent write path. Each org runs through the jobs ledger (`efs_ingest`) so the UI
 * shows freshness/progress, failures are visible, and a manual run or a still-running prior tick can
 * never overlap (the ledger's partial unique index refuses a duplicate (org, kind)).
 *
 * Safety-first, assumption-free:
 *  - Disabled by default (EFS_INGEST_SOURCE=off) and when Supabase isn't configured (local dev).
 *  - An in-flight guard prevents a slow pass from overlapping the next tick.
 *  - A failure for one org is recorded on its job and never stops the other orgs' passes.
 *  - Idempotency (file hash + external_ref) means a re-delivered or re-listed report is a safe no-op.
 */

/** Every org — a delivered report could exist for any of them; runEfsIngest no-ops when none are found. */
async function allOrgIds(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin.from("organizations").select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((o) => o.id as string);
}

/** Ingest one org's delivered reports through the jobs ledger. Never throws — failures land on the job. */
async function ingestOrg(admin: SupabaseClient, env: Env, orgId: string): Promise<void> {
  const source = buildIngestSource(admin, env, orgId);
  if (!source) return; // source disabled/unconfigured for this env
  // runJob claims the (org, efs_ingest) slot, runs the batch in the background, and ALWAYS finishes the
  // job (done with stats, or failed with the error). A conflict → { conflict: true } is ignored (a run
  // is already active for this org). Work is captured so per-org outcomes reach the ledger + logs.
  await runJob(admin, orgId, "efs_ingest", async () => {
    const stats = await runEfsIngest(admin, env, source);
    if (stats.found > 0) {
      console.log(
        `[efs-ingest] org ${orgId}: found ${stats.found}, ingested ${stats.ingested}, quarantined ${stats.quarantined}`,
      );
    }
    return stats;
  });
}

export function startEfsIngestScheduler(env: Env): void {
  if (env.EFS_INGEST_SOURCE === "off") return; // disabled
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return; // not configured (e.g. local dev)

  const intervalMs = env.EFS_INGEST_MINUTES * 60_000;
  let running = false;
  const run = async () => {
    if (running) return; // don't let a slow pass overlap the next tick
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      for (const orgId of await allOrgIds(admin)) {
        await ingestOrg(admin, env, orgId);
      }
    } catch (e) {
      console.error("[efs-ingest] scheduler run failed:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };

  setTimeout(run, 60_000); // first pass ~1 min after boot
  setInterval(run, intervalMs);
  console.log(`[efs-ingest] auto-ingest enabled — source=${env.EFS_INGEST_SOURCE}, every ${env.EFS_INGEST_MINUTES}m`);
}
