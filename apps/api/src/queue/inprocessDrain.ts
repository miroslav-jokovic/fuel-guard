import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { registerAllHandlers } from "./handlers/index.js";
import { pgQueueDriver } from "./pgDriver.js";
import { executeJob } from "./worker.js";
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
  // `backfill` joins the list for the SAME reason the other two are on it: an operator queues one as a
  // ROW to run a repair that no schedule and no button covers. SAM-S6's full-history rebuild is that
  // repair — the manual route only offers `full` (a live Samsara re-fetch), and `nightlyReconcile`'s
  // rebuild carries its own claim (a 180-day window then, the stale-stamp claim since 0318), so an
  // UNCAPPED re-score of all history is reachable no other way. (The commit message that added this
  // line said that window was 14 days. It was 180 — see the correction in handlers/scoring.ts.)
  //
  // Low-risk in practice BECAUSE of how the kind is normally used: every routine caller
  // (samsaraScheduler's collector tier, the two manual buttons) goes through `dispatchJob`, which in
  // inprocess mode executes inline and writes a COMPLETED row. None of them leaves a `queued` row
  // behind, so this claims nothing that exists today — it only stops an operator's row from being
  // stranded the way the 2026-08-28 repair dispatch was.
  kinds.push("backfill");
  return kinds;
}
const TICK_MS = 2 * 60_000;
const WORKER_ID = "inprocess-drain";
const LEASE_SECONDS = 30 * 60;
/** Renew at a third of the lease, the same ratio the queue consumer defaults to. */
const RENEW_EVERY_MS = Math.floor((LEASE_SECONDS / 3) * 1000);

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

/**
 * One drain pass — claim at most one due row via the 0095 RPC, then hand it to the SAME executor the
 * queue consumer uses. Exported for its test.
 *
 * The execution half used to be hand-rolled here, and the copy had drifted into two defects that only
 * a long job could show. Measured 2026-09-05 on SAM-S6's full-history rebuild:
 *
 *  1. **No lease renewal.** The drain claimed a 30-minute lease and never renewed it, while
 *     `claim_next_job` reclaims any `running` row whose lease has expired — correct for a dead worker,
 *     wrong for a live slow one. A rebuild that needs three hours would have been re-claimed at minute
 *     thirty and a SECOND copy started on top of the first, both writing the same 15,954 rows. The
 *     lease had to be extended by hand to keep that from happening.
 *  2. **No progress.** It passed `async () => undefined` as the reporter, so a drained job could never
 *     write `jobs.progress`/`total` — a three-hour job read `0/None` from start to finish and had to be
 *     tracked by row timestamps instead.
 *
 * `executeJob` already solved both, and more besides: it refuses to COMPLETE a job whose lease it lost
 * (so a reclaimed job's newer worker is not overwritten by the old one finishing late), and it parks a
 * missing handler instead of retrying blindly against nothing. Calling it is strictly better than
 * repairing the copy — one executor, one set of semantics, no second place for them to drift apart.
 *
 * The one behaviour that changes: settle-on-failure now uses the consumer's exponential
 * `backoffSeconds(attempts)` rather than this file's flat 120s. That is the point of sharing it.
 */
export async function drainOnce(
  env: Env,
  admin: ReturnType<typeof getSupabaseAdmin>,
): Promise<void> {
  const driver = pgQueueDriver(admin);
  // Long lease: the re-fetch walks multi-week EFS windows, the full projection reads two years, and a
  // rebuild re-scores the whole fleet. Renewal is what makes the length safe rather than optimistic.
  const job = await driver.claim(WORKER_ID, drainKinds(env), LEASE_SECONDS, {});
  if (!job) return;

  const ctx: JobContext = { admin, env };
  const outcome = await executeJob(driver, ctx, job, {
    workerId: WORKER_ID,
    leaseSeconds: LEASE_SECONDS,
    renewEveryMs: RENEW_EVERY_MS,
  });
  console.log(`[job-drain] ${job.kind} ${job.id} ${outcome}`);
}
