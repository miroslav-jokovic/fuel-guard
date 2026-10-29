import "dotenv/config";
import "./instrument.js"; // Sentry init — must load before the app + its instrumented libs
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { runSchemaCheck } from "./modules/org/index.js";
import { startSchedulerLanes } from "./schedulers.js";
import { exitOnLostLease } from "./lib/schedulerLeaseExit.js";
import type { LaneLease } from "./lib/schedulerLease.js";
import { startRequestMetricsReporter } from "./middleware/requestMetrics.js";
import { getSupabaseAdmin } from "./lib/supabaseAdmin.js";
import { sealPlaintextSamsaraTokens } from "./modules/samsara/lib/samsaraToken.js";
import { installShutdownHandlers } from "./lib/shutdown.js";
import { warmDocumentReadOcr } from "./queue/handlers/documentRead.js";

const env = loadEnv();
const app = createApp(env);
let leases: LaneLease[] = [];

const server = app.listen(env.PORT, () => {
  console.log(`[Silvicom 360 API] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  /**
   * One `[metrics]` line a minute describing what this process served (C7). Started HERE and not in
   * `createApp` on purpose: every test in the suite builds an app, and a timer per app would be
   * hundreds of them. It is deliberately NOT behind `RUN_SCHEDULERS_IN_PROCESS` — it writes nothing
   * and reports only its own process, so every service should run its own. See the note on
   * `startRequestMetricsReporter` for why that is not the rule `docs/WORKER-DEPLOYMENT.md` governs.
   */
  startRequestMetricsReporter();
  void runSchemaCheck(env); // warn loudly if a migration hasn't been applied
  // In `inprocess` mode (production) a BOL read runs in this process, so its OCR models load at boot rather than
  // during the first read (TWO-CLICK-READER-PLAN TC0.3). Not a scheduler: one start, no tick, nothing written —
  // every process that runs reads warms its own engine. In `queue` mode the consumer does it (worker.ts).
  if (env.JOB_EXECUTION_MODE !== "queue") void warmDocumentReadOcr(env);
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    // Seal any legacy plaintext Samsara tokens at rest (no-op once sealed; warns if the key is unset).
    void sealPlaintextSamsaraTokens(getSupabaseAdmin(env), env).catch((e) =>
      console.error("[boot] token seal sweep failed:", e instanceof Error ? e.message : e),
    );
  }
  if (env.RUN_SCHEDULERS_IN_PROCESS) {
    // This process competes for its SCHEDULER_LANES (default: every lane — the single-service deploy)
    // and runs a lane only while it holds that lane's lease (D-RLY2). Production: `egress` here.
    leases = startSchedulerLanes(env, exitOnLostLease("api"));
  } else {
    console.log("[api] in-process schedulers disabled (RUN_SCHEDULERS_IN_PROCESS=false) — a dedicated worker service runs them");
  }
});

// A deploy's SIGTERM: stop taking requests, let running jobs finish inside Railway's draining window,
// hand back the rest. Without it every deploy killed the job mid-run — see lib/shutdown.ts.
installShutdownHandlers({
  name: "api",
  beforeDrain: () => server.close(),
  onExit: async () => {
    await Promise.all(leases.map((l) => l.stop()));
  },
});
