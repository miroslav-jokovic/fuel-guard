import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import type { JobKind } from "../jobs.js";

/**
 * Durable job queue (WQ0). The `QueueDriver` seam (plan Q10) hides the queue mechanism from handlers so
 * the Postgres implementation can be swapped for a broker later without touching a single handler.
 */

/** A claimed unit of work. `payload` is the serialized input a handler reconstructs from (plan Q3) —
 *  handlers never close over request state. */
export interface QueueJob {
  id: string;
  org_id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/** Everything a handler is allowed to touch. Handlers must be idempotent — a lease can expire on a
 *  slow-but-alive job, so a job may run more than once (plan Q9). */
export interface JobContext {
  admin: SupabaseClient;
  env: Env;
}

export type ProgressReporter = (done: number, total?: number | null) => Promise<void>;

export type JobHandler = (
  ctx: JobContext,
  job: QueueJob,
  report: ProgressReporter,
) => Promise<Record<string, unknown> | void>;

export interface EnqueueOpts {
  orgId: string;
  payload?: Record<string, unknown>;
  /** When set, replaces (org,kind) as the single-active dedup axis (e.g. a per-load hazmat run). */
  dedupKey?: string | null;
  requestedBy?: string | null;
  priority?: number;
  runAfter?: string;
}

export interface QueueDriver {
  enqueue(kind: JobKind, opts: EnqueueOpts): Promise<{ jobId: string } | { conflict: true }>;
  claim(
    worker: string,
    kinds: JobKind[],
    leaseSeconds: number,
    kindCaps: Record<string, number>,
  ): Promise<QueueJob | null>;
  renew(jobId: string, worker: string, leaseSeconds: number): Promise<boolean>;
  complete(jobId: string, stats: Record<string, unknown>): Promise<void>;
  fail(jobId: string, error: string, retry: boolean, backoffSeconds: number): Promise<void>;
  progress(jobId: string, done: number, total?: number | null): Promise<void>;
}
