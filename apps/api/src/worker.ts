import "dotenv/config";
import { loadEnv } from "./env.js";
import { runSchemaCheck } from "./services/schemaCheck.js";
import { startAllSchedulers } from "./schedulers.js";
import { getSupabaseAdmin } from "./lib/supabaseAdmin.js";
import { registerAllHandlers } from "./services/queue/handlers/index.js";
import { startQueueWorker } from "./services/queue/worker.js";

/**
 * Dedicated worker process — owns all background schedulers so the API service can scale horizontally.
 * Deploy as a SINGLE-replica Railway service with the same env as the API, and set
 * RUN_SCHEDULERS_IN_PROCESS=false on the API service. See docs/WORKER-DEPLOYMENT.md.
 */
const env = loadEnv();
console.log(`[FuelGuard worker] starting background schedulers (${env.NODE_ENV})`);
void runSchemaCheck(env);
startAllSchedulers(env);

// Queue consumer (plan WQ0): when JOB_EXECUTION_MODE=queue, this worker claims + executes enqueued
// jobs from Postgres. Per-kind caps bound cost/vendor load (plan Q12). Safe no-op in inprocess mode.
if (env.JOB_EXECUTION_MODE === "queue" && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  registerAllHandlers();
  const admin = getSupabaseAdmin(env);
  startQueueWorker(admin, env, { kindCaps: { hazmat_extract: 2, hazmat_analyze: 4 } });
  console.log("[FuelGuard worker] queue consumer started (JOB_EXECUTION_MODE=queue)");
}
// The schedulers' setInterval/setTimeout timers keep the event loop (and this process) alive.
