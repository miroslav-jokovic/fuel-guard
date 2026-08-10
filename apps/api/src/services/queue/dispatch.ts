import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import {
  JobConflictError,
  runJob,
  scoringDedupKey,
  SCORING_JOB_KINDS,
  type JobKind,
  type RunJobResult,
} from "../jobs.js";
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
  // P0-3: every scoring-capable kind carries the per-org scoring mutex unless the caller set an
  // explicit dedup key — so rebuild / backfill / ingest / import-scoring can never write scoring
  // outcomes for one org concurrently, regardless of which kinds they entered through.
  const dedupKey =
    opts.dedupKey !== undefined
      ? opts.dedupKey
      : SCORING_JOB_KINDS.has(kind)
        ? scoringDedupKey(opts.orgId)
        : null;

  if (env.JOB_EXECUTION_MODE === "queue") {
    try {
      const jobId = await enqueueJob(admin, kind, {
        orgId: opts.orgId,
        payload: opts.payload,
        dedupKey,
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
    // P0-3/P0-4: the dedup mutex + requestedBy now reach the in-process ledger too (they were
    // previously dropped here — the 0095 dedup index existed but nothing in this mode used it).
    { requestedBy: opts.requestedBy, dedupKey },
  );
}
