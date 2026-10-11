import * as Sentry from "@sentry/node";

/**
 * Graceful shutdown: what this process does between Railway's SIGTERM and its SIGKILL.
 *
 * ── WHY THIS EXISTS (EFS audit, 2026-09-30) ─────────────────────────────────────────────────────
 * Nothing in the API handled SIGTERM, so every deploy killed whatever job was mid-run. The EFS
 * posted-feed poll runs about once a minute per org, so nearly every deploy caught one: 27 of 27
 * `efs_soap_posted` failures in the week to 2026-09-30 were `reclaimed (lease expired)`, paired one
 * per org and lined up with deploy switchovers (17:55 → 17:57, 18:39 → 18:42, 18:55 → 18:59). Each
 * killed row then held its (org, kind) slot for the rest of its five-minute lease, so the feed went
 * dark for 5–7 minutes after every merge, and `financialFreshness` turned each one into a critical
 * finding for every office user — 90 notifications that week, none of them about EFS.
 *
 * ── WHAT IT DOES ──────────────────────────────────────────────────────────────────────────────
 *  1. Stops new work: `isShuttingDown()` makes `runJob` and the queue loops refuse to start a job.
 *  2. Waits for running jobs to settle, up to the drain budget. A posted poll is 4 s median, 14 s p99.
 *  3. RELEASES whatever is still running — marks it failed with `SHUTDOWN_RELEASED_ERROR` and clears
 *     its lease — so the next process can take the slot at once instead of waiting out the lease.
 *     Every job kind is idempotent (queue/types.ts), so a released run is simply run again.
 *
 * ── THE PLATFORM HALF, WITHOUT WHICH NONE OF THIS RUNS ──────────────────────────────────────────
 * Railway sends SIGKILL immediately after SIGTERM unless the service sets
 * `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` ("By default, it is given 0 seconds to gracefully shutdown",
 * docs.railway.com/reference/deployments). And the signal has to reach node: measured 2026-09-30,
 * `pnpm` forwards SIGTERM to its child but EXITS AT ONCE with 143 rather than waiting for it, and in
 * a container the first process exiting stops the container. So `railway.json` starts node directly
 * (`exec node --import tsx`), and the drain budget is read from the same Railway variable, so the two
 * cannot disagree.
 */

/** Written on a job this process let go of at shutdown. Alerting reads it; see financialFreshness. */
export const SHUTDOWN_RELEASED_ERROR = "released at shutdown (deploy) — the next run picks it up";

/** Seconds kept back from Railway's draining window for the releases, the Sentry flush and exit. */
const RELEASE_MARGIN_SECONDS = 10;

interface TrackedJob {
  kind: string;
  settled: Promise<unknown>;
  release: () => Promise<void>;
}

const inFlight = new Map<string, TrackedJob>();
let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Thrown by `runJob` once shutdown has begun — a new job would only be killed or released. */
export class ProcessShuttingDownError extends Error {
  constructor(kind: string) {
    super(`not starting ${kind}: this process is shutting down`);
    this.name = "ProcessShuttingDownError";
  }
}

/**
 * Register a running job. `settled` resolves when the job finishes by itself; `release` hands it
 * back if shutdown has to leave before then. Returns the function that unregisters it.
 */
export function trackJob(id: string, job: TrackedJob): () => void {
  inFlight.set(id, job);
  return () => {
    inFlight.delete(id);
  };
}

/** How long to wait for running jobs, from Railway's own draining variable. Exported for its test. */
export function drainBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  const draining = Number(env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS ?? 0);
  if (!Number.isFinite(draining) || draining <= 0) return 0;
  return Math.max(0, draining - RELEASE_MARGIN_SECONDS) * 1000;
}

/**
 * One shutdown pass: stop new work, wait up to `budgetMs`, release the rest. Exported for its test;
 * `installShutdownHandlers` is the production caller. Returns which jobs finished and which were
 * released, so the log line can name them.
 */
export async function drainJobs(budgetMs: number): Promise<{ finished: string[]; released: string[] }> {
  shuttingDown = true;
  const waiting = [...inFlight.entries()];
  const finished: string[] = [];
  if (waiting.length && budgetMs > 0) {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, budgetMs);
    });
    await Promise.race([
      Promise.allSettled(waiting.map(([, job]) => job.settled)),
      deadline,
    ]);
    clearTimeout(timer);
  }
  const released: string[] = [];
  for (const [id, job] of waiting) {
    if (!inFlight.has(id)) {
      finished.push(`${job.kind} ${id}`);
      continue;
    }
    try {
      await job.release();
      released.push(`${job.kind} ${id}`);
    } catch (e) {
      // The lease still expires on its own; this only loses the fast hand-over.
      console.error(`[shutdown] could not release ${job.kind} ${id}: ${e instanceof Error ? e.message : e}`);
    }
    inFlight.delete(id);
  }
  return { finished, released };
}

/**
 * Wire SIGTERM/SIGINT for a long-running process. `beforeDrain` closes whatever takes new work in
 * (the HTTP listener, a queue loop). A second signal exits at once — an operator's Ctrl-C twice.
 */
export function installShutdownHandlers(opts: { name: string; beforeDrain?: () => void }): void {
  let started = false;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (started) {
      console.error(`[shutdown] ${opts.name}: second ${signal}, exiting now`);
      process.exit(1);
    }
    started = true;
    const budgetMs = drainBudgetMs();
    console.log(`[shutdown] ${opts.name}: ${signal} — ${inFlight.size} job(s) running, waiting up to ${budgetMs / 1000}s`);
    try {
      opts.beforeDrain?.();
    } catch (e) {
      console.error(`[shutdown] ${opts.name}: beforeDrain failed: ${e instanceof Error ? e.message : e}`);
    }
    void drainJobs(budgetMs)
      .then(({ finished, released }) => {
        console.log(
          `[shutdown] ${opts.name}: ${finished.length} finished, ${released.length} released` +
            (released.length ? ` (${released.join(", ")})` : ""),
        );
      })
      .catch((e) => console.error(`[shutdown] ${opts.name}: drain failed: ${e instanceof Error ? e.message : e}`))
      .finally(() => {
        void Sentry.flush(2_000).finally(() => process.exit(0));
      });
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
}

/** Test seam: the registry is process-global. */
export function resetShutdownStateForTests(): void {
  inFlight.clear();
  shuttingDown = false;
}
