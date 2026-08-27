import { runDataRetention } from "../../../modules/org/index.js";
import type { JobHandler } from "../types.js";

/**
 * Daily data-retention enforcement (kind `data_retention`) — prunes derived/reproducible rows past
 * their policy window in bounded batches (see services/dataRetention.ts for the policy and its
 * rationale). DB-only, no vendor calls; idempotent — a retry just finds fewer rows to prune. The
 * summary (rows deleted per table, whether the run was capped) lands in the job's stats so the Data &
 * Sync page shows exactly what the policy did.
 */
export const dataRetentionHandler: JobHandler = async (ctx, job) => {
  const r = await runDataRetention(ctx.admin, job.org_id);
  return {
    totalDeleted: r.totalDeleted,
    tables: Object.fromEntries(
      r.tables.filter((t) => t.deleted > 0 || t.capped).map((t) => [t.table, { deleted: t.deleted, capped: t.capped }]),
    ),
  };
};
