import "dotenv/config";
import { loadEnv } from "./env.js";
import { runSchemaCheck } from "./services/schemaCheck.js";
import { startAllSchedulers } from "./schedulers.js";
import { getSupabaseAdmin } from "./lib/supabaseAdmin.js";
import { registerAllHandlers } from "./services/queue/handlers/index.js";
import { startQueueWorker } from "./services/queue/worker.js";

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
}

// Queue consumer (plan WQ0/WQ3): claims + executes enqueued jobs. Per-kind caps bound cost/vendor load
// (plan Q12). Requires queue mode + Supabase config; otherwise there is nothing to consume.
if (runsConsumer && env.JOB_EXECUTION_MODE === "queue" && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  registerAllHandlers();
  startQueueWorker(getSupabaseAdmin(env), env, { kindCaps: { hazmat_extract: 2, hazmat_analyze: 4 } });
  console.log("[FuelGuard worker] queue consumer started (JOB_EXECUTION_MODE=queue)");
} else if (runsConsumer && env.JOB_EXECUTION_MODE !== "queue") {
  console.warn("[FuelGuard worker] WORKER_ROLE includes consumer but JOB_EXECUTION_MODE!=queue — nothing to consume.");
}

// A consumer-only process is kept alive by the queue loop's timers; a scheduler process by its intervals.
