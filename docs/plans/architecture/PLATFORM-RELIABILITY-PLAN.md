# Platform reliability — slow pages, interruptions, and the host underneath (2026-10-20)

Opened 2026-10-20 at the owner's request: *"Railway at this moment has some issues, sometimes is slow and
has interruptions … we want Silvicom 360 to be reliable, especially when we start our mobile app and
drivers and other users become dependent on our services."* The owner then asked for the four
recommendations to be planned, built and shipped properly (§4).

This is a decision log. Decisions are `D-RLY*`, questions for the owner `Q-RLY*`, work items `RLY*`.
The progress log is at the END (append there, never into the tables).

## 1. What was measured (2026-10-20, production)

| Fact | Measured | How |
|---|---|---|
| Hosting today | Railway ≈ $53/mo (both environments, 6 services each); Supabase Pro ≈ $50/mo (Small prod, Micro staging, one unreferenced project `scvjjbgejmkomyciabex`) | `railway usage`; Supabase metrics endpoint (MemTotal 1.92 GB) |
| Load | api ≈ 1.2 GB RAM, 0.03 vCPU avg; web ≈ 0.77 GB; DB 4.55 GB; Storage 219 MB; 16 logins, 272 trucks | `railway metrics`, SQL |
| Errors | 244 min of `[metrics]`: 6,653 requests, **0 5xx, 0 rate-limit refusals**; 0 crashed deploys in 15 days | `railway logs`, `railway deployment list` |
| Where slowness is | `GET /api/livemap/dispatch-board` **median 2.1 s, max 22.7 s, in 193 of 244 minutes**; `GET /api/fueling/fleet-mpg` median 2.6 s, **max 31.7 s**; `GET /api/roadside-inspections/summary` median 2.0 s, **max 37.6 s**; `POST /api/tms/dispatch-movements` median 1.6 s, max 18.8 s; recruitment pipeline 14 s once | `[metrics]` `slowest` per minute |
| Why | Board: ~28 Supabase round trips **one after another** every 60 s per viewer. Fleet MPG: ~23–160 sequential 1,000-row pages of odometer readings. Roadside: ~20 serial reads incl. a 365-day re-read. TMS ingest: one UPDATE per load. Single queries are tens of ms — the time is round trips, not the database | code read, `pg_stat_statements` |
| Shared process | `eventLoopMaxMs` median 279 ms, max 3,311 ms per minute; ~20 schedulers share the ONE `@fleetguard/api` process with every person, the driver app and the McLeod connector; one replica | `[metrics]`, `railway status` |
| The alarm we have | `platform-health.yml` is `*/15` but GitHub ran it at **median 19 min, p90 29, max 41** apart, and it pages on the 2nd failure → an outage is heard **40–80 min** late | `gh run list` gaps over 60 runs |
| Railway's record | **May 19–20 2026: ~8 h total outage** (GCP suspended Railway's account; Railway Metal workloads down too, backups unreachable); Feb 18–21 DDoS series (30 s–48 min windows); Sep 30 5-min global 404s; 13 incidents in the last 30 days (mostly builds/deploys); builds paused on 2026-10-20 itself | Railway incident reports, status history |
| Driver app offline | A real offline spine exists: SQLCipher outbox, backoff, replay on reconnect, client-UUID idempotency, persisted read cache, offline banner. **Two defects** (D-RLY7) | code read |

**The answer to the owner, in one line:** the slowness users feel is ours and fixable on any host; the
interruption risk is Railway's and real; the database (Supabase) is not where either problem lives.

## 2. Decisions

