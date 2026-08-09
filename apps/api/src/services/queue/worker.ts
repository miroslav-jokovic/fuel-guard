import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import type { JobKind } from "../jobs.js";
import { pgQueueDriver } from "./pgDriver.js";
import { getHandler, registeredKinds } from "./registry.js";
import type { JobContext, QueueDriver, QueueJob } from "./types.js";

/**
 * The worker claim → execute → finish loop (WQ0). Poll-based: the stack is PostgREST-only, so
 * LISTEN/NOTIFY needs a raw `pg` connection we don't have yet (enqueue_job already emits pg_notify, so
 * a LISTEN wake drops in later without a contract change). Serial per loop — concurrency comes from
 * multiple replicas + per-kind caps enforced in the claim RPC (plan Q12). Idempotent handlers make
 * at-least-once safe (plan Q9). A killed worker's lease expires and another claims the job (plan Q4).
 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff (seconds), capped — used to space a failed job's retry. */
export function backoffSeconds(attempts: number): number {
  return Math.min(300, 5 * 2 ** Math.max(0, attempts - 1));
}

export type ExecuteOutcome = "done" | "failed" | "no_handler";

/**
 * Execute ONE already-claimed job to completion: dispatch to its registered handler, renew the lease
 * while it runs, then complete (with stats) or fail (retry with backoff). Pure of claiming, so it is
 * unit-testable with a fake driver. A missing handler parks the job (no blind retry against nothing).
 */
export async function executeJob(
  driver: QueueDriver,
  ctx: JobContext,
  job: QueueJob,
  opts: { workerId: string; leaseSeconds: number; renewEveryMs: number },
): Promise<ExecuteOutcome> {
  const handler = getHandler(job.kind);
  if (!handler) {
    await driver.fail(job.id, `no handler registered for kind ${job.kind}`, false, 0);
    return "no_handler";
  }
  let leaseLost = false;
  let renewFailures = 0;
  const renew = setInterval(() => {
    void driver.renew(job.id, opts.workerId, opts.leaseSeconds)
      .then((owned) => {
        if (owned) {
          renewFailures = 0;
          return;
        }
        renewFailures++;
        leaseLost = true;
        console.error(`[queue] lease renewal rejected for job ${job.id} after ${renewFailures} failure(s); refusing completion`);
      })
      .catch((error) => {
        renewFailures++;
        console.error(`[queue] lease renewal failed for job ${job.id} (${renewFailures}):`, error instanceof Error ? error.message : error);
        if (renewFailures >= 2) leaseLost = true;
      });
  }, opts.renewEveryMs);
  try {
    const stats = await handler(ctx, job, (done, total) => driver.progress(job.id, done, total));
    if (leaseLost) {
      // Do not complete a job after ownership was lost. Its lease expiry/reclaimer will make it retryable;
      // completing here could overwrite a newer worker's state.
      console.error(`[queue] job ${job.id} finished after lease loss; leaving it for lease recovery`);
      return "failed";
    }
    await driver.complete(job.id, stats ?? {});
    return "done";
  } catch (e) {
    await driver.fail(job.id, e instanceof Error ? e.message : String(e), true, backoffSeconds(job.attempts));
    return "failed";
  } finally {
    clearInterval(renew);
  }
}

export interface QueueWorkerOpts {
  workerId?: string;
  /** Kinds this worker consumes. Default: everything registered. */
  kinds?: JobKind[];
  leaseSeconds?: number;
  /** How often to renew the lease of a long-running job. Default: leaseSeconds/3. */
  renewEverySeconds?: number;
  /** Base poll interval (ms); actual wait is base + jitter up to base. */
  pollMs?: number;
  /** Per-kind max in-flight across the fleet (soft cap enforced in the claim RPC). */
  kindCaps?: Record<string, number>;
  /** Injectable for tests. */
  driver?: QueueDriver;
}

export interface QueueWorkerHandle {
  workerId: string;
  stop: () => Promise<void>;
}

export function startQueueWorker(admin: SupabaseClient, env: Env, opts: QueueWorkerOpts = {}): QueueWorkerHandle {
  const workerId = opts.workerId ?? `w-${randomUUID().slice(0, 8)}`;
  const leaseSeconds = opts.leaseSeconds ?? 300;
  const renewEveryMs = (opts.renewEverySeconds ?? Math.max(10, Math.floor(leaseSeconds / 3))) * 1000;
  const pollMs = opts.pollMs ?? 2000;
  const caps = opts.kindCaps ?? {};
  const driver = opts.driver ?? pgQueueDriver(admin);
  const ctx: JobContext = { admin, env };

  let stopped = false;

  async function loop(): Promise<void> {
    const kinds = opts.kinds ?? registeredKinds();
    while (!stopped) {
      let job: QueueJob | null = null;
      try {
        job = await driver.claim(workerId, kinds, leaseSeconds, caps);
      } catch (e) {
        console.error("[queue] claim error:", e instanceof Error ? e.message : e);
      }
      if (job) {
        await executeJob(driver, ctx, job, { workerId, leaseSeconds, renewEveryMs });
        continue; // no idle gap while work remains
      }
      await sleep(pollMs + Math.floor(Math.random() * pollMs)); // jittered poll
    }
  }

  const draining = loop();

  return {
    workerId,
    async stop() {
      stopped = true;
      await draining; // let the current claim/run settle so a lease isn't abandoned mid-flight
    },
  };
}
