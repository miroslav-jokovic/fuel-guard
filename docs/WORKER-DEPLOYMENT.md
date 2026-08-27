# Worker / Scheduler Deployment

The background schedulers (Samsara sync, rebuild-on-boot, weekly digest, nightly reconcile, EFS
auto-ingest, posted-price refresh) used to run inside the single API process. They now live in
`startAllSchedulers` (apps/api/src/schedulers.ts) and run either in-process (default) or in a
dedicated worker service — controlled by the `RUN_SCHEDULERS_IN_PROCESS` env var.

## Current single-service deploy — nothing to change
`RUN_SCHEDULERS_IN_PROCESS` defaults to `true`, so one API instance keeps running the schedulers exactly
as before. This change ships safely with no config edits.

## Scaling the API horizontally (do this before running 2+ API instances)
Running schedulers in-process is only safe on ONE instance — scale the API past 1 and rebuild-on-boot
(the one scheduler without a job-ledger guard) runs on every instance. To scale out:

1. Add a second Railway service from the same repo — the **worker**:
   - Start command: `pnpm --filter @silvicom/api worker`
   - Same env vars as the API (Supabase, Samsara, mail, HERE, etc.)
   - **Replicas: 1** (schedulers must run in exactly one process).
2. On the **API** service, set `RUN_SCHEDULERS_IN_PROCESS=false`. The API now serves only HTTP and can
   scale to N replicas; the worker owns all background work.
3. Deploy. Confirm in logs: API prints "in-process schedulers disabled…"; worker prints
   "[FuelGuard worker] starting background schedulers".

## Safety model
- The `jobs` ledger (partial unique index on `(org_id, kind)`) already prevents two concurrent runs of the
  same per-org work across processes.
- `reclaimInterruptedJobs` clears slots left by a crashed process on each worker/API boot.
- Invariant: schedulers run in exactly ONE process (single API, or single-replica worker) — never both,
  never a multi-replica worker.

## Rollback
Set `RUN_SCHEDULERS_IN_PROCESS=true` (or unset) on the API and remove the worker service — the app returns
to single-service behavior immediately. No data migration involved.

## Horizontal scaling with the durable queue (WQ3 — `docs/plans/P0-WORKER-QUEUE-PLAN.md`)
Once `JOB_EXECUTION_MODE=queue` (and migration `0095` is applied), heavy work is enqueued and executed by
a worker pool instead of running in-process. The worker's `WORKER_ROLE` env sets what a process does:

- **`scheduler`** — runs the `setInterval` schedulers (which now *enqueue* jobs). Deploy as a **single
  replica** — schedulers must tick exactly once (rebuild-on-boot + the boot sweep assume one owner).
- **`consumer`** — claims + executes enqueued jobs via the `SELECT … FOR UPDATE SKIP LOCKED` claim RPC.
  **Scale to N replicas freely** — concurrent claiming is safe, and per-job leases mean a crashed
  consumer's job is re-claimed by another when its lease expires (a retry, not a lost job).
- **`both`** (default) — the current single-worker deploy (schedulers + consumer in one process).

Recommended scaled topology: **API** (`RUN_SCHEDULERS_IN_PROCESS=false`, N replicas) · **1× scheduler
worker** (`WORKER_ROLE=scheduler`) · **N× consumer workers** (`WORKER_ROLE=consumer`, `JOB_EXECUTION_MODE=queue`).

### Boot sweep is now lease-aware (safe under multiple replicas)
`reclaimInterruptedJobs` no longer fails *every* queued/running job on boot. It fails **only running jobs
with no active lease** (inprocess-mode jobs whose process died); leased queue jobs are recovered by lease
expiry and queued jobs are left to be claimed — so a restarting worker can never fail another live
worker's job. This removes the "single-instance only" constraint the old boot sweep imposed.

### Global vendor rate limits under multiple replicas (Q7 — WQ1c)
Before the queue, Samsara/EFS-SOAP pacing was a **per-process** limiter (`lib/samsaraHttp.ts`), so scaling
the API/worker to N replicas multiplied the effective vendor RPS by N and risked 429s. Now that every
vendor-calling kind runs on the consumer, the claim RPC's **per-kind in-flight cap** is the global rate
limit. The consumer sets `KIND_CAPS` (`apps/api/src/worker.ts`) so each Samsara sync kind
(`sync_vehicles`/`_trailers`/`_idle`/`_drivers`/`_driver_scores`/`_stats`), `snapshot_driver_week`,
`nightly_reconcile`, and each `efs_soap_*` poller is capped at **1 in-flight across the whole fleet** — at
most one run of each kind executes at any moment, no matter how many consumer replicas are running.

For very high consumer fan-out (many replicas), harden further by giving the vendor kinds their **own
dedicated single-replica consumer group**: run one consumer with `WORKER_ROLE=consumer` and (via
`startQueueWorker`'s `kinds` option) only the Samsara/SOAP kinds, and exclude those kinds from the
general consumer pool. Because the claim loop is serial per process, a single-replica lane serializes
**all** vendor calls through one limiter — the strongest form of the bounded lane.