| ID | Decision | Why |
|---|---|---|
| **D-RLY1** | Fix our own slowness and single-process design FIRST; keep Supabase; plan the app tier's exit from Railway as a later, separate step (D-RLY9). | Moving to AWS would move the same 2-second board. A full AWS migration (RDS + Cognito + S3) is ~2× the monthly cost and weeks of risky work; the app tier alone is a much smaller move. |
| **D-RLY2** | **Scheduler lanes + database leases.** Every scheduler is registered once with a lane (`apps/api/src/schedulers.ts` `SCHEDULERS`): `egress` = everything that dials EFS (SOAP poller, card sync + status poll, cert watcher, the EFS re-fetch drain); `general` = everything else. A process runs a lane only while it holds that lane's lease in `platform_scheduler_leases` (0506): 60 s TTL, renewed every 15 s, deadline = send-time + TTL − 10 s; lost or unconfirmed past the deadline → the process exits and restarts as a standby; graceful shutdown releases after the drain. Fails CLOSED if the lease cannot be read. `SCHEDULER_LANES` (default `all`) picks the lanes a process competes for. | The "exactly one process" rule was an env var nothing could see (it failed silently for weeks on 2026-09-05), and it is what kept the API at one replica. WEX IP-gates only card management (docs/22 status 2026-08-11) and Railway's static IPs are **per service, shared by replicas** — so EFS work stays on `@fleetguard/api`, which can now run 2 replicas without polling WEX twice, and everything else moves to a worker service with no new IP for WEX to allowlist. Advisory locks don't survive PostgREST (session = one HTTP request); Redis would be a new vendor. |
| **D-RLY3** | Lane health is public and alarmed: `/api/version` → `schedulers: [{lane, state, secondsSinceRenewal}]` (`held` / `handover` ≤ 120 s after expiry / `stale` / `missing` / `unknown`), folded into `ok`; `platform-health.mjs` pages `schedulers:<lane>:<state>`, ranked above drift. | "The background work stopped" was invisible from outside — the API answered and the feeds went quiet until an office noticed. `handover` keeps a deploy from paging. Lanes are derived from `SCHEDULER_LANES`, so a new lane is monitored the day it exists. |
| **D-RLY4** | Dispatch board: the reads run in two parallel waves, the rows are coalesced per org for 20 s (`createCoalescingCache`, extracted from the live map's C3 cache so both share one implementation), the reader-specific warnings inputs per org-day for 60 s. `generatedAt` is the BUILD instant. | 28 serial round trips → 2 waves; an office of dispatchers pays for one composition. 20 s is a third of the 60 s poll and under the cadence of what the board shows; ages are computed at build time, so a cached row is never wrong about its own age. |
| **D-RLY5** | `GET /api/version/ready` returns the same verdict as an HTTP status (200 / 503) for an external monitor. External monitoring is a vendor (Q-RLY1), not another GitHub cron. | `/healthz` must stay 200 (Railway's healthcheck — a 503 would roll back a deploy waiting on its migration). GitHub cron cannot be a pager (measured above). |
| **D-RLY6** | Fleet MPG asks `odometer_readings_for_periods` (0507) for only the readings its rule uses — per bound and per (truck, counter), the last reading in `[floor, bound]` — plus each period's true count over `(floor, to]`. The paged read stays as a labelled fallback for staging's deploy window only. | The rule reads two rows per truck per counter per period; the paged read fetched up to ~160k rows to find them. The set returned is a subset that contains every pick, so every answer is unchanged (matrix: 205 picks against brute force; vitest: function read ≡ paged read on an irregular fleet). The count is open at the floor because that is what the reader's text comparison has always done. |
| **D-RLY7** | Driver app: (a) `enqueue` wakes the sync engine (`outboxSignal.ts`); (b) end-of-shift names its shift (`session_id`, optional), and the server ends that one shift — the driver's own, still open — or nothing. | (a) A load accepted, a shift started or a message sent WHILE ONLINE waited for the next app switch or lost signal; the pending badge said nothing was waiting. (b) An end-of-day held in the queue (or retried by hand) past the start of the next shift closed the NEW shift. Old builds keep the old behaviour. |
| **D-RLY8** | `@fleetguard/api` runs **2 replicas** once D-RLY2 is live in production and the worker service holds `general`. | One replica = every deploy and every crash drops every user and the driver app. Known consequence, accepted: express-rate-limit's memory store is per replica, so each limit becomes ~2× per client across the fleet (password reset 30 → ≤60 per 15 min; still bounded). A shared store is RLY12 if that ever matters. |
| **D-RLY9** | The app tier leaves Railway only after D-RLY1–8 are live and measured, to AWS (ECS Fargate in us-west-2, one NAT gateway with ONE Elastic IP for WEX), keeping Supabase. Estimated $100–150/mo. **Lead item: WEX must allowlist the new IP** — ask before any build. | Railway's May outage took every workload down for ~8 h and its control plane is coupled (one failure cascades). Supabase is unaffected by Railway outages and is not part of this move. |
| **D-RLY10** | Roadside summary: the reads that need nothing from each other start together (the report read with the first wave; certifications with the roster; the FMCSA feed with the statistics), each table's hundred-id chunks run three at a time (`lib/mapPool.ts`, moved out of `hereGeocode.ts`), and the inbox reads repairs for **its window's inspections only** (`readRepairsDue(…, { only })`). **No cache.** | The time was round trips (§1). A cache keyed on the latest FMCSA fetch would be wrong after every person's decision on the page — an attribution, a repair, a filed paper, a certification all move the card's Next step — so it would need invalidation from every writer in `inspections`, a second source of truth with a delay fuse. Parallel reads give the same answer as before by construction. |
| **D-RLY12** | McLeod sync: the relink pass (LOADS-ACTIVITY-PLAN D-LA3) leaves `POST /api/tms/dispatch-movements` and runs as `mcleod-relink` in the `general` lane every 10 min, over every company the org's raw rows hold (`mcleod/relinkScheduler.ts`). **No set-based UPDATE RPC, no migration.** | Measured 2026-10-21: the agent posts ~1.1 movements per call (2,143 load UPDATEs over ~1,930 calls, `pg_stat_statements`), so a set-based UPDATE would save nothing. Each call instead re-read 60 days of codes (1,025 movements), the roster and those loads' links in 200-id chunks one after another — and relinked nothing almost every time. A stale link appears when the roster changes, not when a movement arrives. Cost: a newly matched driver's closed loads are relinked within 10 min instead of on the next sync. |
| **D-RLY13** | The app tier stays on Railway for now; RLY13 (AWS) is deferred and WEX is not asked for a new address until a move is decided (owner, 2026-10-21, answering Q-RLY2). | Railway's outages this week stopped builds and deploys, never the running app; D-RLY1–8 make the Railway setup reliable and carry over unchanged if a move comes. WEX can add an address later, beside the approved Railway ones. |
| **D-RLY11** | **RLY10 dropped.** The compliance overview is not cached beyond the board's existing 60 s credentials cache (D-RLY4). | It was never in §1's slow list. The page shows evidence a person has just filed; a shared cache would show the page without it. Re-open only with a measurement. |

## 3. Topology

Before (until this plan): `@fleetguard/api` ×1 — every person, the driver app, McLeod, ~20 schedulers,
EFS. `@fleetguard/web` ×1 — the SPA host (also a full API, schedulers off).

After (D-RLY2/D-RLY8):

| Service | Replicas | Runs | Env |
|---|---|---|---|
| `@fleetguard/api` (static IPs, WEX-allowlisted) | 2 | HTTP for everyone + lane `egress` (one replica holds it, the other is standby) | `RUN_SCHEDULERS_IN_PROCESS=true`, `SCHEDULER_LANES=egress` |
| `@fleetguard/worker` (new, `railway.worker.json`) | 1 (2 = hot standby, optional) | lane `general` | `WORKER_ROLE=scheduler`, `SCHEDULER_LANES=general`, `EFS_SOAP_ENABLED=false`, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=45`, same Supabase/Samsara/mail/SMS/FleetPal/Med-Stop/HERE variables as api |
| `@fleetguard/web` | 1 | SPA | unchanged (`RUN_SCHEDULERS_IN_PROCESS=false`) |

Staging (`uat`) has the same shape, but its schedulers have always run on `@fleetguard/web`
(DEPLOYMENT.md); there the worker takes `general`, and `@fleetguard/web` keeps `egress`, which does
nothing on staging because EFS is off there.

## 4. Work queue

| # | Item | Status |
|---|---|---|
| RLY1 | Migrations 0506 (leases) + 0507 (odometer function) + matrices | **LIVE** v2026.10.21 (#1678) |
| RLY2 | Lanes, leases, worker entry (Sentry, lease release on exit), lane-aware drain, lane health in `/api/version` + `/ready`, platform-health lanes | **LIVE** v2026.10.21 (#1682) |
| RLY3 | Dispatch board: parallel + coalesced (D-RLY4) | **LIVE** v2026.10.21 (#1682) |
| RLY4 | Fleet MPG via 0507 (D-RLY6); the labelled paged fallback removed | **LIVE** v2026.10.21 (#1682); fallback removal merged (#1686), waits release |
| RLY5 | Driver: enqueue wakes sync; shift end by id (D-RLY7) | merged (#1682); reaches phones via OTA |
| RLY6 | Staging: create `@fleetguard/worker` in `uat`, set lanes, verify both lanes `held` and the hand-over on a redeploy | **waits**: staging still serves 14fb7c8 — the merges during Railway's build pause were dropped; uat api + web need a deploy from source first |
| RLY7 | Production: create the worker service, set lanes, then scale api to 2 (runbook §5) | release done (v2026.10.21, both lanes `held` by api); **waits on RLY6** |
| RLY8 | External uptime monitor on `/api/version/ready` with SMS + phone call | **Q-RLY1** (owner creates the account) |
| RLY9 | Roadside summary: parallel waves, window's repairs only, no cache (D-RLY10) | merged (#1686), waits release |
| RLY10 | Compliance overview cache | **dropped** (D-RLY11) |
| RLY11 | McLeod sync: relink out of the request (D-RLY12); the planned set-based UPDATE dropped on measurement | merged (#1686), waits release |
| RLY12 | Shared rate-limit store, only if per-replica limits prove too loose | not planned |
| RLY13 | App tier to AWS (D-RLY9) | **Deferred** (D-RLY13); WEX is asked only when a move is decided |

## 5. Runbooks

### Create the worker service (staging first, production after the release)

1. `railway add --service "@fleetguard/worker"` in the `serene-elegance` project, connected to the repo;
   set its config file to `railway.worker.json` (service Settings → Config as code) and its deployment
   trigger to `main` (uat) / `production` (production), as the other services' triggers are.
2. Variables: copy `@fleetguard/api`'s (same environment), then set `WORKER_ROLE=scheduler`,
   `SCHEDULER_LANES=general`, `RUN_SCHEDULERS_IN_PROCESS=true`, `EFS_SOAP_ENABLED=false`,
   `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=45`. Do NOT enable static IPs on it.
3. On the service that keeps `egress` (production `@fleetguard/api`; staging `@fleetguard/web`) set
   `SCHEDULER_LANES=egress`. Until then that service still competes for `general` — harmless (the lease
   picks one), but the point is to keep `general` off the HTTP process.
4. Verify: `curl -s <host>/api/version | jq .schedulers` → both lanes `held`; worker log prints
   `[scheduler-lease] general: acquired`; api log prints `lane egress started`. Redeploy the worker and
   watch `general` go `handover` → `held` within ~15 s.
5. Production only, after 4: `railway scale --service "@fleetguard/api" --environment production us-west2=2`.
   Verify `/api/version` from a few requests shows two `deploymentId`/`startedAt` values over time,
   `egress` stays `held`, and `[metrics]` lines come from two processes.

### Roll back

- Scale api back to 1; set `SCHEDULER_LANES=all` on api; delete the worker service. The api takes both
  lanes within one TTL. No data change.
- Code rollback (`release.yml mode=rollback`) to a build before RLY2: the old code ignores the lease
  table entirely; ONLY then must api go back to 1 replica first, because old code has no lease.

## 6. Open questions

- **Q-RLY1 — which external monitor, and whose phone.** Candidates: (a) **Better Stack Responder,
  $29/mo billed annually** — 30 s checks from several regions, an incident only when ≥3 locations agree,
  unlimited SMS **and phone calls**, status page; (b) UptimeRobot Solo ~$7–10/mo + prepaid SMS credits,
  60 s checks, no phone calls; (c) keep only the GitHub cron (40–80 min). **Recommendation: (a)**, with
  one HTTP monitor on `https://fleetguardapi-production.up.railway.app/api/version/ready` (expect 200),
  one on the web host's `/`, alerting the owner by call + SMS. The owner creates the account (I cannot);
  the endpoint is ready.
- **Q-RLY2 — ask WEX now about a new outbound IP for the AWS move?** **ANSWERED 2026-10-21: no, not
  now.** The owner ruled the app tier stays on Railway for now (D-RLY13), so nothing changes with WEX;
  an address is added when a move is actually decided. The ask, when it comes, stays "one more address
  beside the Railway ones", so both work through a cut-over.
- **Q-RLY3 — point-in-time recovery.** Still off (RELEASE-TRAIN-PLAN Q-REL7): a bad release can only be
  restored to that morning's backup (~21 h of writes). ~$100/mo on Supabase. Recommendation: turn it on
  before the driver app is relied on.
- **Q-RLY4 — the unreferenced Supabase project `scvjjbgejmkomyciabex` ("Fleetup's Project").** Nothing
  in the repo names it; on Pro it is likely ~$10/mo. Owner to confirm and delete.

## 7. Progress log

- **2026-10-20** — Plan opened from the measurements in §1. RLY1 opened as #1678 (0506 + 0507, two
  matrices, mutations killed: always-take-over → 4 failures; first-not-last pick → pick check fails;
  count without floor / closed floor → count check fails). RLY2–RLY5 built on
  `claude/reliability-program`.
- **2026-10-20** — #1678 renumbered 0504/0505 → 0506/0507 (a parallel chat took both numbers mid-CI;
  the PR showed `dirty` and no checks ran) and merged; #1682 merged (main 3ae7c8d). Railway paused all
  builds from 17:03Z, so staging stayed on 14fb7c8.
