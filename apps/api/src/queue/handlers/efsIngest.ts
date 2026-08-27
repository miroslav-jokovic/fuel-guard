import { buildIngestSource, runEfsIngest } from "../../modules/efs/services/efsAutoIngest.js";
import { writeAudit } from "../../lib/audit.js";
import type { JobHandler } from "../types.js";

/**
 * `efs_ingest` handler (WQ0 proof kind). Reconstructs everything from the payload (`{ orgId }`) — no
 * closure over scheduler state. Idempotent by construction (plan Q9): `runEfsIngest` dedupes on file
 * hash + external_ref, so a re-run (lease expiry, retry) is a safe no-op.
 */
export const efsIngestHandler: JobHandler = async (ctx, job) => {
  const orgId = typeof job.payload.orgId === "string" ? job.payload.orgId : job.org_id;
  const source = buildIngestSource(ctx.admin, ctx.env, orgId);
  if (!source) return { skipped: "efs ingest source disabled/unconfigured" };
  const stats = await runEfsIngest(ctx.admin, ctx.env, source);
  // Manual trigger (route passes actorId) writes the same audit the old route closure did.
  const actorId = typeof job.payload.actorId === "string" ? job.payload.actorId : null;
  if (actorId) {
    await writeAudit(ctx.admin, {
      orgId, actorId, action: "transactions.ingest_efs",
      meta: { found: stats.found, ingested: stats.ingested, quarantined: stats.quarantined },
    });
  }
  return stats;
};
