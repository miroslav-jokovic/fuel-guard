import { backfillOrg, scoreImportWithCascade } from "../../modules/anomalies/index.js";
import { runPatternSweep, markPatternSweepOutcome } from "../../modules/anomalies/index.js";
import { scoreDeclinedImport, scoreDeclinedOrg } from "../../modules/anomalies/index.js";
import { writeAudit } from "../../lib/audit.js";
import { jobCancelRequested } from "../../modules/org/index.js";
import type { JobHandler } from "../types.js";

/**
 * Scoring/rebuild/backfill handlers (WQ1). Each reconstructs entirely from `job.payload` — the input is
 * an org id (+ small opts) or an already-persisted `importId`, never closure-captured data (plan A2).
 * Idempotent (plan Q9): re-scoring is deterministic and overwrites, so a retry re-derives the same rows.
 * The audit write mirrors the original route closure exactly, so behavior is identical in either mode.
 */
const asStr = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const asNum = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** Full/incremental report rebuild — re-score with current rules, reusing stored Samsara values. */
export const rebuildHandler: JobHandler = async (ctx, job, report) => {
  const sinceDays = asNum(job.payload.sinceDays);
  const actorId = asStr(job.payload.actorId);
  const count = await backfillOrg(ctx.admin, ctx.env, job.org_id, { skipRecon: true, sinceDays }, report);
  await writeAudit(ctx.admin, {
    orgId: job.org_id, actorId, action: "transactions.rebuild", meta: { count, sinceDays: sinceDays ?? null },
  });
  return { count };
};

/**
 * Live Samsara reconciliation backfill — cancel-aware via the ledger's cooperative cancel flag.
 *
 * Three shapes, one handler, decided entirely by the payload (plan A2 — the input is never
 * closure-captured):
 *  - `full` — every fill, the manual "Re-check all history" button.
 *  - `reconBatch` — the SAM-S3 collector tier: the oldest N fills still missing telematics, bounded so
 *    one tick finishes inside its rate budget. This is the shape that runs on a schedule.
 *  - neither — "catch up new fills", the manual button, unbounded over never-reconciled rows.
 */
export const backfillHandler: JobHandler = async (ctx, job, report) => {
  const full = job.payload.full === true;
  const actorId = asStr(job.payload.actorId);
  const batch = asNum(job.payload.reconBatch);
  const retryAfterHours = asNum(job.payload.reconRetryAfterHours) ?? 24;
  const opts = full
    ? {}
    : batch != null
      ? { reconClaim: { limit: batch, retryAfterHours } }
      : { onlyUnreconciled: true };
  const count = await backfillOrg(
    ctx.admin, ctx.env, job.org_id,
    opts,
    report,
    () => jobCancelRequested(ctx.admin, job.id),
  );
  const canceled = await jobCancelRequested(ctx.admin, job.id);
  // A scheduled tick has no actor, and `writeAudit` with a null actor is how every other scheduled run
  // records itself — the audit row is what makes "the collector ran and fetched nothing" visible.
  await writeAudit(ctx.admin, {
    orgId: job.org_id, actorId, action: "transactions.backfill", meta: { count, full, canceled, batch: batch ?? null },
  });
  return { count, full, canceled, ...(batch != null ? { batch } : {}) };
};

/** Score just the transactions from one import (referenced by persisted importId). */
export const scoreImportHandler: JobHandler = async (ctx, job, report) => {
  const importId = asStr(job.payload.importId) ?? "";
  const actorId = asStr(job.payload.actorId);
  const r = await scoreImportWithCascade(ctx.admin, ctx.env, job.org_id, importId, report);
  await writeAudit(ctx.admin, {
    orgId: job.org_id, actorId, action: "transactions.score_import", meta: { importId, ...r },
  });
  return r;
};

/** Score the declined attempts from one reject-report import. */
export const scoreDeclinedImportHandler: JobHandler = async (ctx, job) => {
  const importId = asStr(job.payload.importId) ?? "";
  const actorId = asStr(job.payload.actorId);
  const count = await scoreDeclinedImport(ctx.admin, ctx.env, job.org_id, importId);
  await writeAudit(ctx.admin, {
    orgId: job.org_id, actorId, action: "declined.score_import", meta: { importId, count },
  });
  return { count };
};

/** Re-score every declined attempt for the org (Rejections "Rescore" button). */
export const rescoreDeclinedHandler: JobHandler = async (ctx, job) => {
  const actorId = asStr(job.payload.actorId);
  const count = await scoreDeclinedOrg(ctx.admin, ctx.env, job.org_id);
  await writeAudit(ctx.admin, { orgId: job.org_id, actorId, action: "declined.rescore", meta: { count } });
  return { count };
};

/** Entity-intelligence Phase 2 (2026-08): retrospective pattern sweep for one flagged case. Read-only
 *  against scoring data (writes only case_pattern_reports), so it carries NO scoring mutex — it can
 *  run while a rebuild scores, and a re-run simply replaces the report (idempotent upsert). */
export const patternSweepHandler: JobHandler = async (ctx, job) => {
  const anomalyId = asStr(job.payload.anomalyId) ?? "";
  const requestId = asStr(job.payload.requestId);
  try {
    const r = await runPatternSweep(ctx.admin, job.org_id, anomalyId);
    // Outcome bookkeeping goes through the owner — pattern_sweep_requests is anomalies' table.
    if (requestId) await markPatternSweepOutcome(ctx.admin, requestId, { ok: true });
    return { anomalyId, generated: r.generated, ...(r.reason ? { reason: r.reason } : {}) };
  } catch (error) {
    if (requestId) {
      await markPatternSweepOutcome(ctx.admin, requestId, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
};
