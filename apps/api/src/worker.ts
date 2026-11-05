import "dotenv/config";
import "./instrument.js"; // Sentry init, as in index.ts — a worker whose errors go nowhere is a worker nobody watches
import { loadEnv } from "./env.js";
import { runSchemaCheck } from "./modules/org/index.js";
import { startSchedulerLanes } from "./schedulers.js";
import { exitOnLostLease } from "./lib/schedulerLeaseExit.js";
import type { LaneLease } from "./lib/schedulerLease.js";
import { getSupabaseAdmin } from "./lib/supabaseAdmin.js";
import { registerAllHandlers } from "./queue/handlers/index.js";
import { warmDocumentReadOcr } from "./queue/handlers/documentRead.js";
import { startQueueWorker } from "./queue/worker.js";
import { startQueueMetricsLogger } from "./queue/metrics.js";
import { installShutdownHandlers } from "./lib/shutdown.js";
import { keepProcessAlive } from "./lib/keepAlive.js";

/**
 * Dedicated worker process. Its role is set by WORKER_ROLE (plan WQ3):
 *   • `scheduler` — competes for the scheduler lanes in SCHEDULER_LANES and runs a lane only while it
 *     holds that lane's database lease (D-RLY2, 0506). A second replica is a hot standby, not a second
 *     copy: it takes a lane over within ~75 s of the holder dying. Production: `general`.
 *   • `consumer`  — claims + executes enqueued jobs from Postgres. Horizontally scalable to N replicas;
 *     the claim RPC's FOR UPDATE SKIP LOCKED + per-job leases make concurrent claiming safe.
 *   • `both`      — the default single-worker deploy (schedulers + consumer in one process).
 * See docs/WORKER-DEPLOYMENT.md.
 */
const env = loadEnv();
const role = env.WORKER_ROLE;
console.log(`[Silvicom 360 worker] role=${role} (${env.NODE_ENV})`);
void runSchemaCheck(env);

const runsSchedulers = role === "scheduler" || role === "both";
const runsConsumer = role === "consumer" || role === "both";

let leases: LaneLease[] = [];
let stopKeepAlive = (): void => {};
if (runsSchedulers) {
  leases = startSchedulerLanes(env, exitOnLostLease("worker"));
  // A standby holds no scheduler interval and the lease timers are unref'd — see keepAlive.ts.
  stopKeepAlive = keepProcessAlive();
  // Passive queue-health log (plan A1) — single-owner on the scheduler process, queue mode only.
  if (env.JOB_EXECUTION_MODE === "queue" && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    startQueueMetricsLogger(env);
    console.log("[Silvicom 360 worker] queue metrics logger started");
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
  idle_engine: 1,
  snapshot_driver_week: 1,
  nightly_reconcile: 1,
  financial_projection: 1,
  efs_soap_posted: 1,
  efs_soap_rejected: 1,
  efs_window_refetch: 1,
  efs_process_import: 1,
  efs_card_sync: 1,
  efs_card_status: 1,
  hazmat_extract: 2,
  // Two, like hazmat_extract (DOCUMENT-READER-PLAN §2 Queue): a read is up to three parallel vision
  // requests (Q-DR11 sections), so two reads is six in flight against Anthropic fleet-wide.
  document_read: 2,
  // Two: a render holds pdf.js on the event loop (≈0.25–0.64 s per office BOL, measured 2026-10-10) and
  // ~34 MB of RGBA per 300-DPI page, one page at a time (pdf.ts); two at once is a bounded cost.
  document_intake: 2,
  hazmat_analyze: 4,
  dq_binder: 2,
  // ⚠ ONE. FleetPal publishes no rate limit and sends no limiter headers — 94 sequential requests
  // on 2026-09-21 returned not one `X-RateLimit-*` and not one 429 — so there is no measured budget
  // to spend and the `Retry-After` path in the client is the only defence. A cap above 1 would be a
  // guess made on a carrier's live maintenance system (plan F4, F8).
  fleetpal_sync: 1,
  medstop_sync: 1, // one key, one 100-a-minute limit, per org — and one org today
  // Two, not one: a step makes at most one platform call (a pause, or a launch through the guard), and
  // "two campaigns of one org advance concurrently" is A6's done-when. A vendor's own rate limit is its
  // adapter client's to honour (B1 reads Meta's x-business-use-case-usage), not a queue-wide guess.
  ads_step: 2,
  // One at a time: a sync is a handful of Meta writes against one account's rate limit (B3b).
  ads_rules_sync: 1,
  // One at a time: a backfill pages every form's leads with one Page token, and the window overlaps the
  // next hour's, so running two would only spend Meta's per-Page rate on reads the sink already holds (B4a2).
  ads_leads_backfill: 1,
  // One at a time: each is one Graph read with a Page token, and a burst of leads is a burst of reads
  // against that Page's rate; the backfill is the net, so a short queue costs nothing (B4b).
  ads_lead_fetch: 1,
  // One at a time: a pull pages every campaign's hourly insights with one account token, and the window is
  // re-read whole next hour, so two at once would only spend the account's Insights rate twice (B5a).
  ads_insights: 1,
  // One at a time: a reconcile reads every object of ours and 28 days of insights with one account token (B5c).
  ads_reconcile: 1,
  // One at a time: each brief is one Claude call against the carrier's month of tokens (F1b).
  ads_daily_brief: 1,
  // One at a time: a sweep is a few reads and a bell item per overdue lead, and the next tick is minutes away (D2c).
  lead_uncontacted: 1,
  // One at a time: renders spend the carrier's prepaid Higgsfield credits; one in flight keeps the month exact (C3).
  ads_render: 1,
  // sharp is CPU-bound; two at a time keeps a burst of uploads from starving the sync kinds.
  document_derive: 2,
};
if (
  runsConsumer &&
  env.JOB_EXECUTION_MODE === "queue" &&
  env.SUPABASE_URL &&
  env.SUPABASE_SERVICE_ROLE_KEY
) {
  registerAllHandlers();
  startQueueWorker(getSupabaseAdmin(env), env, { kindCaps: KIND_CAPS });
  console.log("[Silvicom 360 worker] queue consumer started (JOB_EXECUTION_MODE=queue)");
  // This consumer runs `document_read`: its OCR models load now, not during the first read (TC0.3).
  void warmDocumentReadOcr(env);
} else if (runsConsumer && env.JOB_EXECUTION_MODE !== "queue") {
  console.warn(
    "[Silvicom 360 worker] WORKER_ROLE includes consumer but JOB_EXECUTION_MODE!=queue — nothing to consume.",
  );
}

// A consumer-only process is kept alive by the queue loop's timers; a scheduler process by
// keepProcessAlive, whether it holds its lane or is only a standby.

// The queue loop stops claiming on shutdown and executeJob hands back what is still running
// (lib/shutdown.ts); the scheduler intervals simply stop at exit.
installShutdownHandlers({
  name: `worker:${role}`,
  onExit: async () => {
    await Promise.all(leases.map((l) => l.stop()));
    stopKeepAlive();
  },
});
