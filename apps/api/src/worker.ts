import "dotenv/config";
import { loadEnv } from "./env.js";
import { runSchemaCheck } from "./services/schemaCheck.js";
import { startAllSchedulers } from "./schedulers.js";
import { getSupabaseAdmin } from "./lib/supabaseAdmin.js";
import { registerAllHandlers } from "./services/queue/handlers/index.js";
import { startQueueWorker } from "./services/queue/worker.js";
import { startQueueMetricsLogger } from "./services/queue/metrics.js";

/**
 * Dedicated worker process. Its role is set by WORKER_ROLE (plan WQ3):
 *   • `scheduler` — owns the setInterval schedulers (Samsara sync, digest, reconcile, EFS…). Deploy as a
 *     SINGLE replica: schedulers must tick exactly once (the boot sweep + rebuild-on-boot assume one owner).
 *   • `consumer`  — claims + executes enqueued jobs from Postgres. Horizontally scalable to N replicas;
 *     the claim RPC's FOR UPDATE SKIP LOCKED + per-job leases make concurrent claiming safe.
 *   • `both`      — the default single-worker deploy (schedulers + consumer in one process).
 * See docs/WORKER-DEPLOYMENT.md.
 */
const env = loadEnv();
const role = env.WORKER_ROLE;
console.log(`[FuelGuard worker] role=${role} (${env.NODE_ENV})`);
void runSchemaCheck(env);

const runsSchedulers = role === "scheduler" || role === "both";
const runsConsumer = role === "consumer" || role === "both";

if (runsSchedulers) {
  startAllSchedulers(env);
  console.log("[FuelGuard worker] schedulers started");
  // Passive queue-health log (plan A1) — single-owner on the scheduler process, queue mode only.
  if (env.JOB_EXECUTION_MODE === "queue" && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    startQueueMetricsLogger(env);
    console.log("[FuelGuard worker] queue metrics logger started");
  }
}

// Queue consumer (plan WQ0/WQ3): claims + executes enqueued jobs. Per-kind caps bound cost/vendor load
// (plan Q12). Requires queue mode + Supabase config; otherwise there is nothing to consume.
//
// Q7 — bounded rate-limit lane. Every vendor-calling kind is pinned to a low fleet-wide in-flight cap so
// the vendor RPS holds GLOBALLY (not N×-per-process as the old per-process limiter did once the API/worker
// scales past one replica): the Samsara sync kinds + the EFS SOAP pollers each cap at 1, so at most one run
// of each is in flight across the whole fleet. hazmat caps bound Anthropic vision spend. To harden further
// at high consumer counts, run these kinds on a dedicated single-replica consumer group (see
// docs/WORKER-DEPLOYMENT.md) — the serial loop then serializes ALL vendor calls through one limiter.
const KIND_CAPS: Record<string, number> = {
  sync_vehicles: 1,
  sync_stats: 1,
  sync_trailers: 1,
  sync_idle: 1,
  sync_hos: 1,
  sync_drivers: 1,
  sync_driver_scores: 1,
  snapshot_driver_week: 1,
  nightly_reconcile: 1,
  efs_soap_posted: 1,
  efs_soap_rejected: 1,
  efs_process_import: 1,
  efs_card_sync: 1,
  hazmat_extract: 2,
  hazmat_analyze: 4,
  dq_binder: 2,
};
if (
  runsConsumer &&
  env.JOB_EXECUTION_MODE === "queue" &&
  env.SUPABASE_URL &&
  env.SUPABASE_SERVICE_ROLE_KEY
) {
  registerAllHandlers();
  startQueueWorker(getSupabaseAdmin(env), env, { kindCaps: KIND_CAPS });
  console.log("[FuelGuard worker] queue consumer started (JOB_EXECUTION_MODE=queue)");
} else if (runsConsumer && env.JOB_EXECUTION_MODE !== "queue") {
  console.warn(
    "[FuelGuard worker] WORKER_ROLE includes consumer but JOB_EXECUTION_MODE!=queue — nothing to consume.",
  );
}

// A consumer-only process is kept alive by the queue loop's timers; a scheduler process by its intervals.
