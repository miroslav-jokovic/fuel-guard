import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { orgsWithEfsSoap } from "./efsSoapCredentials.js";

/**
 * EFS SOAP background poller — two independent tiers:
 *
 *  - **Rejected feed** every EFS_SOAP_REJECTED_POLL_MINUTES (default 5 min). Rejections are the
 *    fraud/control signal we want fresh. Runs in the "live" priority lane of the SOAP client so
 *    a slow posted-backfill can't starve them.
 *
 *  - **Posted feed** every EFS_SOAP_POSTED_POLL_MINUTES (default 15 min). Runs in the "backfill"
 *    lane; a big initial backfill is expected here.
 *
 * Both tiers wrap each org's pass in a jobs-ledger `runJob` call, using distinct kinds
 * (`efs_soap_posted`, `efs_soap_rejected`) so the two tiers never collide with each other or with
 * a manual "Sync now" click. The partial unique index on jobs(org, kind) is the enforcement.
 *
 * Safety posture (mirrors efsIngestScheduler.ts):
 *   • Disabled by default (env.EFS_SOAP_ENABLED=false) and when Supabase isn't configured (local dev).
 *   • In-flight guard prevents a slow pass from overlapping the next tick.
 *   • A failure for one org is recorded on its job and never stops the other orgs' passes.
 *   • Idempotency (SHA-256 file hash + external_ref) means a re-fetched cursor is a safe no-op.
 *
 * Legacy compatibility: a not_implemented result is still treated as a cold/skip state if an older
 * operation implementation is deployed during rollout.
 */

/** Generic tier loop copied from samsaraScheduler.ts's `startTier` — kept private here to avoid
 *  coupling the Samsara scheduler's exports. */
function startTier(
  label: string,
  firstDelayMs: number,
  intervalMs: number,
  run: () => Promise<void>,
): void {
  let running = false;
  const wrapped = async () => {
    if (running) return; // don't let a slow pass overlap the next tick
    running = true;
    try {
      await run();
    } catch (e) {
      console.error(`[efs-soap-sched] ${label} run failed:`, e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  setTimeout(wrapped, firstDelayMs);
  setInterval(wrapped, intervalMs);
}

/** Ingest one org's posted or rejected feed through the jobs ledger — never throws. */
async function ingestOrgFeed(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  feed: "posted" | "rejected",
): Promise<void> {
  const jobKind = feed === "posted" ? "efs_soap_posted" : "efs_soap_rejected";
  // Queue mode enqueues; inprocess runs the handler now (which does the ingest + logging). A conflict
  // means either this feed is already active or the scoring mutex is held by another job. It is safe to
  // skip because the next tick retries, but it must be visible: a persistent conflict is a freshness outage.
  const outcome = await dispatchJob(admin, env, jobKind, { orgId, payload: { feed } });
  if ("conflict" in outcome) {
    console.warn(`[efs-soap-sched] ${feed} poll skipped for org=${orgId}: job or scoring lock is active`);
  }
}

/**
 * Start both EFS SOAP polling tiers. Called from src/schedulers.ts::startAllSchedulers.
 *
 * Guards:
 *   • env.EFS_SOAP_ENABLED=false → do not start any timer (subsystem stays cold).
 *   • Missing Supabase config → do not start (local dev without a DB).
 *
 * These guards deliberately duplicate the checks inside runEfsSoapIngest: the ingest function's
 * checks defend against a mis-tuned env; NOT starting the interval at all when EFS_SOAP_ENABLED
 * is false saves the process a wakeup every 5 min for no work.
 */
export function startEfsSoapPoller(env: Env): void {
  if (!env.EFS_SOAP_ENABLED) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  const rejectedIntervalMs = env.EFS_SOAP_REJECTED_POLL_MINUTES * 60_000;
  const postedIntervalMs = env.EFS_SOAP_POSTED_POLL_MINUTES * 60_000;

  // Rejected feed — first pass 30s after boot (get fresh fraud signal quickly), then cadence.
  startTier("rejected", 30_000, rejectedIntervalMs, async () => {
    const admin = getSupabaseAdmin(env);
    for (const orgId of await orgsWithEfsSoap(admin, env)) {
      await ingestOrgFeed(admin, env, orgId, "rejected");
    }
  });

  // Posted feed — first pass 90s after boot (offset from rejected tier so the two don't stampede
  // together and share the SOAP client's paced slots more evenly).
  startTier("posted", 90_000, postedIntervalMs, async () => {
    const admin = getSupabaseAdmin(env);
    for (const orgId of await orgsWithEfsSoap(admin, env)) {
      await ingestOrgFeed(admin, env, orgId, "posted");
    }
  });

  console.log(
    `[efs-soap-sched] enabled — rejected every ${env.EFS_SOAP_REJECTED_POLL_MINUTES}m, ` +
      `posted every ${env.EFS_SOAP_POSTED_POLL_MINUTES}m`,
  );
}
