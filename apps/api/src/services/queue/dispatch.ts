import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { JobConflictError, runJob, type JobKind, type RunJobResult } from "../jobs.js";
import { enqueueJob } from "./enqueue.js";
import { getHandler } from "./registry.js";
import type { JobContext } from "./types.js";

export interface DispatchOpts {
  orgId: string;
  payload?: Record<string, unknown>;
  /** Overrides (org,kind) as the single-active dedup axis when set (payload-keyed kinds). */
  dedupKey?: string | null;
  requestedBy?: string | null;
}

/**
 * Run a job in whichever mode is configured, from a SINGLE registered handler definition (plan Q3/Q5):
 *  - `queue`     → enqueue; a worker executes the handler later.
 *  - `inprocess` → run the SAME handler now, through the jobs-ledger `runJob` wrapper, so progress,
 *                  dedup and cooperative-cancel behave exactly as before this migration.
 * Returns the `runJob`-compatible `{ jobId } | { conflict: true }`, so callers and `jobResponse` are
 * unchanged. This is the seam that lets a kind migrate to the worker by flipping JOB_EXECUTION_MODE.
 */
export async function dispatchJob(
  admin: SupabaseClient,
  env: Env,
  kind: JobKind,
  opts: DispatchOpts,
): Promise<RunJobResult> {
  if (env.JOB_EXECUTION_MODE === "queue") {
    try {
      const jobId = await enqueueJob(admin, kind, {
        orgId: opts.orgId,
        payload: opts.payload,
        dedupKey: opts.dedupKey,
        requestedBy: opts.requestedBy,
      });
      return { jobId };
    } catch (e) {
      if (e instanceof JobConflictError) return { conflict: true };
      throw e;
    }
  }

  const handler = getHandler(kind);
  if (!handler) throw new Error(`no handler registered for kind ${kind}`);
  const ctx: JobContext = { admin, env };
  return runJob(
    admin,
    opts.orgId,
    kind,
    (report, jobId) =>
      handler(
        ctx,
        { id: jobId, org_id: opts.orgId, kind, payload: opts.payload ?? {}, attempts: 1, max_attempts: 1 },
        report,
      ),
    { requestedBy: opts.requestedBy },
  );
}
