import type { JobHandler } from "../types.js";
import { buildBinder } from "../../../modules/evidence/index.js";
import { markDone, markFailed, markRunning, storeBinder } from "../../../modules/evidence/index.js";

/**
 * `dq_binder` — assemble an auditor's sample into one PDF (DQ-BINDER-PLAN D-BD3).
 *
 * A BACKGROUND JOB, not a request. Fifteen drivers is roughly 270 documents pulled out of storage
 * and merged; that is a minute or two, which a synchronous request would spend timing out on
 * Railway and the user would read as broken.
 *
 * IDEMPOTENT, because a lease can expire on a slow-but-alive job and the queue will hand the work to
 * somebody else. The export row is the idempotency key: a row already `done` is left exactly as it
 * is, and a retry of a half-finished one overwrites its own object (`upsert`) rather than orphaning
 * the first attempt's bytes.
 */
export const dqBinderHandler: JobHandler = async (ctx, job, report) => {
  const exportId = typeof job.payload.exportId === "string" ? job.payload.exportId : "";
  if (!exportId) throw new Error("dq_binder job has no exportId");

  const { data: row } = await ctx.admin
    .from("dq_exports")
    .select("id, status, driver_ids, as_at, requested_by, created_at, include_restricted")
    .eq("org_id", job.org_id)
    .eq("id", exportId)
    .maybeSingle();
  const exportRow = row as {
    id: string;
    status: string;
    driver_ids: string[];
    as_at: string;
    requested_by: string | null;
    created_at: string;
    include_restricted: boolean | null;
  } | null;

  if (!exportRow) throw new Error(`export ${exportId} does not exist for this organization`);
  if (exportRow.status === "done") return { exportId, skipped: "already assembled" };

  // Who asked, in the form the cover prints. Falls back to the id rather than to "unknown": a binder
  // that cannot say who produced it is exactly the loose page §390.32 is about.
  let generatedBy = exportRow.requested_by ?? "system";
  if (exportRow.requested_by) {
    const { data: u } = await ctx.admin.auth.admin
      .getUserById(exportRow.requested_by)
      .catch(() => ({ data: null }));
    generatedBy = (u as { user?: { email?: string } } | null)?.user?.email ?? generatedBy;
  }

  await markRunning(ctx.admin, exportId);
  await report(0, exportRow.driver_ids.length);

  try {
    const result = await buildBinder(
      ctx.admin,
      job.org_id,
      exportRow.driver_ids,
      {
        exportId,
        asAt: exportRow.as_at,
        // The request's timestamp, not the worker's. A binder that says it was generated at 03:14
        // because that is when the queue got to it misdates the record it is evidence of.
        generatedAt: exportRow.created_at,
        generatedBy,
        // Phase G (D-DQ15): from the ledger row the route wrote after its privilege check.
        includeRestricted: exportRow.include_restricted === true,
      },
      report,
    );

    const stored = await storeBinder(ctx.admin, job.org_id, exportId, result.bytes);
    if (typeof stored !== "string") throw new Error(stored.error);

    await markDone(ctx.admin, exportId, {
      storagePath: stored,
      bytes: result.bytes.byteLength,
      pages: result.pages,
      driversCount: result.driversCount,
      documentsCount: result.documentsCount,
      gapsCount: result.gapsCount,
    });

    return {
      exportId,
      pages: result.pages,
      drivers: result.driversCount,
      documents: result.documentsCount,
      gaps: result.gapsCount,
      missing: result.missingIds.length,
    };
  } catch (e) {
    // Record the failure ON THE EXPORT before rethrowing, so the person who is waiting for a binder
    // sees why it failed on the screen they requested it from, not only in the jobs ledger.
    const message = e instanceof Error ? e.message : "The binder could not be assembled.";
    await markFailed(ctx.admin, exportId, message);
    throw e;
  }
};
