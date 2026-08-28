import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { registerAllHandlers } from "./handlers/index.js";
import { getHandler } from "./registry.js";
import { pgQueueDriver } from "./pgDriver.js";
import type { JobContext } from "./types.js";
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
 * Claim/settle go through the SAME 0095 RPCs the queue consumer uses (`claim_next_job` /
 * `complete_job` / `fail_job`) — FOR UPDATE SKIP LOCKED, the attempts budget, backoff, all owned
 * by the jobs table's own interface rather than re-implemented here. The drain is only: which
 * process calls claim, for which kinds, on what tick.
 */

/**
 * Which kinds THIS instance may claim. Env-gated per kind because more than one process runs
 * schedulers in this deploy topology (the public web/api service and the WEX-whitelisted poller
 * service both do), and the first drain deploy proved they race: the web instance — where
 * EFS_SOAP_ENABLED is off — claimed the EFS re-fetch and failed it with "EFS_SOAP_ENABLED is
 * off" while the instance that could have run it watched. An instance that cannot execute a kind
 * must not be able to CLAIM it.
 */
function drainKinds(env: Env): JobKind[] {
  const kinds: JobKind[] = ["financial_projection"];
  if (env.EFS_SOAP_ENABLED) kinds.push("efs_window_refetch");
  return kinds;
}
const TICK_MS = 2 * 60_000;
const WORKER_ID = "inprocess-drain";
const RETRY_BACKOFF_S = 120;
const LEASE_SECONDS = 30 * 60;

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
    `[job-drain] inprocess drain on — kinds: ${drainKinds(env).join(", ")} every ${TICK_MS / 60_000}m`,
  );
}

/** One drain pass — claim at most one due row via the 0095 RPC, run it, settle it. Exported for its test. */
export async function drainOnce(
  env: Env,
  admin: ReturnType<typeof getSupabaseAdmin>,
): Promise<void> {
  const driver = pgQueueDriver(admin);
  // Long lease: the re-fetch walks multi-week EFS windows and the full projection reads two years.
  const job = await driver.claim(WORKER_ID, drainKinds(env), LEASE_SECONDS, {});
  if (!job) return;

  const handler = getHandler(job.kind);
  const ctx: JobContext = { admin, env };
  try {
    if (!handler) throw new Error(`no handler registered for kind ${job.kind}`);
    const stats = await handler(ctx, job, async () => undefined);
    await driver.complete(job.id, (stats ?? {}) as Record<string, unknown>);
    console.log(`[job-drain] ${job.kind} ${job.id} done`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await driver.fail(job.id, message, true, RETRY_BACKOFF_S);
    console.error(`[job-drain] ${job.kind} ${job.id} settled via fail_job: ${message}`);
  }
}
