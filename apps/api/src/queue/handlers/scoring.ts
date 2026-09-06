import { SCORING_VERSION } from "@silvicom/shared";
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
/**
 * How many stale-stamp fills one nightly pass claims. 2,000 at the ~100 fills/min measured on
 * 2026-09-05 is roughly twenty minutes of work, so a full-fleet derivation change (≈16,000 fills)
 * converges in about eight nights while no single pass can run away with the night.
 */
export const STALE_RESCORE_BATCH = 2000;

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
 * Four shapes, one handler, decided entirely by the payload (plan A2 — the input is never
 * closure-captured):
 *  - `full` — every fill, the manual "Re-check all history" button. COLLECTION: it re-fetches Samsara.
 *  - `reconBatch` — the SAM-S3 collector tier: the oldest N fills still missing telematics, bounded so
 *    one tick finishes inside its rate budget. This is the shape that runs on a schedule.
 *  - `rebuild` — SAM-S6. RE-SCORE ONLY: relearn each vehicle's capacity and sensor reliability from the
 *    telematics already collected, then re-score against the converged values. Fetches nothing.
 *  - `rebuild` + `staleOnly` — the NIGHTLY re-score tier (0318). Same work, but claiming only the fills
 *    whose `scoring_version` is below the current one, oldest first, capped by `limit`. This is the
 *    shape that should run on a schedule: a derivation change drains over several nights instead of
 *    the three-hour full-history sweep measured on 2026-09-05.
 *  - neither — "catch up new fills", the manual button, unbounded over never-reconciled rows.
 *
 * Why `rebuild` needed a shape of its own. The rebuild path already existed and was reachable only
 * through `nightlyReconcile`. Re-scoring history through `full` instead would work, but it is the wrong
 * tool twice over: it re-fetches telematics S4 has already collected, and it spends the vendor rate
 * budget to recompute values that are sitting in the database.
 *
 * ⚠ CORRECTION (2026-09-05, same day). This comment first said `nightlyReconcile` "pins it to
 * RECENT_REBUILD_DAYS (14) — so every derivation change since a fill left that window has never been
 * applied to it". BOTH halves were wrong, and the commit messages of #569/#570 carry the same error.
 * `RECENT_REBUILD_DAYS` is **180**, not 14 — 14 is `REBUILD_DAYS` in Q-FUI9, a different constant for
 * `fuel_spend_days`. And history was not going unre-scored at all: the nightly was re-scoring ~10,400
 * fills EVERY NIGHT, measured at 8,982–9,255 seconds on 2026-09-03/04/05.
 *
 * The real defect was the opposite of the one claimed — not neglect but waste, two and a half hours a
 * night to change the verdict on almost nothing. That is what the `staleOnly` shape above replaced, and
 * it is a better reason than the one this comment originally gave. Recorded rather than quietly edited
 * because a wrong premise that produced a right answer is worth seeing twice.
 *
 * `sinceDays` is accepted so the same shape can be pointed at a window rather than all of history; left
 * out, it means all of it.
 */
export const backfillHandler: JobHandler = async (ctx, job, report) => {
  const full = job.payload.full === true;
  const rebuild = job.payload.rebuild === true;
  const staleOnly = job.payload.staleOnly === true;
  const limit = asNum(job.payload.limit);
  const actorId = asStr(job.payload.actorId);
  const batch = asNum(job.payload.reconBatch);
  const sinceDays = asNum(job.payload.sinceDays);
  const retryAfterHours = asNum(job.payload.reconRetryAfterHours) ?? 24;
  const opts = rebuild
    ? {
        skipRecon: true,
        ...(sinceDays != null ? { sinceDays } : {}),
        // A stale-stamp pass without a limit IS the full-history sweep, which is the thing this shape
        // exists to avoid — so the cap is defaulted here rather than left to the caller to remember.
        ...(staleOnly ? { staleScoringVersion: SCORING_VERSION, limit: limit ?? STALE_RESCORE_BATCH } : {}),
      }
    : full
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
    orgId: job.org_id, actorId, action: "transactions.backfill",
    meta: { count, full, rebuild, staleOnly, canceled, batch: batch ?? null, sinceDays: sinceDays ?? null },
  });
  return { count, full, rebuild, staleOnly, canceled, ...(batch != null ? { batch } : {}) };
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
