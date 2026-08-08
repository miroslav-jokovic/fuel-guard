import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { dispatchJob } from "./queue/dispatch.js";

const INTERVAL_MS = 30_000;

async function dispatchDue(admin: SupabaseClient, env: Env): Promise<void> {
  const { data, error } = await admin
    .from("efs_processing_runs")
    .select("id, org_id")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(25);
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as { id: string; org_id: string }[]) {
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
