import type { Env } from "./env.js";
import { getSupabaseAdmin } from "./lib/supabaseAdmin.js";
import { reclaimInterruptedJobs } from "./services/jobs.js";
import { startSamsaraScheduler } from "./modules/samsara/index.js";
import { startRebuildOnBoot } from "./services/rebuildScheduler.js";
import { startDigestScheduler } from "./services/digestScheduler.js";
import { startDqAlertScheduler } from "./modules/evidence/index.js";
import { startNightlyReconcileScheduler } from "./services/nightlyReconcile.js";
import { startEfsIngestScheduler } from "./modules/efs/services/efsIngestScheduler.js";
import { startEfsCardSyncScheduler } from "./modules/efs/services/efsCardSyncScheduler.js";
import { startEfsSoapPoller } from "./modules/efs/services/efsSoapPoller.js";
import { startEfsProcessingScheduler } from "./modules/efs/services/efsProcessingScheduler.js";
import { startEfsSoapCertExpiryWatcher } from "./modules/efs/services/efsSoapCertExpiry.js";
import { startPostedPriceScheduler } from "./modules/fuel/index.js";
import { startDutySessionSweeper } from "./services/dutySessionSweeper.js";
import { startStorageReconcileScheduler } from "./services/storageReconcileScheduler.js";
import { startNotificationPushScheduler } from "./services/notificationPush.js";
import { startDqExportSweeper } from "./modules/evidence/index.js";
import { startPatternSweepScheduler } from "./services/patternSweepScheduler.js";
import { startFuelSpendRollupScheduler } from "./modules/fuel-spend/index.js";

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
      .then(
        (n) =>
          n > 0 && console.log(`[jobs] reclaimed ${n} interrupted job(s) from the previous run`),
      )
      .catch((e) => console.error("[jobs] reclaim failed:", e instanceof Error ? e.message : e));
  }
  startSamsaraScheduler(env); // background auto-refresh of Samsara data
  startRebuildOnBoot(env); // one-time anomaly rebuild with current rules (rules-only, idempotent)
  startDigestScheduler(env); // weekly AI theft digest email
  startDqAlertScheduler(env); // DQ expiry threshold alerts: ledger rows + one office email per run (C3)
  startNightlyReconcileScheduler(env); // per-org 03:00 self-heal: EFS repair -> rescore -> rebuild
  startEfsIngestScheduler(env); // per-org auto-ingest of EFS reports (XLSX/CSV — manual/mailbox source)
  startEfsSoapPoller(env); // per-org EFS SOAP acquisition (posted + rejected feeds); gated on EFS_SOAP_ENABLED
  startEfsProcessingScheduler(env); // durable post-acquisition scoring + alert emission
  startEfsSoapCertExpiryWatcher(env); // daily: warn before an mTLS client certificate takes the feed down
  startEfsCardSyncScheduler(env); // daily: refresh the EFS card mirror (config changes are rare; the
  //                                  transaction feeds above are the ones that need minutes)
  startPostedPriceScheduler(env); // global posted-price refresh from Pilot's public table
  startDutySessionSweeper(env); // close abandoned driver shifts so their truck is released (D44.5)
  startStorageReconcileScheduler(env); // §13.5/M11 + DQF B7: nightly orphan sweep of every evidence bucket
  startNotificationPushScheduler(env); // Expo Push delivery of pending notification_events (5N/Phase 6)
  startDqExportSweeper(env); // D-BD4: a finished audit binder is a PII aggregate with a 7-day life
  startPatternSweepScheduler(env); // durable enrichment requests survive queue dispatch outages
  startFuelSpendRollupScheduler(env); // 0244: nightly re-derivation of the daily fuel-spend rollup
}
