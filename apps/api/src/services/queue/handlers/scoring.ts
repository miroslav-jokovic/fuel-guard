import { backfillOrg, scoreImportWithCascade } from "../../scoring/index.js";
import { scoreDeclinedImport, scoreDeclinedOrg } from "../../declinedScoring.js";
import { writeAudit } from "../../../lib/audit.js";
import { jobCancelRequested } from "../../jobs.js";
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

/** Live Samsara reconciliation backfill — cancel-aware via the ledger's cooperative cancel flag. */
export const backfillHandler: JobHandler = async (ctx, job, report) => {
  const full = job.payload.full === true;
  const actorId = asStr(job.payload.actorId);
  const count = await backfillOrg(
    ctx.admin, ctx.env, job.org_id,
    full ? {} : { onlyUnreconciled: true },
    report,
    () => jobCancelRequested(ctx.admin, job.id),
  );
  const canceled = await jobCancelRequested(ctx.admin, job.id);
  await writeAudit(ctx.admin, {
    orgId: job.org_id, actorId, action: "transactions.backfill", meta: { count, full, canceled },
  });
  return { count, full, canceled };
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
