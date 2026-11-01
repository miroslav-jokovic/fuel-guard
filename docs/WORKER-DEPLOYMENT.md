# Worker / Scheduler Deployment

The background schedulers (Samsara sync, rebuild-on-boot, weekly digest, nightly reconcile, EFS
auto-ingest, posted-price refresh) used to run inside the single API process. They now live in
`SCHEDULERS` (apps/api/src/schedulers.ts), grouped into lanes, and run in whichever process holds each
lane's lease — see "Lanes and leases" below. `RUN_SCHEDULERS_IN_PROCESS=false` keeps a process out
entirely.

## The default is `true`, and production is NOT a single service

`RUN_SCHEDULERS_IN_PROCESS` defaults to `true`, so a process that is never told otherwise runs the
schedulers. That was written when this repo deployed one web-facing service. It has deployed **two
from the same `railway.json`** — `@fleetguard/api` and `@fleetguard/web` — for longer than anyone
noticed, and because `web` had never been given the variable it inherited the `true` default and ran
the whole scheduler set alongside `api`. Found and corrected 2026-09-05; both services' logs for the
same commit had been printing `[digest] weekly digest scheduler enabled` at once.

So the sentence that used to be here — *"one API instance keeps running the schedulers exactly as
before, nothing to change"* — was load-bearing and wrong. The safe default is only safe when there is
genuinely one process.

**Production ownership is recorded in `docs/DEPLOYMENT.md` §"Exactly one service runs the
schedulers".** `@fleetguard/api` is `true` (it is the WEX-whitelisted host, so the EFS pollers can
only run there); `@fleetguard/web` is `false`. Any new service built from `railway.json` gets
`false` before its first deploy.

Nothing in CI can catch this — a lint gate cannot see a Railway variable — so it is checked by
reading the logs:

```
railway logs --service "<service>" --environment production | grep -i scheduler
```

Exactly one service may print `scheduler enabled`. Every other one must print
`in-process schedulers disabled`.

## Lanes and leases (since 2026-10-20, D-RLY2) — how the API scales past one replica

The old recipe here ("add a worker, set the API to `false`, keep the worker at ONE replica") could not
be followed in production: the EFS pollers can only run on `@fleetguard/api`, the one service whose
static outbound IPs WEX allowlists, and Railway gives a new service new IPs. It is replaced by
`docs/plans/architecture/PLATFORM-RELIABILITY-PLAN.md` §2–§5, in short:

- Every scheduler is registered once, with a lane, in `SCHEDULERS` (`apps/api/src/schedulers.ts`):
  `egress` (the SOAP poller, the card sync and status poll, the mTLS watcher, the EFS re-fetch drain)
  and `general` (everything else). A test fails if a `start*` function is imported and not registered.
- A process competes for the lanes in `SCHEDULER_LANES` (default `all`) and starts a lane only while
  it holds the lane's lease (`platform_scheduler_leases`, 0506; `lib/schedulerLease.ts`). So any number
  of replicas is safe: one holds each lane, the others are standbys. A lost lease exits the process.
- Production target: `@fleetguard/api` ×2 with `SCHEDULER_LANES=egress`; `@fleetguard/worker`
  (`railway.worker.json`, start `node --import tsx apps/api/src/worker.ts`, restart ALWAYS, no static
  IPs) with `WORKER_ROLE=scheduler`, `SCHEDULER_LANES=general`, `EFS_SOAP_ENABLED=false`.
- Check: `curl -s <api host>/api/version | jq .schedulers` — every lane `held`. Logs:
  `[scheduler-lease] <lane>: acquired by …` on exactly one process per lane.

`rebuild-on-boot` (the one scheduler without a job-ledger guard) is safe under this because it is in
a lane: it runs where `general` is held, once per take-over, and it is idempotent.

## The schedulers that call a vendor, and what each one is bounded by

