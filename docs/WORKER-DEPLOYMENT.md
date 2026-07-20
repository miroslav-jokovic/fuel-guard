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
   - Start command: `pnpm --filter @fuelguard/api worker`
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
