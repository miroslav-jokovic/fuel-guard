# WQ4 — Durable-queue cutover runbook

The plan: `docs/plans/P0-WORKER-QUEUE-PLAN.md`. Deploy topology: `docs/WORKER-DEPLOYMENT.md`.

WQ0–WQ3 + WQ1c are code-complete: every background kind has one handler served in both modes through
`dispatchJob`, schedulers enqueue in queue mode, leases + the role split make multi-replica safe, and the
Q7 per-kind caps bound vendor RPS. The system still runs `JOB_EXECUTION_MODE=inprocess` by default, so
nothing has changed behaviorally in production yet. WQ4 is the controlled switch to `queue` and the removal
of the in-process path once queue mode has proven itself on live data.

This is a runbook, not code to merge — the flip and the live validation are operator actions (they touch a
live DB and are environment-specific). Do the phases in order; do not skip Phase A.

## Preconditions

- Migration `0095_jobs_queue.sql` is applied to the target database (the claim/lease RPCs + indexes). Verify:
  `select proname from pg_proc where proname in ('enqueue_job','claim_next_job','renew_lease','complete_job','fail_job');`
  returns all five.
- A worker deployment exists (see `docs/WORKER-DEPLOYMENT.md`). For the canary, one `WORKER_ROLE=both`
  process is enough; the scaled target is 1× `scheduler` + N× `consumer`.
- The API can reach `/api/jobs/queue-metrics` (admin/fleet_manager) — the canary's primary instrument.
- A rollback is always one env change away: set `JOB_EXECUTION_MODE=inprocess` and redeploy. No schema
  change is needed to roll back — the ledger rows are compatible with both modes.

## Phase A — Canary validation (queue mode on ONE environment/org)

Set `JOB_EXECUTION_MODE=queue` on a staging (or a single low-risk) environment only, with one worker running
schedulers + consumer, and confirm each property below. Watch `GET /api/jobs/queue-metrics` and the worker's
`[queue-metrics]` log line throughout.

1. **Claim + completion.** Trigger a manual sync (e.g. "Sync fleet identity"). The endpoint returns
   `202 {jobId}`; the job row goes `queued → running → done`; the web button shows running then toasts the
   real counts. `queue-metrics` shows the job appear in `queued`, then drain.
2. **Lease reclaim (crash recovery).** Start a long job (a full backfill), then kill the worker process
   mid-run. Confirm the job is NOT failed on restart (its lease is intact), and that a restarted/other
   consumer re-claims it once the lease expires — a retry, not a lost or double-charged job.
3. **Per-kind concurrency cap (Q7).** Enqueue several runs of one Samsara kind across orgs and confirm at
   most one is `running` at a time fleet-wide (the claim RPC honors `KIND_CAPS`). Watch Samsara for 429s —
   there should be none attributable to parallelism.
4. **Dedup / 409 preserved.** Click a sync twice quickly (or let a scheduled tick overlap a manual run).
   The second attempt returns 409 "already running" and does not create a duplicate active job.
5. **Scheduler enqueues once.** With `WORKER_ROLE=scheduler` on exactly one process, confirm each tier
   enqueues one job per org per tick (no duplicate scheduled jobs from multiple schedulers).
6. **Idempotency.** Force a retry (kill mid-run per step 2) and confirm the re-run converges on the same
   rows (no double imports, no duplicate scores) — every handler is upsert/dedupe-keyed.
7. **Backlog stays bounded (A1).** Under a realistic load, `oldestQueuedAgeSec` stays small (seconds, not
   minutes) and returns to ~0 between bursts. A sustained climb past ~300s means consumers are down or
   under-provisioned (the log warns automatically at that threshold).

Hold in this state long enough to cover at least one full scheduler cycle of every tier (stats, identity,
driver-scores, idle, snapshot, nightly reconcile) plus a nightly-reconcile fire.

## Phase B — Production cutover

When Phase A is clean:

1. Deploy the scaled topology: API with `RUN_SCHEDULERS_IN_PROCESS=false`; one `WORKER_ROLE=scheduler`
   replica; N `WORKER_ROLE=consumer` replicas — all with `JOB_EXECUTION_MODE=queue`.
2. Flip `JOB_EXECUTION_MODE=queue` on production and roll out.
3. Watch `queue-metrics` (endpoint + log) and Sentry for the first few scheduler cycles. Verify the sync
   buttons and the DataSync cards behave (running → final counts), and that `failedRecent` stays flat.
4. If anything regresses, roll back: set `JOB_EXECUTION_MODE=inprocess`, redeploy. In-process mode still
   works because both modes share the same handlers.

## Phase C — Cleanup (only after production is stable on queue for several days)

This is the destructive, code-change step — deliberately deferred until queue mode is proven, because it
removes the rollback path. When confident:

- Make `queue` the default in `env.ts` (or require it explicitly and drop `inprocess`).
- Remove the in-process branch of `dispatchJob` and the `runJob` closure path in `services/jobs.ts`.
- Remove the inline `runOrgTier`/nightly in-process branches in the schedulers (keep only the enqueue path).
- Remove the now-dead per-process module semaphores / `nextFreeAt` limiter remnants once the bounded lane is
  the sole rate control, and simplify `reclaimInterruptedJobs` (leases are the only recovery path).
- Update `docs/WORKER-DEPLOYMENT.md` to describe queue mode as the only mode.

Do Phase C as its own reviewed PR, not during the cutover.

## Monitoring & tripwires (ongoing)

- `GET /api/jobs/queue-metrics` — `queued`, `running`, `failedRecent` (24h), `oldestQueuedAgeSec`, `byKind`.
- Worker `[queue-metrics]` log — one line per minute on the scheduler; **warns** when `oldestQueuedAgeSec`
  exceeds 300s (consumers down / under-provisioned).
- Sentry — handler exceptions surface as failed jobs with the error on the ledger row and in Sentry.
- Samsara/EFS 429s — should be near-zero; a rise means a vendor cap needs a lower `KIND_CAPS` value or the
  dedicated single-replica vendor lane (see `docs/WORKER-DEPLOYMENT.md`).
