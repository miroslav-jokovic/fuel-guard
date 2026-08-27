import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobKind } from "../modules/org/index.js";
import { updateJobProgress } from "../modules/org/index.js";
import type { EnqueueOpts, QueueDriver, QueueJob } from "./types.js";

/**
 * Postgres-backed QueueDriver (WQ0). Every claim/lease operation goes through the SKIP-LOCKED RPCs in
 * migration 0095 — supabase-js (PostgREST) cannot row-lock, so claiming MUST be the RPC, never a
 * client-side update. This is the only file that knows the queue is Postgres (plan Q10).
 */
type RawJob = {
  id: string;
  org_id: string;
  kind: JobKind;
  payload: Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
};

function toQueueJob(row: RawJob): QueueJob {
  return {
    id: row.id,
    org_id: row.org_id,
    kind: row.kind,
    payload: row.payload ?? {},
    attempts: row.attempts,
    max_attempts: row.max_attempts,
  };
}

export function pgQueueDriver(admin: SupabaseClient): QueueDriver {
  return {
    async enqueue(kind, opts: EnqueueOpts) {
      const { data, error } = await admin.rpc("enqueue_job", {
        p_org: opts.orgId,
        p_kind: kind,
        p_payload: opts.payload ?? {},
        p_dedup_key: opts.dedupKey ?? null,
        p_requested_by: opts.requestedBy ?? null,
        p_priority: opts.priority ?? 0,
        p_run_after: opts.runAfter ?? new Date().toISOString(),
      });
      // The unique dedup indexes surface a duplicate active (org,kind)/dedup_key as 23505.
      if (error) {
        if (error.code === "23505") return { conflict: true };
        throw new Error(error.message);
      }
      return { jobId: data as string };
    },

    async claim(worker, kinds, leaseSeconds, kindCaps) {
      const { data, error } = await admin.rpc("claim_next_job", {
        p_worker: worker,
        p_kinds: kinds,
        p_lease_seconds: leaseSeconds,
        p_kind_caps: kindCaps,
      });
      if (error) throw new Error(error.message);
      const row = (Array.isArray(data) ? data[0] : data) as RawJob | undefined | null;
      return row ? toQueueJob(row) : null;
    },

    async renew(jobId, worker, leaseSeconds) {
      const { data, error } = await admin.rpc("renew_lease", {
        p_id: jobId,
        p_worker: worker,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(error.message);
      return data === true;
    },

    async complete(jobId, stats) {
      const { error } = await admin.rpc("complete_job", { p_id: jobId, p_stats: stats ?? {} });
      if (error) throw new Error(error.message);
    },

    async fail(jobId, errorMessage, retry, backoffSeconds) {
      const { error } = await admin.rpc("fail_job", {
        p_id: jobId,
        p_error: errorMessage,
        p_retry: retry,
        p_backoff_seconds: backoffSeconds,
      });
      if (error) throw new Error(error.message);
    },

    async progress(jobId, done, total) {
      await updateJobProgress(admin, jobId, done, total ?? undefined);
    },
  };
}
