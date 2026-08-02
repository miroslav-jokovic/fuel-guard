import { runEfsSoapIngest } from "../../efsSoapIngest.js";
import type { JobHandler } from "../types.js";

/**
 * EFS SOAP feed pollers (WQ1b). One handler for both kinds — the feed is derived from `job.kind`
 * (`efs_soap_posted` / `efs_soap_rejected`), so payload carries nothing load-bearing. Idempotent:
 * `runEfsSoapIngest` dedupes ingested rows, so a retry re-fetches and no-ops on already-seen rows.
 */
export const efsSoapHandler: JobHandler = async (ctx, job) => {
  const feed = job.kind === "efs_soap_rejected" ? "rejected" : "posted";
  const stats = await runEfsSoapIngest(ctx.admin, ctx.env, job.org_id, feed);
  if (stats.status === "ingested" && stats.rowsFetched > 0) {
    console.log(
      `[efs-soap] org ${job.org_id} ${feed}: ingested ${stats.rowsFetched} rows across ${stats.pagesFetched} page(s)`,
    );
  } else if (stats.status === "failed") {
    console.error(`[efs-soap] org ${job.org_id} ${feed}: FAILED — ${stats.error ?? "unknown"}`);
  }
  return stats;
};
