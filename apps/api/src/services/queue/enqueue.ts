import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobKind } from "../../modules/org/index.js";
import { JobConflictError } from "../../modules/org/index.js";
import { pgQueueDriver } from "./pgDriver.js";
import type { EnqueueOpts, QueueDriver } from "./types.js";

/**
 * Enqueue a job for the worker pool (queue mode). Throws `JobConflictError` on a duplicate active
 * (org,kind)/dedup_key — the SAME contract as the ledger's `runJob` conflict, so request handlers and
 * schedulers behave identically whether a kind runs in-process or on the queue (plan Q5).
 */
export async function enqueueJob(
  admin: SupabaseClient,
  kind: JobKind,
  opts: EnqueueOpts,
  driver: QueueDriver = pgQueueDriver(admin),
): Promise<string> {
  const res = await driver.enqueue(kind, opts);
  if ("conflict" in res) throw new JobConflictError(kind);
  return res.jobId;
}
