import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { registerAllHandlers } from "./handlers/index.js";
import { getHandler } from "./registry.js";
import type { JobContext, QueueJob } from "./types.js";
import type { JobKind } from "../modules/org/index.js";

/**
 * The in-process drain — queued job ROWS get executed even though no queue consumer exists.
 *
 * Why: production runs `JOB_EXECUTION_MODE=inprocess`, where `dispatchJob` executes handlers
 * immediately and the jobs table is a LEDGER, not a queue — completed rows carry `locked_by null`
 * because nothing ever claims them. That is fine for every job born inside the app. It silently
 * strands any row INSERTED as data: the 2026-08-28 repair dispatch (the EFS window re-fetch and
 * the D-FS3 projection backfill, queued by the owner's one-command script) sat `queued` forever
 * while the process happily executed everything else around it.
 *
 * So the scheduler-owner process — which is also the WEX-whitelisted egress the EFS SOAP calls
 * require — drains a NAMED allowlist of kinds on a slow tick. Not a general consumer on purpose:
 * in queue mode the real consumer owns the table and this never starts, and in inprocess mode
 * only kinds that are legitimately dispatched-as-rows belong here. Growing the list is a code
 * change with this comment staring at you.
 *
 * Claiming is a compare-and-set UPDATE guarded on `status = 'queued'` — safe against a concurrent
 * queue-mode consumer by construction (this drain does not run in queue mode) and against a second
 * drain because schedulers run in exactly ONE process fleet-wide (docs/WORKER-DEPLOYMENT.md).
 */

const DRAIN_KINDS: JobKind[] = ["efs_window_refetch", "financial_projection"];
const TICK_MS = 2 * 60_000;
const WORKER_ID = "inprocess-drain";
const RETRY_BACKOFF_S = 120;

export function startInprocessJobDrain(env: Env): void {
  if (env.JOB_EXECUTION_MODE === "queue") return; // the real consumer owns the table
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  registerAllHandlers(); // idempotent (Map.set) — the app registers too, order is irrelevant

  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await drainOnce(env, getSupabaseAdmin(env));
    } catch (e) {
      console.error(`[job-drain] tick failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      running = false;
    }
  };

  setTimeout(() => void tick(), 45_000);
  setInterval(() => void tick(), TICK_MS);
  console.log(
    `[job-drain] inprocess drain on — kinds: ${DRAIN_KINDS.join(", ")} every ${TICK_MS / 60_000}m`,
  );
}

/** One drain pass — claim at most one due row, run it, settle it. Exported for its test. */
export async function drainOnce(
  env: Env,
  admin: ReturnType<typeof getSupabaseAdmin>,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data: candidates, error } = await admin
    .from("jobs")
    .select("id, org_id, kind, payload, attempts, max_attempts")
    .in("kind", DRAIN_KINDS)
    .eq("status", "queued")
    .lte("run_after", nowIso)
    .order("run_after", { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = (candidates ?? [])[0] as QueueJob | undefined;
  if (!row) return;

  // Compare-and-set claim: only a row still queued flips to running.
  const { data: claimed, error: claimErr } = await admin
    .from("jobs")
    .update({
      status: "running",
      locked_by: WORKER_ID,
      started_at: nowIso,
      attempts: row.attempts + 1,
      updated_at: nowIso,
    })
    .eq("id", row.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed) return; // raced — next tick finds the next row

  const handler = getHandler(row.kind);
  const ctx: JobContext = { admin, env };
  try {
    if (!handler) throw new Error(`no handler registered for kind ${row.kind}`);
    const stats = await handler(ctx, { ...row, attempts: row.attempts + 1 }, async () => undefined);
    await admin
      .from("jobs")
      .update({
        status: "done",
        stats: stats ?? {},
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    console.log(`[job-drain] ${row.kind} ${row.id} done`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const retry = row.attempts + 1 < row.max_attempts;
    await admin
      .from("jobs")
      .update(
        retry
          ? {
              status: "queued",
              error: message,
              locked_by: null,
              run_after: new Date(Date.now() + RETRY_BACKOFF_S * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            }
          : {
              status: "failed",
              error: message,
              finished_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
      )
      .eq("id", row.id);
    console.error(`[job-drain] ${row.kind} ${row.id} ${retry ? "requeued" : "FAILED"}: ${message}`);
  }
}
