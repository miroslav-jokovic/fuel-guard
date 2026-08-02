# P0 — Durable Queue & Worker Extraction Plan

> Status: **AUTHORING → BUILDING** · Created 2026-08-01 · Resolves audit finding **P0** (`docs/ARCHITECTURE-AUDIT-2026-08-01.md`) — "the entire API is pinned to a single instance because all heavy background work runs in-process."
>
> This **evolves the existing infrastructure** (the `jobs` ledger from `0027`, the `worker.ts` service, and the `RUN_SCHEDULERS_IN_PROCESS` split in `docs/WORKER-DEPLOYMENT.md` / `docs/plans/AUTOMATION-BUILD-PLAN.md`). It does **not** introduce a new queue system or new infrastructure. Build **one phase per working session**; clear §8 before commit. Every decision is LOCKED (Q1–Q8) unless a row says otherwise.

---

## §0. How to use / resume

1. Read §1 (locked decisions) and §3 (progress ledger) first.
2. Read the current phase in full before building it — each is self-contained (goal, deliverables, exit, tests).
3. This is grounded in code (§2). The guiding constraint: **the API process must end up running ZERO heavy background work**; all of it is enqueued and executed by a horizontally-scalable worker pool that claims jobs from Postgres. Preserve every existing behavior (dedup, progress, cancel, the UI read model) — this is a *mechanism* change, not a *contract* change.

---

## §1. Locked decisions (Q-register)