- **2026-10-21** — Release v2026.10.21 put #1678 + #1682 in production at 06:36Z: `/api/version/ready`
  200, lanes `egress` and `general` both `held` by api, schema 0507 current. 0507 measured in
  production: mean 191 ms, max 586 ms (`pg_stat_statements`). Staging still on 14fb7c8 (Railway status
  still "Builds are temporarily paused"; the dropped merges need a deploy from source — `railway
  redeploy --from-source` on uat api + web — before RLY6). Wave 2 on `claude/reliability-wave-2`: RLY9
  (D-RLY10), RLY4's fallback removed (the equivalence test now compares the function read with the rule
  over every reading), RLY10 dropped (D-RLY11). Mutations killed: whole-year repair read → the window
  test fails; per-period count from the picks → 4 failures; narrowing removed → the own-lookback test
  fails. First 44 production minutes after the release: `POST /api/tms/dispatch-movements` is now the
  slowest route (slow in 21 of 44 minutes, median 1.6 s, max 6.0 s) — RLY11 next. Then RLY11 (D-RLY12): measured ~1.1 movements per sync call, so the set-based UPDATE was dropped
  and the relink pass moved to the `mcleod-relink` scheduler. Mutations killed: integrations read without
  the token filter → the visit test fails; a failing org stopping the pass → the carry-on test fails.
- **2026-10-21** — Owner ruled on Q-RLY2: no AWS move for now and no change with WEX (D-RLY13); RLY13
  deferred. Railway builds still paused, so staging and RLY6 still wait.
- **2026-10-21** — Wave 2 merged as #1686 (main `465a0df`, 14:08Z): RLY4's paged fallback removed,
  RLY9, RLY11. It landed after v2026.10.21 (06:36Z), so none of it is in production yet — it ships
  with the next release, and Railway being down holds that release and staging alike. Nothing in
  the queue is left to write: RLY6 → RLY7 wait on Railway (uat redeploy from source first), RLY8 on
  Q-RLY1, and Q-RLY3 / Q-RLY4 on the owner.
- **2026-10-21 (evening)** — D-RLY13 superseded: after Railway's security disclosure the owner decided the move
  (Supabase + one EC2 server per environment, not D-RLY9's ECS shape). RLY13 continues as
  `AWS-MIGRATION-PLAN.md`; WEX is asked once the production Elastic IP exists (AWS3).
