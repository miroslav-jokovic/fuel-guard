import type { Env } from "./env.js";
import { getSupabaseAdmin } from "./lib/supabaseAdmin.js";
import { reclaimInterruptedJobs } from "./modules/org/index.js";
import { startSamsaraScheduler } from "./modules/samsara/index.js";
import { startRebuildOnBoot } from "./modules/anomalies/index.js";
import { startDigestScheduler } from "./modules/org/index.js";
import { startDqAlertScheduler } from "./modules/evidence/index.js";
import { startNightlyReconcileScheduler } from "./orchestration/nightlyReconcile.js";
import { startEfsIngestScheduler } from "./modules/efs/services/efsIngestScheduler.js";
import { startEfsCardSyncScheduler } from "./modules/efs/services/efsCardSyncScheduler.js";
import { startEfsSoapPoller } from "./modules/efs/services/efsSoapPoller.js";
import { startEfsProcessingScheduler } from "./modules/efs/services/efsProcessingScheduler.js";
import { startEfsSoapCertExpiryWatcher } from "./modules/efs/services/efsSoapCertExpiry.js";
import { startPostedPriceScheduler } from "./modules/posted-prices/index.js";
import { startDutySessionSweeper } from "./modules/driver-app/index.js";
import { startStorageReconcileScheduler, startStorageBackupScheduler } from "./modules/org/index.js";
import { startNotificationPushScheduler, startChatLedgerVerifyScheduler } from "./modules/messaging/index.js";
import { startDqExportSweeper } from "./modules/evidence/index.js";
import { startPatternSweepScheduler } from "./modules/anomalies/index.js";
import { startFuelSpendRollupScheduler } from "./modules/fuel-spend/index.js";
import { startFinancialProjectionScheduler, startFinancialFreshnessScheduler } from "./modules/financial/index.js";
import { startFleetpalScheduler } from "./modules/fleetpal/index.js";
import { startMedstopScheduler } from "./modules/medstop/index.js";
import { startSmsOutboxScheduler } from "./modules/recruiting/index.js";
import { startBoardEtaRecorder } from "./modules/livemap/index.js";
import { startFmcsaFeedScheduler } from "./modules/inspections/index.js";
import { startMcleodRelinkScheduler } from "./modules/mcleod/index.js";
import { startInprocessJobDrain } from "./queue/inprocessDrain.js";
import type { SchedulerLane } from "./schedulerLanes.js";
import {
  startLaneLease,
  supabaseLeaseStore,
  processHolderId,
  processHolderMeta,
  type LaneLease,
} from "./lib/schedulerLease.js";

/**
 * Every background scheduler, and the lane it belongs to (schedulerLanes.ts). This list is the ONE
 * place a scheduler is registered; a lane's set is derived from it, never restated beside it.
 *
 * Run each lane in EXACTLY ONE process fleet-wide. Since D-RLY2 that is enforced by the lane's
 * database lease (0506), not only by `RUN_SCHEDULERS_IN_PROCESS`: a process starts a lane's
 * schedulers only after it holds the lease, so two replicas of one service — or a second service that
 * was never told to stay out — cannot both run them.
 */
export interface ScheduledTask {
  name: string;
  lane: SchedulerLane;
  start: (env: Env) => void;
}

