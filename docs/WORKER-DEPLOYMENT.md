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

**Ads (`ads-orchestrator`, `ads-insights`, `ads-leads-backfill`, `ads-reconcile`, `ads-outcome-feed`; general lane; planned
2026-11-01, D-AD16/D-AD17, `docs/plans/recruitment/ADS-AGENT-BUILD-WORKFLOW.md` A6/B4/B5).**
`ads-orchestrator` is BUILT (A6, 2026-11-02; `modules/ads/orchestrator/tick.ts`): every minute,
first tick 90 s after boot, one `ads_step` job (`KIND_CAPS` 2 — a step makes at most one platform
call) per campaign the agent has work in, `dedup_key` = `ads_step:<campaign>:<state>`. With
`ADS_ENABLED` unset or `false` it still ticks, under the **brake** (`orchestrator/brake.ts`, 2026-11-03
audit): every org is read as killed and only the pause path runs, so turning the flag off in an
emergency stops the agent without stopping our pauses. On a host with nothing delivering that is one
empty read a minute. An org whose settings row cannot be parsed is read as killed too. Since B3a (2026-11-02) its `platform` worker is real, so switched on it queues
the launching and pausing steps, and a pause reaches Meta. `createPaused` and `compose` are still
empty (B2c, C), so no campaign reaches `paused`, and so none reaches launch, unattended. One non-scheduler
kind sits beside it: **`ads_rules_sync`** (B3b, `KIND_CAPS` 1). It is queued by the settings save door,
not by a timer, and rewrites the account's Meta Automated Rules. **`ads-leads-backfill`** is BUILT (B4a2, 2026-11-03;
`modules/ads/leads/backfillTick.ts`): hourly, first tick 5 min after boot, one **`ads_leads_backfill`** job
(`KIND_CAPS` 1) per `connected` or `failing` Meta or simulator connection (`failing` since the 2026-11-03
audit: skipped, a dead token's lost leads were silent), `dedup_key` = `ads_leads_backfill:<connection>`. Each run reads
the last 48 h, or further back to an hour before that connection's last `done` run (the jobs ledger), so an
outage closes itself once the connection works again.
The job reads every form of ours for the last 48 h with the Page token and hands each lead to recruiting's
`LeadSink` (`queue/handlers/adsLeadsBackfill.ts`, the one place the two modules meet); it fails, and is
listed, when any form or lead was not brought in. A second non-scheduler kind, **`ads_lead_fetch`** (B4b,
2026-11-03, `KIND_CAPS` 1), is queued by Meta's leadgen webhook (`POST /api/webhooks/meta`): one row per lead,
`dedup_key` = `ads_lead_fetch:<org>:<leadgen_id>`, read by id with the Page token and handed to the same sink.
It is born as a ROW, never through `dispatchJob` (which runs inline in `inprocess` mode — a Graph read inside
Meta's request). In `inprocess` mode the receiving process runs the rows it queued right after answering
(`drainKindNow`), and the general-lane drain (`inprocessDrain.ts`) claims any left over, including retries;
in `queue` mode the consumer does. It is NOT gated on `ADS_ENABLED`: the gate is `META_APP_SECRET` (absent =
every delivery 503, said at boot), because a lead from a live form is the carrier's whether or not the
orchestrator is on. **`ads-insights`** is BUILT (B5a, 2026-11-03; `modules/ads/monitor/insightsTick.ts`): hourly, first tick
7 min after boot (after the backfill's 5), one **`ads_insights`** job (`KIND_CAPS` 1) per `connected` or `failing` Meta or
simulator connection — the backfill's own connection read (`metaConnectionsTick`) — `dedup_key` = `ads_insights:<connection>`.
Each run re-reads the last three LOCAL days of every campaign of ours at hourly grain, in the zone Meta reports for the
account at that run, and writes Meta's current answer to `ads_spend_hourly` (its one writer): late hours fill in, revisions
down replace, an hour Meta stops reporting becomes zero, a failed read touches nothing. A payload `days` (≤ 28) widens one
run. After the pull the same job runs the auto-pause checks (B5b, `monitor/checks.ts`): a breach is the agent's
`pause` through the campaign machine, which the orchestrator's next tick carries to Meta. **`ads-reconcile`** is BUILT
(B5c, 2026-11-03; `modules/ads/monitor/reconcileTick.ts`): daily (an interval from boot, first tick 15 min after), one
**`ads_reconcile`** job (`KIND_CAPS` 1) per connection, `dedup_key` = `ads_reconcile:<connection>`. Each run re-reads 28
days of insights, then compares Meta's campaigns and ad sets with our rows and records each mismatch once as an
`ads_actions` `external_change` row + bell (the ledger's unique idempotency key is the "once"); it writes nothing to
Meta and changes no row of ours. **`ads-outcome-feed`** is BUILT (B6, 2026-11-06; `modules/ads/outcomes/outcomeTick.ts`): daily from boot (first tick 20 min after), one **`ads_outcome_feed`** job (`KIND_CAPS` 1) per `connected` or `failing` Meta or simulator connection whose carrier has turned the feed on with a dataset in the settings version in force (Q-AD40; a simulator connection only where `simulatorGate` allows), `dedup_key` = `ads_outcome_feed:<connection>`. The run sends each recorded lead stage to the carrier's Conversions API dataset and writes `ads_outcome_events` (its one writer). Every version saved before the setting existed reads as off. Off unless `ADS_ENABLED`; runs where the other ads schedulers run (`api`). **`ads-daily-brief`** is BUILT (F1b, 2026-11-05;
`modules/ads/workers/analyst/briefTick.ts`): hourly from 07:00 Central (first tick 9 min after boot), one
**`ads_daily_brief`** job (`KIND_CAPS` 1) per carrier with a `connected` or `failing` Meta or simulator connection —
the same connection read — `dedup_key` = `ads_daily_brief:<org>`. Each run stops at once for a day whose `ads_brief`
bell was already sent (the notification ledger), else reads yesterday's hours from `ads_spend_hourly`, asks the
analyst (one Claude call, retried once under a new key if its numbers are refused) and rings `ads_brief` with the
checked narration or, failing that, the plain figures. Every hour from 07:00, not once at 07:00, so a deploy in that
hour delays the brief rather than losing it. It writes nothing but the analyst's `ad_generations` rows and the bell. The
**Uncontacted leads (`lead-uncontacted`, general lane, D2c)** (`modules/recruiting/leads/leadUncontacted.ts`): every 5 min, first
tick 6 min after boot, one **`lead_uncontacted`** job (`KIND_CAPS` 1) per carrier with a `new` lead, `dedup_key` =
`lead_uncontacted:<org>`. The job rings each platform lead still `new` past `alerts.uncontacted_lead_minutes`, once per lead.
It talks to no vendor. Off unless `ADS_ENABLED`, like the ads schedulers. Any hour (owner, 2026-11-04): only each person's own
quiet hours and mutes hold a ring back.

`general` lane, not `egress`: `egress` exists for the one host WEX allowlists, and Meta, TikTok, X
and Higgsfield check no caller address, so these follow FleetPal and Med-Stop's placement, not the
EFS poller's. They follow FleetPal's three rules as well: **off** unless `ADS_ENABLED=true` on the
service that holds `general` (the orchestrator's pause path is the one exception, above); one `KIND_CAPS` entry per vendor kind in `worker.ts` (Meta and
Higgsfield at 1); and every job that acts on ONE campaign, creative or generation carries
`dedup_key` = that object's id. ⚠ That last rule is not style: the `jobs` ledger allows one
active job per `(org_id, kind)` when `dedup_key` is null (`0095_jobs_queue.sql:21`), so without it
an org's second campaign would wait silently behind its first. The orchestrator tick only
enqueues; it never calls a vendor itself, so a tick on a standby that loses the lease mid-run
leaves at most a queued job, which the next holder runs once. On a non-production host with no
platform connected, the simulator platform (workflow §4R) stands in. It fails closed: it runs
only where the environment name — `RAILWAY_ENVIRONMENT_NAME ?? DEPLOY_ENVIRONMENT`, the expression
now `lib/deployEnvironment.ts` (step 7a, 2026-11-02; the scheduler lease reads it too) — is
positively a non-production one, or both are unset and `NODE_ENV` is not `production` (a laptop,
CI). AWS production sets `DEPLOY_ENVIRONMENT=production` (`infra/server/production.env`); an
unknown name is treated as production.

**`ads_render`** (C3, 2026-11-04; `modules/ads/creative/higgsfield/render.ts`) is a job kind with NO scheduler: one
Higgsfield render moved one step (`KIND_CAPS` 1 — renders spend the carrier's prepaid credits, and one at a time
keeps the month exact). Enqueued by the compose step (C5b2, `orchestrator/workers.ts` `queuedRender`) as a queue row, never
`dispatchJob` (in-process mode would render inside the step), `dedup_key` = `ads_render:<creative>:<attempt>`. Compose itself
never calls Higgsfield: `ads_step` runs two at a time, and two renders at once could both pass the month's credit gate.
"Not finished" throws, so the queue's retry backoff IS the poll; when its attempts run out the ledger row stays
`started` and the next job resumes it free (same Idempotency-Key). No webhook receiver: polling recovers every case.

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
