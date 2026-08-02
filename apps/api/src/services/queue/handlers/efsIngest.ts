import { buildIngestSource, runEfsIngest } from "../../efsAutoIngest.js";
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
  return await runEfsIngest(ctx.admin, ctx.env, source);
};
