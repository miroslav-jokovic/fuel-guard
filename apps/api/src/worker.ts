import "dotenv/config";
import { loadEnv } from "./env.js";
import { runSchemaCheck } from "./services/schemaCheck.js";
import { startAllSchedulers } from "./schedulers.js";

/**
 * Dedicated worker process — owns all background schedulers so the API service can scale horizontally.
 * Deploy as a SINGLE-replica Railway service with the same env as the API, and set
 * RUN_SCHEDULERS_IN_PROCESS=false on the API service. See docs/WORKER-DEPLOYMENT.md.
 */
const env = loadEnv();
console.log(`[FuelGuard worker] starting background schedulers (${env.NODE_ENV})`);
void runSchemaCheck(env);
startAllSchedulers(env);
// The schedulers' setInterval/setTimeout timers keep the event loop (and this process) alive.
