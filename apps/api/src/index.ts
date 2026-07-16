import "dotenv/config";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { startSamsaraScheduler } from "./services/samsaraScheduler.js";
import { startRebuildOnBoot } from "./services/rebuildScheduler.js";
import { startDigestScheduler } from "./services/digestScheduler.js";
import { startNightlyReconcileScheduler } from "./services/nightlyReconcile.js";
import { startEfsIngestScheduler } from "./services/efsIngestScheduler.js";
import { startPostedPriceScheduler } from "./services/postedPriceFetch.js";
import { reclaimInterruptedJobs } from "./services/jobs.js";
import { getSupabaseAdmin } from "./lib/supabaseAdmin.js";
import { runSchemaCheck } from "./services/schemaCheck.js";

const env = loadEnv();
const app = createApp(env);

app.listen(env.PORT, () => {
  console.log(`[FuelGuard API] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  void runSchemaCheck(env); // warn loudly if a migration hasn't been applied
  // Clear any job slots left "running" by the previous process before schedulers/buttons try to claim them.
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    reclaimInterruptedJobs(getSupabaseAdmin(env))
      .then((n) => n > 0 && console.log(`[jobs] reclaimed ${n} interrupted job(s) from the previous run`))
      .catch((e) => console.error("[jobs] reclaim failed:", e instanceof Error ? e.message : e));
  }
  startSamsaraScheduler(env); // background auto-refresh of Samsara data
  startRebuildOnBoot(env); // one-time anomaly rebuild with the current rules (rules-only, idempotent)
  startDigestScheduler(env); // weekly AI theft digest email
  startNightlyReconcileScheduler(env); // per-org 03:00 self-heal: EFS repair → rescore → rebuild → integrity
  startEfsIngestScheduler(env); // per-org auto-ingest of EFS reports delivered to the configured source
  startPostedPriceScheduler(env); // global posted-price refresh from Pilot's public network-wide table
});