| Scheduler | Cadence | Owning service | Bound |
|---|---|---|---|
| `startEfsSoapPoller` | minutes | `api` (WEX-whitelisted) | EFS's own service account; `EFS_SOAP_ENABLED` |
| `startEfsCardSyncScheduler` | daily | `api` | WEX guide p11: excessive polling can suspend the account |
| `startSamsaraScheduler` | minutes | `api` | Samsara's published rate limit, `samsaraFetch` |
| ↳ its `idle-engine` tier (kind `idle_engine`, IE2) | hourly, + a nightly 2-day recompute chosen inside the run | `api` | `samsaraFetch` + the stats/history 9 req/s cap; ~10 batches × 3 requests an hour, plus one request per long-parked truck; `IDLE_ENGINE_SYNC_MINUTES=0` disables |
| ↳ its `trailers` tier (kind `sync_trailers`, TRAILER-LINK-PLAN Q-TL2, since 2026-10-19) | daily, first tick 20 min after boot | `api` | `samsaraFetch` on the backfill lane: five days of GPS history for the gateway trailers and the trucks, 40 ids a request; shares the manual trailer button's (org, kind) slot; `SAMSARA_TRAILER_PAIRING_SYNC_HOURS=0` disables |
| **`startFleetpalScheduler`** | **hourly** | **`api`** | **nothing published — see below** |
| **`startMedstopScheduler`** | **hourly** | **`api` ONLY** | **100 requests/min per key; a sweep is ~25. ⚠ The key is IP-bound to `api`'s egress (D-MS3) — anywhere else every call is refused** |
| `startSmsOutboxScheduler` | 5 minutes | `api` | Telnyx's account rate limit; at most 50 rows per org per run (`DRAIN_BATCH`) |
| `startFmcsaFeedScheduler` | hourly tick, a run per org the hour FMCSA republishes any of its six datasets (Socrata metadata `rowsUpdatedAt` vs the last run's, IC1d since 2026-10-16) and at the latest 24 h after its last successful one; every tick also checks the org's record is current and alerts the safety managers at most once a day when it is not (`roadside_feed_stale`, IC1c); and, since 2026-10-14, every tick attributes up to 25 inspections that have no reading at the current engine version — who was driving, from Samsara, with the answers frozen in `inspection_evidence_snapshots` and the `inspection-evidence` bucket (IC5, `attribution/pass.ts`); and, since 2026-10-16, the repair record — for each inspected unit with a Part 393/396 violation in the last year, the FleetPal work orders opened from the inspection day to the 396.9(d) due day, written to `inspection_repairs` only when they change (IC11, `repair/pass.ts`) | `api` | Socrata's anonymous per-IP pool (none published); ~30 requests per org per run, measured 2026-10-11, and 6 metadata requests per org per hour for the republish check (IC1d); FMCSA publishes each dataset about once a day, so a few runs a day. Samsara: at most four requests per inspection (GPS, assignments, HOS log, DVIRs) on the BACKFILL lane, so ≤100 an hour and never ahead of the live feeds; the three-year backlog (1,391 on 2026-10-14) clears in about 56 hourly ticks, then ~1.3 inspections a day. An org without a Samsara token is skipped. `FMCSA_FEED_HOURS=0` disables both |

`startSmsOutboxScheduler` (C2d, 2026-09-26) sends texts that were queued for their recipient's civil
hours. A second process running it would not send a row twice — the drain claims each row with a
conditional `queued → sending` UPDATE — but it would double the reads, so the rule above still holds.

⚠ **FleetPal (F8, added 2026-09-21) publishes no rate limit and sends no limiter headers at all.**
94 sequential requests on 2026-09-21 returned not one `X-RateLimit-*` and not one 429, so there is no
measured budget to spend against. Three consequences, all deliberate:

- `FLEETPAL_SYNC_ENABLED` defaults to **false**. The sweep is opted into per environment, which
  makes a second polling process a deliberate act rather than a default. `RUN_SCHEDULERS_IN_PROCESS`
  defaults to *true*, and that default is exactly how `@fleetguard/web` came to run the whole
  scheduler set alongside `api` until 2026-09-05.
- `KIND_CAPS.fleetpal_sync = 1` in `worker.ts`. One sweep at a time, fleet-wide.
- The jobs ledger's `(org_id, kind)` slot refuses an overlapping sweep for one carrier — which also
  means a second polling process would be **invisible**: its dispatches would be refused and the
  only symptom would be a request count nobody is watching.

⚠ **Med-Stop (MEDSTOP-PLAN MS1, added 2026-10-13)** follows FleetPal's three rules —
`MEDSTOP_SYNC_ENABLED` defaults to **false**, `KIND_CAPS.medstop_sync = 1`, and the jobs ledger's
`(org_id, kind)` slot — plus a fourth that FleetPal lacks: it may run only on `api`, because Med-Stop
checks the caller's address against the key's IP filter. Set `MEDSTOP_SYNC_ENABLED=true` on `api`
and nowhere else.

⚠ **Storage backup (`storage-backup`, general lane, added 2026-10-21)** copies every Storage bucket
except `compliance-exports` to the S3 bucket `silvicom360-storage-backup-891568748437` (AWS `us-east-2`,
versioned, Object Lock governance 90 days). Supabase's database backups do not include Storage
objects, so this is the only second copy of every uploaded file. It is **off** unless all four
`STORAGE_BACKUP_*` variables are set, and they are set on **production only** — a staging copy would
mix testers' uploads into the same locked bucket. It needs no fixed IP, so it runs in whichever
process holds the general lane. One ledger job per org (`storage_backup`); `GET /api/version` →
`storageBackup.state` turns `ok` false when a copy is over 36 hours old, and `platform-health.yml`
pages on it. The key is IAM user `silvicom-storage-backup`: list/get/put on that bucket, no delete.

**Chat ledger anchor (`chat-ledger-verify`, general lane, CHA4, 2026-10-23)** rides on the same bucket: after
the nightly chain verify passes, one small object per org (`chat-ledger-anchors/<org>/<day>-<seq>-<hash>.json`)
records the ledger's head, and the next night's verify checks the ledger against it before trusting the
chain. Where the `STORAGE_BACKUP_*` variables are not set (staging) the verify logs "chain self-checked
only" — it never pretends to have anchored.

**Realtime probe (`realtime-probe`, general lane, CHA4, 0515)** joins the private topic
`platform:realtime-probe` with the service role every 15 minutes, has the database broadcast a nonce
(`realtime_probe_send`) and records whether it came back and how fast, in `platform_realtime_health` —
the table the chat trigger also writes a row to for every signal it could not send. `GET /api/version` →
`realtime.state` turns `ok` false on `failing` (the broadcast did not arrive), `stale` (no probe in 45 min)
or `unknown`; `platform-health.yml` pages on it. One websocket from one process; nothing per replica.

**Chat export sweep (`chat-export-sweeper`, general lane, CHA3b, 0517)** removes an office chat export's
three files from `compliance-exports` (`<org>/chat/<export>/`) seven days after it was made and stamps the
`chat_exports` row purged; the row, its hashes and its ledger entry stay. Hourly, first tick four minutes
after boot, the `dq-export-sweeper` shape. A bounded indexed read that returns nothing on almost every run.

**Ads (`ads-orchestrator`, `ads-insights`, `ads-leads-backfill`, `ads-reconcile`; general lane; planned
2026-11-01, D-AD16/D-AD17, `docs/plans/recruitment/ADS-AGENT-BUILD-WORKFLOW.md` A6/B4/B5).** The
`general` lane, not `egress`: `egress` exists for the one host WEX allowlists, and Meta, TikTok, X
and Higgsfield check no caller address, so these follow FleetPal and Med-Stop's placement, not the
EFS poller's. They follow FleetPal's three rules as well: **off** unless `ADS_ENABLED=true` on the
service that holds `general`; one `KIND_CAPS` entry per vendor kind in `worker.ts` (Meta and
Higgsfield at 1); and every job that acts on ONE campaign, creative or generation carries
`dedup_key` = that object's id. ⚠ That last rule is not style: the `jobs` ledger allows one
active job per `(org_id, kind)` when `dedup_key` is null (`0095_jobs_queue.sql:21`), so without it
an org's second campaign would wait silently behind its first. The orchestrator tick only
enqueues; it never calls a vendor itself, so a tick on a standby that loses the lease mid-run
leaves at most a queued job, which the next holder runs once. On a non-production host with no
platform connected, the simulator platform (workflow §4R) stands in. It fails closed: it runs
only where the environment name — `RAILWAY_ENVIRONMENT_NAME ?? DEPLOY_ENVIRONMENT`, the expression
`lib/schedulerLease.ts:234` already reads, moved into one helper rather than restated — is
positively a non-production one, or both are unset and `NODE_ENV` is not `production` (a laptop,
CI). AWS production sets `DEPLOY_ENVIRONMENT=production` (`infra/server/production.env`); an
unknown name is treated as production.

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
