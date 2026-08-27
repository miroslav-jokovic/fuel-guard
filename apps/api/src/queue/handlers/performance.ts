import { syncRecentDriverScoreWeeks, snapshotSettledWeeks } from "../../modules/performance/index.js";
import { syncIdleFoundation } from "../../modules/idle/index.js";
import { NoSamsaraTokenError } from "../../modules/samsara/index.js";
import { writeAudit } from "../../lib/audit.js";
import type { JobHandler } from "../types.js";

/**
 * Driver-performance handlers — split out of handlers/samsara.ts 2026-08-27 (program step P1.4b):
 * these are performance-harness recomputation, not collector syncs, and a file named for a
 * collector hid that. Same payload/audit/idempotency contract as the rest of WQ1c.
 */
const asStr = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

async function nonFatal(label: string, orgId: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`[performance] ${label} (org ${orgId}) failed: ${e instanceof Error ? e.message : e}`);
  }
}

/** Current-week driver-performance component scores (Safety + Efficiency), + an idle refresh so the grade
 *  is current. Manual "Sync scores" and the driver-score scheduler tier share this slot. */
export const syncDriverScoresHandler: JobHandler = async (ctx, job) => {
  const { admin, env } = ctx;
  const orgId = job.org_id;
  const actorId = asStr(job.payload.actorId);
  try {
    const result = await syncRecentDriverScoreWeeks(admin, env, orgId);
    // Idle feeds the grade too — the MANUAL "Sync scores" button (payload.refreshIdle) refreshes it so
    // one click makes the whole page current. The driver-score SCHEDULER tier omits the flag because idle
    // is its own scheduled tier — refreshing here too would double-sync it every cycle.
    if (job.payload.refreshIdle === true) {
      await nonFatal("driver-score idle refresh", orgId, () => syncIdleFoundation(admin, env, orgId));
    }
    const cur = result.results[0];
    const summary = {
      weekStart: cur?.weekStart ?? null,
      weeks: result.weeks,
      drivers: cur?.drivers ?? 0,
      upserted: result.totalUpserted,
      safetyOk: cur?.safetyOk ?? false,
      efficiencyOk: cur?.efficiencyOk ?? false,
    };
    if (actorId) {
      await writeAudit(admin, {
        orgId,
        actorId,
        action: "integration.samsara.driver_scores_synced",
        entity: "driver_scores",
        meta: summary,
      });
    }
    return summary;
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) return { skipped: "no_samsara_token" };
    throw e;
  }
};

/** Freeze all settled driver-performance weeks into the rewards ledger. DB-only (no vendor call), idempotent. */
export const snapshotDriverWeekHandler: JobHandler = async (ctx, job) => {
  const actorId = asStr(job.payload.actorId);
  const result = await snapshotSettledWeeks(ctx.admin, ctx.env, job.org_id);
  if (actorId) {
    await writeAudit(ctx.admin, {
      orgId: job.org_id,
      actorId,
      action: "driver_performance.snapshot",
      entity: "driver_performance_weeks",
      meta: { weeksFrozen: result.weeksFrozen.length, rowsWritten: result.rowsWritten },
    });
  }
  return { weeksFrozen: result.weeksFrozen.length, rowsWritten: result.rowsWritten };
};
