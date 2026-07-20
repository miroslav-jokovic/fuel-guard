import type { Env } from "./env.js";
import { getSupabaseAdmin } from "./lib/supabaseAdmin.js";
import { reclaimInterruptedJobs } from "./services/jobs.js";
import { startSamsaraScheduler } from "./services/samsaraScheduler.js";
import { startRebuildOnBoot } from "./services/rebuildScheduler.js";
import { startDigestScheduler } from "./services/digestScheduler.js";
import { startNightlyReconcileScheduler } from "./services/nightlyReconcile.js";
import { startEfsIngestScheduler } from "./services/efsIngestScheduler.js";
import { startPostedPriceScheduler } from "./services/postedPriceFetch.js";

/**
 * Start every background scheduler (Samsara sync, rebuild-on-boot, weekly digest, nightly reconcile,
 * EFS auto-ingest, posted-price refresh). Extracted so a dedicated single-replica worker process can own
 * all background work while the API service scales horizontally (RUN_SCHEDULERS_IN_PROCESS=false).
 *
 * Run these in EXACTLY ONE process: either the single API instance (RUN_SCHEDULERS_IN_PROCESS defaults
 * true) or a single-replica worker service (API set to false) — never both, and never a multi-replica
 * worker, or the one scheduler without a job-ledger guard (rebuild-on-boot) would run twice.
 */
export function startAllSchedulers(env: Env): void {
  // Clear any job slots left "running" by the previous process before schedulers/buttons claim them.
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    reclaimInterruptedJobs(getSupabaseAdmin(env))
      .then((n) => n > 0 && console.log(`[jobs] reclaimed ${n} interrupted job(s) from the previous run`))
      .catch((e) => console.error("[jobs] reclaim failed:", e instanceof Error ? e.message : e));
  }
  startSamsaraScheduler(env); // background auto-refresh of Samsara data
  startRebuildOnBoot(env); // one-time anomaly rebuild with current rules (rules-only, idempotent)
  startDigestScheduler(env); // weekly AI theft digest email
  startNightlyReconcileScheduler(env); // per-org 03:00 self-heal: EFS repair -> rescore -> rebuild
  startEfsIngestScheduler(env); // per-org auto-ingest of EFS reports
  startPostedPriceScheduler(env); // global posted-price refresh from Pilot's public table
}