export const SCHEDULERS: readonly ScheduledTask[] = [
  { name: "samsara", lane: "general", start: startSamsaraScheduler }, // background auto-refresh of Samsara data
  { name: "rebuild-on-boot", lane: "general", start: startRebuildOnBoot }, // one-time anomaly rebuild with current rules (rules-only, idempotent)
  { name: "digest", lane: "general", start: startDigestScheduler }, // weekly AI theft digest email
  { name: "dq-alerts", lane: "general", start: startDqAlertScheduler }, // DQ expiry threshold alerts: ledger rows + one office email per run (C3)
  { name: "nightly-reconcile", lane: "general", start: startNightlyReconcileScheduler }, // per-org 03:00 self-heal: EFS repair (our own store, no SOAP) -> rescore -> rebuild
  { name: "efs-ingest", lane: "general", start: startEfsIngestScheduler }, // per-org auto-ingest of EFS reports (XLSX/CSV — Storage or the M365 mailbox, never WEX)
  { name: "efs-soap-poller", lane: "egress", start: startEfsSoapPoller }, // per-org EFS SOAP acquisition (posted + rejected feeds); gated on EFS_SOAP_ENABLED
  // inprocess mode only: executes queued-as-rows repair jobs — no-op in queue mode. Split by lane so the
  // EFS re-fetch dials WEX from the egress process and the rest stays off it.
  { name: "job-drain:egress", lane: "egress", start: (env) => startInprocessJobDrain(env, "egress") },
  { name: "job-drain:general", lane: "general", start: (env) => startInprocessJobDrain(env, "general") },
  { name: "efs-processing", lane: "general", start: startEfsProcessingScheduler }, // durable post-acquisition scoring + alert emission
  { name: "efs-soap-cert-expiry", lane: "egress", start: startEfsSoapCertExpiryWatcher }, // daily: warn before an mTLS client certificate takes the feed down
  // daily: refresh the EFS card mirror + the status poll. CARD MANAGEMENT — the one WEX operation group
  // that checks the source IP, so it can only run from the whitelisted service.
  { name: "efs-card-sync", lane: "egress", start: startEfsCardSyncScheduler },
  { name: "posted-prices", lane: "general", start: startPostedPriceScheduler }, // global posted-price refresh from Pilot's public table
  { name: "duty-session-sweeper", lane: "general", start: startDutySessionSweeper }, // close abandoned driver shifts so their truck is released (D44.5)
  { name: "storage-reconcile", lane: "general", start: startStorageReconcileScheduler }, // §13.5/M11 + DQF B7: nightly orphan sweep of every evidence bucket
  { name: "storage-backup", lane: "general", start: startStorageBackupScheduler }, // D13: nightly copy of every evidence bucket to the off-provider S3 bucket; OFF unless STORAGE_BACKUP_* set
  { name: "notification-push", lane: "general", start: startNotificationPushScheduler }, // Expo Push delivery of pending notification_events (5N/Phase 6)
  { name: "dq-export-sweeper", lane: "general", start: startDqExportSweeper }, // D-BD4: a finished audit binder is a PII aggregate with a 7-day life
  { name: "pattern-sweep", lane: "general", start: startPatternSweepScheduler }, // durable enrichment requests survive queue dispatch outages
  { name: "fuel-spend-rollup", lane: "general", start: startFuelSpendRollupScheduler }, // 0244: nightly re-derivation of the daily fuel-spend rollup
  { name: "financial-projection", lane: "general", start: startFinancialProjectionScheduler }, // P3.4: nightly projection of staging into financial_entries
  { name: "fleetpal", lane: "general", start: startFleetpalScheduler }, // hourly per-org FleetPal sweep (F8); OFF unless FLEETPAL_SYNC_ENABLED
  { name: "medstop", lane: "general", start: startMedstopScheduler }, // hourly Med-Stop roster/pool/selection mirror (MEDSTOP MS1); OFF unless MEDSTOP_SYNC_ENABLED
  { name: "sms-outbox", lane: "general", start: startSmsOutboxScheduler }, // A-11/C2d: five-minutely drain of texts queued for their recipient's civil hours
  { name: "board-eta-recorder", lane: "general", start: startBoardEtaRecorder }, // DB7: hourly sample of the dispatch board's ETAs, scored later against arrivals
  { name: "fmcsa-feed", lane: "general", start: startFmcsaFeedScheduler }, // IC1 (0457): daily snapshot of FMCSA's public record of our roadside inspections
  { name: "mcleod-relink", lane: "general", start: startMcleodRelinkScheduler }, // D-LA3 via D-RLY12: every 10 min, re-make the links of loads whose codes resolve now
  { name: "financial-freshness", lane: "general", start: startFinancialFreshnessScheduler }, // D-FIN3: six-hourly — a stale McLeod financial sweep or a failed finance job becomes a finding
  { name: "chat-ledger-verify", lane: "general", start: startChatLedgerVerifyScheduler }, // CHA1 (D-CHAT12): 05:00 Central, recompute each org's chat hash chain; a break alerts the admins
];

/** A lane's schedulers, in registration order. Pure; exported for the partition test. */
export function schedulersInLane(lane: SchedulerLane): ScheduledTask[] {
  return SCHEDULERS.filter((s) => s.lane === lane);
}

/** Start one lane's schedulers in this process. The caller holds the lane's lease. */
export function startLane(env: Env, lane: SchedulerLane): void {
  const tasks = schedulersInLane(lane);
  for (const task of tasks) task.start(env);
  console.log(`[schedulers] lane ${lane} started: ${tasks.map((t) => t.name).join(", ")}`);
}

let reclaimed = false;
/**
 * Clear job slots left "running" by a dead process before this process's schedulers claim any. Safe
 * with other processes alive: it fails only rows whose heartbeat lease has EXPIRED (P0-4).
 */
function reclaimOnce(env: Env): void {
  if (reclaimed || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  reclaimed = true;
  reclaimInterruptedJobs(getSupabaseAdmin(env))
    .then((n) => n > 0 && console.log(`[jobs] reclaimed ${n} interrupted job(s) from a previous process`))
    .catch((e) => console.error("[jobs] reclaim failed:", e instanceof Error ? e.message : e));
}

/**
 * Compete for each lane in `env.SCHEDULER_LANES`; start a lane's schedulers when its lease is held.
 * `onLost` is the process's answer to a lease taken away — production exits, so the platform restarts
 * it as a clean standby (lib/schedulerLease.ts says why a scheduler cannot be stopped in place).
 * Returns the leases so shutdown can release them for a fast hand-over.
 */
export function startSchedulerLanes(env: Env, onLost: (lane: SchedulerLane, reason: string) => void): LaneLease[] {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    // Local without a database: there is nothing to lease against, and nothing the schedulers could
    // reach either. One process by construction.
    console.warn("[schedulers] no Supabase configured — starting lanes without a lease (local only)");
    for (const lane of env.SCHEDULER_LANES) startLane(env, lane);
    return [];
  }
  const store = supabaseLeaseStore(getSupabaseAdmin(env));
  const holder = processHolderId();
  const meta = processHolderMeta();
  console.log(`[schedulers] competing for lane(s) ${env.SCHEDULER_LANES.join(", ")} as ${holder}`);
  return env.SCHEDULER_LANES.map((lane) =>
    startLaneLease({
      lane,
      holder,
      store,
      meta,
      onAcquired: () => {
        reclaimOnce(env);
        startLane(env, lane);
      },
      onLost: (reason) => onLost(lane, reason),
    }),
  );
}

