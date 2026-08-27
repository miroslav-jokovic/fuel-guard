import { runEfsSoapIngest } from "../../../modules/efs/services/efsSoapIngest.js";
import { writeAudit } from "../../../lib/audit.js";
import type { JobHandler } from "../types.js";

/**
 * EFS SOAP feed pollers (WQ1b). One handler for both kinds — the feed is derived from `job.kind`
 * (`efs_soap_posted` / `efs_soap_rejected`), so payload carries nothing load-bearing. Idempotent:
 * `runEfsSoapIngest` dedupes ingested rows, so a retry re-fetches and no-ops on already-seen rows.
 *
 * WQ1c: the manual "Sync now" button also routes here (via dispatchJob). When it does, `payload.actorId`
 * is set and we write the same `sync_now` audit the route closure used to; scheduler polls carry no
 * actor and write no audit.
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
  const actorId = typeof job.payload.actorId === "string" && job.payload.actorId.length > 0 ? job.payload.actorId : null;
  if (actorId) {
    await writeAudit(ctx.admin, {
      orgId: job.org_id, actorId, action: `integration.efs_soap.sync_now.${feed}`, entity: "efs_soap_credentials",
      meta: { status: stats.status, rowsFetched: stats.rowsFetched, pagesFetched: stats.pagesFetched, error: stats.error ?? null },
    });
  }
  return stats;
};
