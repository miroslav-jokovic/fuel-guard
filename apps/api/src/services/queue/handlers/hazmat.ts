import { executeExtraction } from "../../hazmatExtraction/orchestrate.js";
import type { JobHandler } from "../types.js";

/**
 * Hazmat photo-extraction handler (WQ2). Runs the full vision → verdict pipeline on a worker instead of
 * in-process behind a module semaphore — global concurrency is the per-kind cap (plan Q12).
 *
 * Idempotent (plan Q9): the pipeline records a `hazmat_runs` row keyed by the payload's runId. On a
 * lease-expiry retry the row already exists, so we no-op rather than re-run the (expensive, and
 * duplicate-key-colliding) extraction. executeExtraction is itself fail-closed — it always records a
 * run + transitions the load and never throws — so a first attempt that reached that point is durable.
 */
export const hazmatExtractHandler: JobHandler = async (ctx, job) => {
  const loadId = typeof job.payload.loadId === "string" ? job.payload.loadId : "";
  const runId = typeof job.payload.runId === "string" ? job.payload.runId : job.id;
  const { data: existing } = await ctx.admin.from("hazmat_runs").select("id").eq("id", runId).maybeSingle();
  if (existing) return { loadId, runId, skipped: "run already recorded" };
  await executeExtraction(ctx.admin, job.org_id, loadId, ctx.env, runId);
  return { loadId, runId };
};