| # | Decision | Rationale (grounded) |
|---|----------|----------------------|
| **Q1** | **Postgres-as-queue.** Evolve the existing `jobs` table into a durable work queue; jobs are claimed via a `SECURITY DEFINER` SQL function using `SELECT … FOR UPDATE SKIP LOCKED`, called through `admin.rpc(...)`. **No Redis / BullMQ / SQS.** | The stack is Supabase Postgres + Railway; the code already uses `admin.rpc()` widely (`org_module_enabled`, `emit_notification`, `end_duty_session`); `0027` already models the ledger. Adding a broker is new infra, new cost, new failure mode — Postgres SKIP LOCKED is the idiomatic, sufficient choice at this scale and consistent with the existing design. |
| **Q2** | **Evolve `worker.ts` into a job-consuming pool**, keeping the Railway API + worker split. Job consumption becomes **horizontally scalable (N worker replicas)**; scheduler *ticks* remain single-owner (a leader/one lane), which is a separate concern from job execution. | `worker.ts` + `RUN_SCHEDULERS_IN_PROCESS` + `docs/WORKER-DEPLOYMENT.md` already establish the worker service; P0 gives it a claim loop and lets it scale, instead of only running `setInterval` schedulers. |
| **Q3** | **Enqueue, never run inline.** `runJob` splits into `enqueueJob(kind, payload, opts)` (insert `status='queued'`, return immediately) and a worker **claim → execute → finish** loop. Request handlers and schedulers only *enqueue*. The API never executes `work`. | Today `runJob` runs `work` via `void (async…)()` on the caller's event loop — the root cause. The `queued` status already exists in `0027`'s enum (currently unused — `startJob` inserts `running` directly), so this reuses the schema. |
| **Q4** | **Lease-based reclaim replaces the boot-sweep.** Jobs carry `locked_by`, `lease_expires_at`, `attempts`, `max_attempts`, `run_after`. A job whose lease expires is re-claimable by any worker; failures retry with backoff to a cap, then park as `failed` (poison). The destructive `reclaimInterruptedJobs` (marks *all* running → failed on boot) is **removed**. | `reclaimInterruptedJobs`' own comment says it only works single-instance and must become a heartbeat/lease for multi-instance. Leases make multi-replica safe and crash-recovery automatic without killing live work. |
| **Q5** | **Preserve every existing contract:** the `(org_id, kind)` single-active dedup (→ 409 `JobConflictError`), `updateJobProgress`, cooperative cancel (`stats.cancel_requested`, polled by long jobs + checkpointed for resume), and the UI read model (`latestJob` / `lastDoneJob`). These are mechanism-invariant. | Dispatch UI, rebuild/backfill buttons, and freshness labels depend on them; the audit is about *where* work runs, not *what* the ledger promises. |
| **Q6** | **Hazmat extraction + analysis become queue kinds** (`hazmat_extract`, `hazmat_analyze`) consumed by workers; the module-level semaphores (`MAX_CONCURRENT` in `hazmatExtraction/orchestrate.ts` + `hazmatAnalysis.ts`) are replaced by **worker-pool concurrency**. Their dedup key is the **load id** (per-load), which is *different* from the ledger's `(org, kind)` — so the queue supports a general `dedup_key` distinct from `(org, kind)`. | These are the heaviest in-process workloads and today bypass the ledger entirely with per-process caps that evaporate under multiple instances (audit P0-B). |
| **Q7** | **Distributed rate limiting for Samsara / SOAP.** The per-process `Map` limiters (`lib/samsaraHttp.ts`, `lib/soapClient.ts`) are replaced by either (a) a DB-backed token-bucket RPC, or (b) pinning all Samsara/SOAP-calling job kinds to a **single bounded lane** (a dedicated low-concurrency worker group). Decided in WQ3; default recommendation: the bounded lane (simpler, no hot-path DB round-trip). | Per-process pacing means N instances = N× the vendor RPS → 429s (audit P0-C). Once Samsara sync is a worker job, its rate limit must be global. |
| **Q8** | **Incremental, reversible rollout behind a flag** (`JOB_EXECUTION_MODE = inprocess \| queue`, default `inprocess`). Each job kind migrates independently; the in-process path stays until WQ4 cutover. | No big-bang. Matches the existing `RUN_SCHEDULERS_IN_PROCESS` rollback philosophy in `WORKER-DEPLOYMENT.md`. |
| **Q9** | **Idempotency is a hard contract.** Every handler must be safe to run ≥1× (a lease can expire on a slow-but-alive job, so a second worker may pick it up — correctness must not depend on exactly-once). Enforced via natural-key upserts, existing checkpoints (backfill's `samsara_recon_at`), and the notify `dedupeKey`; each kind ships an idempotency note + a "run twice → same result" test. | Leases + at-least-once delivery make idempotency the safety net; without it, retries corrupt data. |
| **Q10** | **Thin `QueueDriver` seam.** enqueue / claim / renew / complete / fail sit behind a small interface with a Postgres implementation; handlers never see the queue mechanism. | Hedges the "Postgres is sufficient" assumption (A1): if volume outgrows pg-queue, a broker implementation swaps in without touching a single handler. |
| **Q11** | **Wake via LISTEN/NOTIFY + jittered poll fallback.** enqueue emits `pg_notify('jobs', kind)`; idle workers wake instantly; a 2–5 s jittered poll backstops missed notifies and drives the lease-expiry reclaim scan. | Low latency without busy-polling; no extra infrastructure. **WQ0 note:** ships **poll-only** — the stack is PostgREST/supabase-js with no raw `pg` connection, so LISTEN needs a `pg` client added later; `enqueue_job` already emits `pg_notify`, so LISTEN drops in without a contract change. |
| **Q12** | **Per-kind global concurrency caps.** Each kind declares a max in-flight count the claim enforces (a kind at its cap is not claimed). Bounds Anthropic spend (hazmat vision) and Samsara/SOAP RPS by config, and is the home for Q7's rate limiting. | Replaces the module-level semaphores with a distributed, configurable cap — the thing that evaporated under multiple instances. |
| **Q13** | **Scheduler-tick ownership via `pg_try_advisory_lock`.** The single process that fires scheduled ticks holds a Postgres advisory lock; others skip. | Turns the "exactly one process" env-flag invariant into an enforced lock so a misconfiguration cannot double-fire ticks (audit P0-C). |
| **Q14** | **Atomic enqueue with its state change.** Where enqueuing accompanies a state write (e.g. mark a load `analyzing` + enqueue its extraction), do both in one RPC/transaction. Enqueue-only kinds are a no-op. | Prevents enqueuing a job for a state that rolled back (or the reverse) — a consistency bug the closure model hid. |

**The one genuine refactor challenge (not a decision — a task):** today `work` is a **closure** passed to `runJob`, capturing request context (org, filters, uploaded rows). In a queue, the worker runs a job from its **serialized `payload`**, so each kind needs a **registered handler** `(admin, orgId, payload, report, jobId) => stats` that reconstructs everything from the payload — nothing captured in memory. Kinds that today capture large in-memory data (e.g. `score_import` over an uploaded file) must persist that input first (an `imports`/storage row) and reference it by id. WQ1 audits each call site for this.

---

## §2. What exists vs what's missing (grounded)

**Exists (reuse / evolve):**
- `supabase/migrations/0027_jobs.sql` — `jobs(id, org_id, kind, status[queued|running|done|failed], progress, total, error, stats jsonb, requested_by, started/finished/created/updated_at)`; partial unique `idx_jobs_active_one (org_id, kind) where status in (queued,running)`; RLS select-for-org, service-role writes.
- `apps/api/src/services/jobs.ts` — `startJob` (inserts `running`; stale-reclaim > 2h), `runJob` (claims + runs `work` in-process), `updateJobProgress`, `finishJob`, `latestJob`/`lastDoneJob`, `requestJobCancel`/`jobCancelRequested`, `reclaimInterruptedJobs` (boot sweep).
- `apps/api/src/worker.ts` — single-replica worker running `startAllSchedulers` only.
- `apps/api/src/schedulers.ts` (`startAllSchedulers`) + `RUN_SCHEDULERS_IN_PROCESS` branch in `index.ts`; `docs/WORKER-DEPLOYMENT.md`.
- Call sites (all currently run in-process): `routes/transactions.ts` (`score_import`, `score_declined_import`, `rescore_declined`, `rebuild`, `backfill`), `services/efsIngestScheduler.ts` (`efs_ingest`), `services/efsSoapPoller.ts` (`efs_soap_posted`/`rejected`). Backfill already polls `cancel_requested` + checkpoints `samsara_recon_at` (resumable).
- Heavy non-ledger workloads: `services/hazmatExtraction/orchestrate.ts` + `services/hazmatAnalysis.ts` (own `MAX_CONCURRENT` semaphores); `services/scoring/backfill.ts`.
- Per-process rate limiters: `lib/samsaraHttp.ts` (`nextFreeAt` Map), `lib/soapClient.ts`.

**Missing (this plan builds):** a real claim mechanism (SKIP LOCKED RPC), lease/heartbeat columns + reclaim, a worker claim/execute loop + a kind→handler registry, `enqueueJob`, queue-ification of the request/scheduler call sites and the hazmat orchestrators, distributed rate limiting, and multi-replica safety.

---

## §3. Progress ledger

| Phase | Scope | Build | Next action |
|-------|-------|-------|-------------|
| **WQ0** — Queue foundations | `jobs` schema evolution + claim/lease RPCs + worker claim loop + handler registry, behind `JOB_EXECUTION_MODE`, proven on `efs_ingest` | ◐ code + migration 0095 + unit tests landed (api typecheck + 206 tests green) | **apply 0095 + run in queue mode on a live DB to verify claim/lease/concurrency** |
| **WQ1** — Migrate ledger kinds | request + scheduler call sites enqueue; per-kind handlers reconstruct from payload; dedup/progress/cancel preserved | ◐ scoring kinds done (rebuild/backfill/score_import/score_declined_import/rescore_declined via `dispatchJob` + handlers + tests; A2 held — imports are persisted) | **WQ1b: efs_soap_\*, sync_\* (integrations.ts, startJob pattern), nightly_reconcile, manual efs_ingest** |
| **WQ2** — Hazmat → queue kinds | extraction/analysis become `hazmat_extract`/`hazmat_analyze`; semaphores → pool concurrency; per-load dedup | ☐ | after WQ1 |
| **WQ3** — Multi-replica + leases + rate limits | remove boot-sweep; N worker replicas; distributed/pinned Samsara+SOAP limits; scheduler leader lane | ☐ | after WQ2 |
| **WQ4** — Cutover & cleanup | default `queue` mode; remove in-process path; update WORKER-DEPLOYMENT.md; job metrics + Sentry | ☐ | after WQ3 |

---

## §4. Phases

### WQ0 — Queue foundations (CURRENT)

**Goal.** A worker can durably claim and execute a job from Postgres with a lease, and one low-risk kind (`efs_ingest`) runs end-to-end through the queue behind a flag — while every other kind still runs in-process unchanged.

**Deliverables.**
1. **Migration `0095_jobs_queue.sql`** (additive, reversible): add to `jobs` — `payload jsonb not null default '{}'`, `dedup_key text` (nullable; when set, replaces `(org,kind)` as the active-dedup axis), `locked_by text`, `lease_expires_at timestamptz`, `attempts int not null default 0`, `max_attempts int not null default 5`, `run_after timestamptz not null default now()`, `priority int not null default 0`. Add index `(status, run_after, priority)` for the claim scan; keep `idx_jobs_active_one` for `(org,kind)` kinds and add a partial unique on `dedup_key where status in ('queued','running')` for payload-keyed kinds.
2. **Claim/lease RPCs** (`SECURITY DEFINER`, `search_path=''`, service-role execute only): `claim_next_job(p_worker text, p_kinds text[], p_lease_seconds int)` → picks the highest-priority `queued`/lease-expired row for the given kinds via `FOR UPDATE SKIP LOCKED`, stamps `status='running'`, `locked_by`, `lease_expires_at`, `started_at`, `attempts=attempts+1`, returns the row; `renew_lease(p_id uuid, p_worker text, p_lease_seconds int)`; `complete_job(p_id, p_stats)`; `fail_job(p_id, p_error, p_retry bool)` (re-queues with `run_after = now()+backoff` while `attempts < max_attempts`, else `failed`).
3. **Worker claim loop** (`apps/api/src/worker/queueLoop.ts`): poll `claim_next_job` (short interval + jitter), run the handler, renew the lease periodically for long jobs, `complete`/`fail`. Concurrency = a small pool; graceful shutdown drains in-flight + releases leases.
4. **Handler registry** (`apps/api/src/worker/registry.ts`): `Record<JobKind, JobHandler>`; `enqueueJob(admin, kind, {orgId, payload, dedupKey?, requestedBy?, priority?})` inserts `queued` (honoring dedup → `JobConflictError`).
5. Wire `queueLoop` into `worker.ts` (and, when `RUN_SCHEDULERS_IN_PROCESS=true`, optionally into the API for single-service dev). Register the `efs_ingest` handler and, behind `JOB_EXECUTION_MODE=queue`, make its scheduler enqueue instead of `runJob`.
6. The **`QueueDriver` interface** (Q10), **LISTEN/NOTIFY wake + jittered poll** (Q11), and a **queue-depth / oldest-queued-age metric** so assumption A1 is observed from day one.

**Exit criteria.** With `JOB_EXECUTION_MODE=queue`, `efs_ingest` enqueues and a worker executes it; the ledger row shows progress → done; a killed worker mid-job has its lease expire and another worker completes it; `(org,kind)` dedup still 409s a duplicate; ALL other kinds still run in-process (flag off). API/typecheck/tests green; a DB-level concurrency test proves two workers never claim the same row.

**Risks.** SKIP LOCKED RPC correctness; lease tuning (too short → double-run risk on a slow job, mitigated by renew + idempotent handlers); PostgREST can't row-lock, so the claim MUST be the RPC (not a supabase-js update).

### WQ1 — Migrate the ledger job kinds

**Goal.** Every `runJob` call site (requests + schedulers) enqueues; handlers reconstruct from payload; the API runs none of them.

**Deliverables.** A handler per kind (`rebuild`, `backfill`, `score_import`, `score_declined_import`, `rescore_declined`, `efs_ingest`, `efs_soap_*`, the sync kinds) moved out of the route/scheduler closures into `worker/handlers/*`, each taking a serializable `payload`. Persist any large closure-captured input (e.g. imported rows) to a durable row/storage and pass its id. Route handlers return `{ jobId }`/409 from `enqueueJob` exactly as before. Preserve `backfill`'s cancel-poll + `samsara_recon_at` checkpoint (already resumable).

**Exit criteria.** Rebuild/backfill/import buttons behave identically from the UI (same 202/409, same progress + freshness), now executed on the worker; no `runJob` closure remains for these kinds; tests cover each handler from payload.

### WQ2 — Hazmat extraction/analysis → queue kinds

**Goal.** The heaviest workloads leave the API process.

**Deliverables.** `hazmat_extract` / `hazmat_analyze` handlers wrapping the existing `orchestrate.ts` / `hazmatAnalysis.ts` bodies; the `/analyze` route enqueues (dedup_key = load id) and returns the runId as today; the module-level `MAX_CONCURRENT` semaphores are deleted in favor of worker-pool + per-kind concurrency caps; the entitlement/budget/kill-switch checks and the outcome-table + notify wiring are unchanged (they move into the handler intact). The per-org monthly token budget check keeps working (now with the P1-B index).

**Exit criteria.** A submitted BOL enqueues and a worker runs the full extraction → verdict → notify; nothing runs on the API; global extraction concurrency is bounded by worker config, not a module variable; idempotent on redelivery (same runId not double-inserted).

### WQ3 — Multi-replica workers, leases, distributed rate limits

**Goal.** Run 2+ worker replicas safely; the API scales to N; vendor rate limits hold globally.

**Deliverables.** Remove `reclaimInterruptedJobs`' destructive boot-sweep (leases handle recovery); confirm claim correctness under concurrent replicas; replace the per-process Samsara/SOAP limiters (Q7) — pin Samsara/SOAP kinds to a single bounded lane (a worker group with concurrency 1–2 for those kinds) or a DB token-bucket RPC; keep scheduler *ticks* single-owner (a `scheduler_leader` advisory lock or a dedicated single-replica scheduler lane) so a tick fires once across the fleet.

**Exit criteria.** With 2 worker replicas + N API replicas: no job double-executes (concurrency test), a crashed replica's jobs are reclaimed by lease, Samsara traffic for one token stays under the cap, and each scheduled tick fires exactly once.

### WQ4 — Cutover & cleanup

**Goal.** Queue mode is the default; the in-process path is gone.

**Deliverables.** Default `JOB_EXECUTION_MODE=queue`; delete the `void (async…)()` in-process branch of `runJob` (or reduce `runJob` to `enqueueJob`); update `docs/WORKER-DEPLOYMENT.md` (worker is now a multi-replica pool; API sets `JOB_EXECUTION_MODE=queue`); add job metrics (queue depth, oldest-queued age, per-kind failure rate) + Sentry breadcrumbs/spans on handler failures. Retire the now-unused module semaphores + per-process limiters.

**Exit criteria.** No heavy work path remains on the API; a deploy under load shows queue drain on the workers; docs describe the final topology; a returning engineer can scale replicas by config alone.

---

## §5. Preserved invariants (backward compatibility)

Single-active `(org,kind)` dedup → 409; `updateJobProgress` cadence + the UI freshness labels; cooperative cancel + checkpoint-resume; `latestJob`/`lastDoneJob` read model + RLS (`jobs_select`); route response shapes (`{ jobId }` / 409 `already running`). None change. `JobKind` gains `hazmat_extract`/`hazmat_analyze`.

## §6. Rollout & rollback

Per-kind migration behind `JOB_EXECUTION_MODE`; a kind not yet migrated keeps running in-process. Rollback = flip the flag (and, pre-WQ4, the in-process path is intact). Migration `0095` is additive (new nullable columns + indexes), so it deploys ahead of any behavior change and rolls back cleanly. Follows the existing `RUN_SCHEDULERS_IN_PROCESS` rollback model.

## §7. Risks (top items)

| Risk | Mitigation |
|------|------------|
| Double execution of a job across workers | Claim is atomic (`FOR UPDATE SKIP LOCKED` in one RPC); lease renew for long jobs; handlers must be **idempotent** (upsert/checkpoint) — audited per kind in WQ1/WQ2 |
| Lease too short → reclaim a still-running job | Generous default lease + periodic `renew_lease`; idempotency is the backstop |
| Poison job retried forever | `attempts`/`max_attempts` + backoff `run_after`; park as `failed` with error; surfaced in the UI ledger + Sentry |
| Closure-captured input can't be serialized | WQ1 persists large inputs to a durable row/storage, passes an id; each call site audited |
| Samsara/SOAP 429s once sync is multi-worker | Q7 bounded lane / token bucket; verified in WQ3 |
| PostgREST can't `FOR UPDATE SKIP LOCKED` | Claim is a SQL `SECURITY DEFINER` RPC (consistent with existing `admin.rpc` usage), never a supabase-js update |
| Scheduler tick fires on every replica | Single scheduler lane / leader advisory lock (WQ3); today's `RUN_SCHEDULERS_IN_PROCESS` invariant preserved until then |

## §8. Verification bar (every phase)

`pnpm --filter @fuelguard/api typecheck` + `test` green; the boundary + file-size linters clean (new worker modules stay under budget — split handlers per kind); a **concurrency test** (N simulated workers claim from a seeded queue, assert each row runs exactly once); a **lease-expiry** test (killed lease → reclaimed → completed once); **dedup preserved** test (duplicate `(org,kind)` → 409). Migrations follow `docs/MIGRATION-DISCIPLINE.md`.

## §9. Assumptions & open questions (made explicit)

Every assumption is stated so it can be checked rather than trusted; each names how it is validated.

- **A1 — Job volume is low-to-moderate, so Postgres-as-queue is sufficient (Q1).** Validated by shipping queue-depth + oldest-queued-age metrics in WQ0 and watching them; the `QueueDriver` seam (Q10) makes crossing a threshold a driver swap, not a rewrite. *Unquantified today — we do not yet know peak jobs/min; the metric closes that.*
- **A2 — Closure-captured inputs can be persisted and referenced by id.** `score_import` and similar carry uploaded rows in memory today; the plan assumes a durable store (an `imports` row / storage object). Validated per call site in WQ1 **before** that kind moves — if no store exists for a kind, adding one is part of that kind's migration.
- **A3 — Lease duration can exceed the slowest handler's checkpoint interval**, so a live-but-slow job is renewed, not reclaimed. Validated by measuring p99 per-kind step time and setting lease + renew cadence from it; idempotency (Q9) is the backstop.
- **A4 — Every handler can be made idempotent (Q9).** Most already are; a few may need a new natural key. Validated per kind with a "run twice" test; a kind that genuinely cannot be idempotent gets `max_attempts=1` + an alert instead of blind retry.
- **A5 — The Supabase connection pool absorbs N_workers × per-worker concurrency** (each running handler holds connections). Validated by sizing the pool and capping total worker concurrency to it (Q12 caps help); revisit when adding replicas in WQ3.
- **Open — one shared worker pool with per-kind lanes (Q12) vs separate worker services per workload.** Recommendation: one pool + lanes; split only if a workload needs hard isolation (e.g. runaway vision cost). Decided at WQ3 with real numbers.
- **Open — retry/backoff curve + `max_attempts` per kind**, especially for kinds with irreversible side effects. Defaults proposed (5 attempts, exponential backoff); confirmed with ops per kind in WQ1.

## §10. Sources (grounded in)

`docs/ARCHITECTURE-AUDIT-2026-08-01.md` (P0), `docs/WORKER-DEPLOYMENT.md`, `docs/plans/AUTOMATION-BUILD-PLAN.md`; `supabase/migrations/0027_jobs.sql`; `apps/api/src/services/jobs.ts`, `worker.ts`, `schedulers.ts`, `index.ts`; call sites in `routes/transactions.ts`, `services/efsIngestScheduler.ts`, `services/efsSoapPoller.ts`; `services/hazmatExtraction/orchestrate.ts`, `services/hazmatAnalysis.ts`, `services/scoring/backfill.ts`; `lib/samsaraHttp.ts`, `lib/soapClient.ts`.
