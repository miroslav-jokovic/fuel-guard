import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { dispatchJob } from "../../../queue/dispatch.js";

const INTERVAL_MS = 30_000;

/**
 * How long a run may go WITHOUT WRITING before we treat its worker as gone. MUST match the interval
 * in `claim_efs_processing_run` (migration 0317) — the scheduler only offers a stranded run, the
 * claim decides whether it is really stranded, so a scheduler that offered rows the claim still
 * refuses would just log conflicts forever.
 *
 * Last write, not start time: a working run touches its row every 2 minutes (`startHeartbeat` in
 * efsProcessing.ts), so 20 minutes is ten missed heartbeats. There is deliberately no ceiling on how
 * long a run may take — an ordinary ~260-row poll finishes in 40s while the April 2026 historical
 * re-fetch took ~64 minutes for 1,074 fills, and no single duration is right for both.
 */
export const STRANDED_AFTER_MS = 20 * 60_000;

/**
 * Runs the claim will accept: `pending`/`failed` that are due, plus a run stranded mid-scoring.
 *
 * Two queries rather than one `.or()`: the two halves test DIFFERENT columns (`next_attempt_at` for
 * the retry ladder, `updated_at` for the lease), and PostgREST's `or=` would need the whole
 * predicate as one string — which is how a filter silently stops matching after a column rename.
 */
export async function dueRunIds(admin: SupabaseClient): Promise<{ id: string; org_id: string }[]> {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await admin
    .from("efs_processing_runs")
    .select("id, org_id")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(25);
  if (error) throw new Error(error.message);

  const { data: stranded, error: strandedError } = await admin
    .from("efs_processing_runs")
    .select("id, org_id")
    .eq("status", "running")
    .lt("updated_at", new Date(Date.now() - STRANDED_AFTER_MS).toISOString())
    .order("updated_at", { ascending: true })
    .limit(25);
  if (strandedError) throw new Error(strandedError.message);

  const rows = [...((due ?? []) as { id: string; org_id: string }[])];
  const seen = new Set(rows.map((r) => r.id));
  for (const row of (stranded ?? []) as { id: string; org_id: string }[]) {
    if (!seen.has(row.id)) rows.push(row);
  }
  if (stranded?.length) {
    // Visible on purpose. A run being reclaimed means a worker died holding it; a steady trickle of
    // these is a symptom to chase, and the silence around it is what let 58 accumulate unnoticed.
    console.warn(`[efs-processing] reclaiming ${stranded.length} run(s) stranded mid-scoring`);
  }
  return rows;
}

async function dispatchDue(admin: SupabaseClient, env: Env): Promise<void> {
  const data = await dueRunIds(admin);

  for (const row of data) {
    const result = await dispatchJob(admin, env, "efs_process_import", {
      orgId: row.org_id,
      payload: { processingId: row.id },
      dedupKey: `efs-processing:${row.id}`,
    });
    if ("conflict" in result) {
      console.warn(`[efs-processing] scoring lane busy for processing=${row.id}; retrying on next tick`);
    }
  }
}

export function startEfsProcessingScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await dispatchDue(getSupabaseAdmin(env), env);
    } catch (e) {
      console.error("[efs-processing] scheduler run failed:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 10_000);
  setInterval(run, INTERVAL_MS);
  console.log("[efs-processing] post-ingest processor enabled — every 30s");
}
