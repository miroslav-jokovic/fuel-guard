# McLeod collector — change detection, cadence, and the live/sandbox split

**Status: READY TO EXECUTE.** Written 2026-09-10 from the owner's proposed four-stage architecture,
after measuring it against the live `lme` instance. Decision IDs are `D-MCC*`.

**The owner's design was right, and it is now backed by measurement rather than by hope.** The
proposal was:

```
1. CHANGE DETECTOR      SQL Change Tracking
        ↓
2. MCLEOD COLLECTOR     pull only required records
        ↓
3. COLLECTOR DATABASE   normalized copy / operational state
        ↓
4. CUSTOM HARNESS       rules, events, automation, AI
```

Every stage survives contact with the real database. **Change Tracking is already enabled on `lme`**
— on 91 tables, including every one this needs — so stage 1 is a permission grant rather than a
build. Stages 2 and 4 already exist in the shape D-ARC1 describes. Stage 3 is the one place the plan
diverges from the sketch, and §2 D-MCC4 says why: we already have that layer, and adding a database
would add a deployment target without adding a capability.

The concern behind the design — *do not overload a self-hosted server* — is correct to hold and
turns out not to be the binding constraint. §3.4 measures a full poll cycle at **4 ms of CPU and a
33 MB working set**, which is **0.012%** of the server's daily batch volume. The two things that
actually matter are lock contention (D-MCC6) and **connection churn, which costs 25× more than the
query it carries** (D-MCC10).

This plan governs **all** McLeod ingestion. `docs/plans/livemap/LIVE-MAP-PLAN.md` is its first
consumer and defers to it on everything below.

---

## 1. The architecture, with the measurements attached

```
   ┌─ McLeod SQL Server (APPNEW, 10.0.1.171) ── 42 cores · 62 GB · ~138 batch req/s baseline ─┐
   │                                                                                          │
   │   lme  ── PRODUCTION, continuously written, restored once (2022-11-28)                   │
   │     └─ Change Tracking ON · 91 tables · 10-day retention                                 │
   │        current version 27,262,450 · min valid 24,922,470 (2.3 M versions retained)       │
   │                                                                                          │
   │   lme_analytics ── a FULL RESTORE of lme, frozen at the restore instant                  │
   │        restored 2026-08-21 09:46 and 2026-09-10 11:36 — twice, ever                      │
   └──────────────────────────────────────────────────────────────────────────────────────────┘
              │ CHANGETABLE(CHANGES tbl, @last_version)  ← reads CT side tables, not the base table
              │ then a keyed re-read of only the changed ids
              ▼
   ┌─ on-prem agent (tools/mcleod-agent) ── the ONLY thing that touches McLeod ────────────────┐
   │   watermark = CT version per (table, company), in state.json                             │
   └──────────────────────────────────────────────────────────────────────────────────────────┘
              │ HTTPS push, ingest-token authenticated
              ▼
   ┌─ Silvicom 360 (Railway + Supabase) ───────────────────────────────────────────────────────┐
   │   staging (collector-owned)     tms_movements · mcleod_* · load_external_payloads          │
   │   core                          loads · load_stops · drivers · vehicles · trailers         │
   │   harness                       livemap · finance · roster · dispatch                      │
   └──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Decisions

- **D-MCC1 — change detection is SQL Server Change Tracking, and it is already there.**
  `lme` has CT enabled with **10-day retention and auto-cleanup on**, across **91 tables** —
  including `movement`, `movement_order`, `orders`, `stop`, `driver`, `tractor`, `trailer`,
  `equipment_item`, `location`, `customer`, `company`, and the entire finance set (`gl_ledger`,
  `gl_ledger_hist`, `gl_account`, `drs_settle_hist`, `drs_deduct_hist`, `billing_history`,
  `journal_ap|cash|driver|office|sales|vm`, `fuel_detail`, `fuel_detail_hist`, `settlement`,
  `open_item`, `vendor`, `payee`). Current version **27,262,450** against a min-valid of
  **24,922,470** — 2.3 million versions of real retained history, so the mechanism is not merely
  switched on, it is working.

  **The only thing missing is a permission.** `SELECT ... FROM CHANGETABLE(CHANGES lme.dbo.movement, @v)`
  today returns *"The VIEW CHANGE TRACKING permission was denied on the object 'movement'"*. That is
  a `GRANT`, not a build, and it is MC0.

  CDC (`is_cdc_enabled`) is **false** on both databases and stays false: CDC captures full row
  history into log-reader-fed tables and is materially heavier. CT gives what a collector needs —
  *which rows changed since version N* — and nothing it does not.

- **D-MCC2 — production reads go to `lme`. `lme_analytics` is the rehearsal target, not a
  production source.** This refines the owner's split, and the measurement is the reason.
  `lme_analytics` is not a replica and not a refreshing feed: it is a **full backup of `lme`
  restored on demand**, and `msdb.dbo.restorehistory` records exactly **two restores, ever** —
  2026-08-21 09:46 and 2026-09-10 11:36 (54.9 GB, ~6 min to back up, ~7 min to restore). Between
  restores it is **frozen**. It looked near-live during this research only because it had been
  restored three hours earlier that morning.

  A finance figure read from it is therefore correct *as of the restore instant* and silently wrong
  afterwards — by three hours on the day of a refresh and by three weeks before the next one. That
  compounds a trap this repo has already paid for (`mcleod-sweep-lands-mid-month`: "has rows" is not
  "has the month"). The safety the sandbox was created to provide is real, and it is delivered by
  **read-only credentials plus rehearsal**, not by pointing production reads at a stale copy.

  So: **every collector reads `lme` in production; every collector is developed and rehearsed
  against `lme_analytics` first.** If a future reader wants a figure from the sandbox anyway, the
  rule is that it must carry its restore timestamp — MC4 builds that check once so nobody has to
  remember it.

  **This is not hypothetical — it is already costing data, and here is the measurement.** On
  2026-09-10 the finance sweep ran at 13:01 CDT, 85 minutes after the sandbox was restored at 11:36:

  | September 2026 billing rows | |
  |---|---|
  | our `mcleod_billing` staging | **504** |
  | `lme_analytics` (sandbox) | **504** |
  | `lme` (production) | **524** |

  Production staging is **20 rows — 3.8% — short of September billing**, and the gap widens every
  hour until the next restore. The failure mode is quiet by construction: the sweep re-runs a 75-day
  window idempotently, so running it again *without* a restore rewrites the same stale figures and
  looks exactly like a successful refresh. MC5 is the step that closes it.

- **D-MCC3 — the two untracked tables are handled by bounded re-read, not by an ALTER on
  production.** `continuity` (the movement↔driver/tractor/trailer link), `users`, `mc_position` and
  `callin` are **not** change-tracked. `continuity` is the one that matters: re-assigning a truck to
  a load changes it, and a CT poll of `movement` alone would miss that.

  The fix is not to ask IT to `ALTER TABLE lme.dbo.continuity ENABLE CHANGE_TRACKING` — that is a
  write to a vendor-supported production system, for a benefit we can get for free. **The active
  working set is 420 continuity rows** (measured), the clustered PK is
  `(company_id, movement_id, equipment_type_id, equipment_id)` so every lookup is a clustered seek,
  and re-reading all 420 takes **0.19 s including TLS connect**. Re-read them each cycle for the
  movements CT already told us are active. `users` changes a few times a year and is re-read whole
  (208 rows) on the roster cadence.

- **D-MCC4 — there is no new "collector database", because we already have that layer.**
  Stage 3 of the sketch exists twice over: the **staging tables** the collector owns
  (`tms_movements`, `mcleod_settlements`, `mcleod_ap_vouchers`, `mcleod_billing`,
  `load_external_payloads`, `mcleod_gl_*`) and the **normalized core** they feed (`loads`,
  `load_stops`, `drivers`, `vehicles`, `trailers`). That is precisely D-ARC1's collectors → core
  shape, and it is already gate-enforced by `lint:table-modules` and `lint:table-producers`.

  A third database between the agent and Supabase would add a deployment target, a backup story, a
  schema to migrate and a second place for the truth to live — in exchange for nothing the staging
  tables do not already do. The **only** local state the agent needs is its watermark, and that is a
  few integers in `state.json`, where the roster hash-state already lives.

- **D-MCC5 — the watermark is a CT version, never a `MAX(date)`.** One `SYS_CHANGE_VERSION` per
  `(table, company_id)`, advanced only after the rows it covers are successfully pushed and
  acknowledged. This is not a style preference: `MAX(stop.actual_departure)` on this database is
  **2215-03-12**, because McLeod writes far-future sentinels for unset values, so a date watermark
  advances past every real row and then returns nothing forever. A CT version cannot do that.
  Advance-after-ack means a failed push re-delivers rather than silently skipping.

- **D-MCC6 — the risk is lock contention, not request volume, and the design answers it.**
  `lme` has **`READ_COMMITTED_SNAPSHOT` OFF** and snapshot isolation `OFF`. A long-running read
  therefore takes shared locks and **can block McLeod's own writers** — which is the real form of
  "overloading the server", and it is not measured in requests per second.

  Three mitigations, in order of importance. **(1)** `CHANGETABLE` reads CT's internal side tables,
  not the base table, so change *detection* contends with nothing. **(2)** The keyed re-read that
  follows touches only the changed ids through a clustered seek — measured at **4 ms of CPU** for the
  whole board (§3.4). **(3)** Every collector query carries an explicit statement timeout, an
  explicit `LOCK_TIMEOUT` and `READ COMMITTED`; **`NOLOCK` is not used**, because a dirty read that
  reaches a financial figure is a worse outcome than a query that waits, and at 4 ms these queries
  are far too short to need it.

  **The query is not the cost — §3.4 measures the whole cycle at 4 ms of CPU and a 33 MB working
  set.** What that changes is where the attention goes: to D-MCC10, connection handling, which costs
  25× more than the query it carries.

  Buffer-pool safety falls out of the same measurement and is worth stating plainly, because
  eviction is how a read-only query hurts an OLTP server. The cycle touches **~4,144 pages — about
  33 MB — and it is the *same* 33 MB every time**. Polling keeps that set hot rather than displacing
  anything McLeod needs, against 62 GB of RAM and a 54.9 GB database.

- **D-MCC7 — the on-prem agent stays the only thing that touches McLeod.** Railway has no route to
  `10.0.1.171` and never gets one. The agent reads over the LAN and pushes over HTTPS with an ingest
  token. This is already true and is restated because a live map creates the temptation to open a
  tunnel; the answer is no.

- **D-MCC8 — cadence is per feed and stated, not global; dispatch is 60 s, FLAT.**

  | Feed | Tables | Cadence | Why |
  |---|---|---|---|
  | dispatch | `movement`, `movement_order`, `orders`, `stop`, `trailer` + `continuity` re-read | **60 s flat** | see below |
  | roster | `driver`, `tractor`, `trailer`, `users` | **daily** | changes a few times a month |
  | finance | `gl_ledger*`, `drs_*`, `billing_history`, `journal_*`, `voucher*` | **existing 75-day window sweep** (MC5) | monthly close; D-FIN4's manual-entry lag |
  | reference | `location`, `customer`, `commodity`, `city`, `gl_account` | **weekly** | slow-moving lookups |

  **Why 60 seconds, from the arrival rate rather than from taste.** 28 days of stop arrivals by
  hour (Central) put **85% of all activity in 07:00–16:00**, peaking at 08:00 with 1,087 arrivals —
  twice its neighbours, which reads as a morning batch entry rather than organic traffic. Converted
  to a rate: **0.65 changes per minute at the busiest hour**, 0.28/min across business hours, and
  **0.018/min overnight — about one an hour**. A 60-second poll therefore never accumulates more
  than about one change even at peak, and a dispatcher sees a pickup or delivery within a minute of
  McLeod knowing it. Polling faster finds nothing, because nothing is there.

  **Why FLAT, and not backed off overnight.** The obvious optimisation is to slow down at night,
  when 98% of polls find nothing. It was costed and rejected: it saves roughly 500 cycles/day ×
  4 ms = **2 CPU-seconds**, and a time-of-day schedule would have to be expressed in Central time —
  **which is DST-shifting, the exact trap already in this plan's trap list (§5.9)**. Trading a DST
  bug for two CPU-seconds is a bad deal. One interval, no calendar.

  **What a day of it costs the server** (§3.4 for the per-cycle figures):

  | | Ours per day | Server's total | Share |
  |---|---|---|---|
  | Batch requests | 1,440 | ~11.9 M | **0.012%** |
  | CPU | 5.8 sec | 3.6 M core-sec | **0.00016%** |
  | Logins (pooled, D-MCC10) | ~1 | ~75,000 | **~0%** |
  | Buffer pool | the same 33 MB, kept hot | 62 GB | no eviction pressure |

- **D-MCC10 — one held connection, not one per poll. This is the biggest lever, and it is not the
  query.** A bare connect + `SELECT 1` against this server costs **~110 ms** wall clock; the entire
  board cycle costs **4 ms of CPU**. Connection setup — TCP, TLS, login, auth — is therefore roughly
  **25× more expensive than the work it carries**, and it is expensive on the *server* side too, not
  just ours.

  Reconnecting every poll at 60 s would add **1,440 logins/day**. The server currently handles ~75,000
  (455,430 logins over ~146 h of uptime) and holds 852 connections, so that is **1.9% of its login
  volume — spent entirely on handshakes, to run 5.8 CPU-seconds of actual work**. Pooled, it is ~1
  login and the same work.

  So the agent holds **one connection, pool size 1**, with keep-alive, and reconnects with backoff
  on failure. Pool size 1 rather than "a pool" is deliberate: the agent is serial by design
  (D-MCC6's one-query-at-a-time property), and a larger pool would let a retry storm open several
  sessions against a server whose writers we are trying not to disturb.

- **D-MCC9 — falling behind 10 days is a defined event with a defined recovery, not an incident.**
  CT retention is 10 days with auto-cleanup on. If the agent is down longer,
  `CHANGE_TRACKING_MIN_VALID_VERSION()` exceeds the stored watermark and CT correctly refuses to
  answer. The collector must **detect that explicitly** — compare before querying — and fall back to
  a bounded full re-baseline of that feed, reporting it. What it must never do is treat a `NULL`
  from `CHANGETABLE` as "no changes"; that is the silent-zero failure this repo has met before in
  other forms.

---

## 3. Facts the design is bound by — measured 2026-09-10 against live `lme`

### 3.1 Change Tracking

| Fact | Value |
|---|---|
| CT enabled on `lme` | **yes** — `is_auto_cleanup_on = 1`, retention **10 DAYS** |
| Tracked tables | **91** |
| Current version | **27,262,450** |
| Min valid version (`movement`, `stop`) | **24,922,470** → ~2.34 M versions retained |
| `is_track_columns_updated_on` | `true` on all 91 |
| CDC | **false** on both databases |
| `VIEW CHANGE TRACKING` for our login | **DENIED** — the one grant needed (MC0) |
| Needed and tracked | `movement`, `movement_order`, `orders`, `stop`, `driver`, `tractor`, `trailer`, `equipment_item`, `location`, `customer`, `company`, all finance tables |
| Needed and **NOT** tracked | **`continuity`**, `users`, `mc_position`, `callin` |

### 3.2 The two databases

| | `lme` | `lme_analytics` |
|---|---|---|
| What it is | production, continuously written | **full restore of `lme`**, frozen at the restore instant |
| Restores recorded | one, 2022-11-28 | **two: 2026-08-21 09:46, 2026-09-10 11:36** |
| Backup cost on production | — | 54.9 GB, ~6 min backup + ~7 min restore |
| Compatibility level | 110 | 110 |
| Recovery model | FULL | FULL |
| RCSI / snapshot isolation | **OFF / OFF** | OFF / OFF |

### 3.3 The server, and what we would add to it

| Fact | Value |
|---|---|
| Host | `APPNEW`, SQL Server 2019 Enterprise, `10.0.1.171:1433` |
| Capacity | **42 cores, 62 GB RAM** |
| Uptime at measurement | 141 hours |
| Sustained load | **~138 batch requests/second** (70,843,263 batches over uptime) |
| Concurrency at measurement | 852 user connections, 48 active requests, **0 blocked** |
| Login volume | **455,430** over uptime ≈ **75,000/day** |
| **Our dispatch tick at 60 s** | 1,440 batches/day = **0.012% of baseline** |
| Board query cost | **4 ms CPU** (the 0.30 s first measured was almost all TLS + network — §3.4) |
| `continuity` active re-read | 420 rows via clustered seek |
| Dispatch change volume | **26–345 stops/day, 26–263 movements/day** (7-day sample) |

### 3.4 What one poll cycle actually costs

Measured on the sandbox 2026-09-10 via `sys.dm_exec_query_stats` — same data, same indexes, so
logical reads are identical to production. Per the owner's instruction, the live server was not
touched for this.

| | Logical reads | CPU | Notes |
|---|---|---|---|
| Board query (movement + orders + 3× continuity + trailer) | 3,549 | **4 ms** | chose `MAXDOP 1` on its own |
| Stops query | 595 | **<1 ms** | |
| **Full cycle** | **~4,144 pages ≈ 33 MB** | **~4 ms** | the same 33 MB every cycle |
| Connect + TLS + auth (`SELECT 1`, wall clock) | — | **~110 ms** | **25× the query** — see D-MCC10 |

Server context for the same instant: **~138 batch requests/sec** sustained, **455,430 logins** over
~146 h uptime (**~75,000/day**), **852** user connections, **0** blocked sessions.

Activity distribution — 28 days of stop arrivals by hour (Central), which is what sets the cadence:

| Window | Arrivals | Rate |
|---|---|---|
| 07:00–16:00 | 4,664 (**85%**) | 0.28/min |
| 08:00 (peak) | 1,087 | **0.65/min** |
| 20:00–05:00 | ~309 (5.6%) | 0.018/min |

### 3.5 How little of the database we read

| | We read | The table holds | Share |
|---|---|---|---|
| Tables granted | **7** (+ column-scoped `driver`) | 1,459 | **0.5%** |
| Movements | 161 (active board) | 298,255 | **0.05%** |
| Stops | 338 | 614,284 | **0.05%** |
| Bytes touched per cycle | ~33 MB | 54.9 GB | **0.06%** |

⚠ Until MC0's grant lands, each cycle re-reads those 161 active movements rather than only the ones
that changed. That is still 0.05% of the table at 4 ms — "only the rows we need", not yet "only the
rows that changed". Change Tracking upgrades it to the second; neither reads the other 99.95%.

---

## 4. Steps

### MC0 · The grant — owner action, no code

Folds into `LIVE-MAP-PLAN.md` LM0 rather than duplicating it. The login asked for there gains one
clause:

```sql
GRANT VIEW CHANGE TRACKING ON dbo.movement       TO silvicom_dispatch_ro;
GRANT VIEW CHANGE TRACKING ON dbo.movement_order TO silvicom_dispatch_ro;
GRANT VIEW CHANGE TRACKING ON dbo.orders         TO silvicom_dispatch_ro;
GRANT VIEW CHANGE TRACKING ON dbo.stop           TO silvicom_dispatch_ro;
GRANT VIEW CHANGE TRACKING ON dbo.driver         TO silvicom_dispatch_ro;
GRANT VIEW CHANGE TRACKING ON dbo.tractor        TO silvicom_dispatch_ro;
GRANT VIEW CHANGE TRACKING ON dbo.trailer        TO silvicom_dispatch_ro;
-- finance feeds, when MC5 lands:
-- gl_ledger, gl_ledger_hist, gl_account, drs_settle_hist, drs_deduct_hist,
-- billing_history, journal_ap, journal_cash, journal_driver, journal_office,
-- journal_sales, journal_vm, settlement, open_item, vendor, payee
```

`VIEW CHANGE TRACKING` requires `SELECT` on the table as well, which the LM0 grant already gives. It
confers **no write** and no access to anything the `SELECT` grant does not already cover.

**Done when.** `SELECT COUNT(*) FROM CHANGETABLE(CHANGES lme.dbo.movement, <current-1000>) AS ct`
returns a number under the new login.

**If the grant is refused:** MC2's collector falls back to the bounded trailing-window re-read plus
hash diff that `roster.mjs` already implements — correct, just less efficient (a 2-day window on
`stop` is ~500 rows). Record the refusal; nothing downstream changes shape, because MC2 puts the
detector behind an interface for exactly this reason.

---

### MC1 · A change-detector module in the agent — no McLeod access needed to build it

`tools/mcleod-agent/changes.mjs`: `detectChanges(table, company, lastVersion) → { ids, newVersion }`,
with two implementations behind one signature — `changeTracking` (primary) and `trailingWindow`
(fallback, D-MCC9 and the refused-grant path) — selected by config.

It owns three rules that must not be re-derived at each call site:

1. Compare `CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(...))` against the stored watermark
   **before** querying. Greater ⇒ the watermark expired ⇒ signal `rebaseline`, never "no changes".
2. A `NULL` from `CHANGETABLE` is an **error**, not an empty result.
3. The watermark advances only after the push is acknowledged.

**Done when.** Unit tests in `tools/mcleod-agent/*.test.mjs` cover the expiry branch, the null
branch, and advance-after-ack — each **proven able to fail** by mutating the implementation.
`pnpm lint:agent-syntax` green.

---

### MC2 · Rewire the dispatch pull onto the detector

`loads.mjs` (from `LIVE-MAP-PLAN.md` LM1) asks `changes.mjs` which movement ids moved, re-reads only
those, and re-reads `continuity` for the active set (D-MCC3). Cadence 60 s (D-MCC8).

**Done when.** A dry run against `lme_analytics` reproduces the same load set as a full sweep, and a
run with an artificially stale watermark takes the `rebaseline` branch rather than reporting zero.

---

### MC3 · One connection, one query helper — the politeness policy, applied once

Every McLeod query in the agent goes through **one helper that owns both the connection and the
session settings**, so no call site can opt out of either.

**The connection (D-MCC10 — the bigger half).** One pooled connection, **`max: 1`, `min: 1`**, with
keep-alive, held for the life of the process and reconnected with exponential backoff on failure.
Not a connection per poll: connect + TLS + auth measured **~110 ms against a 4 ms query**, so
reconnecting each cycle would spend 1,440 logins/day — 1.9% of the server's login volume — on
handshakes alone. `max: 1` and not a real pool because the agent is serial by design; a larger pool
would let a retry storm open several sessions against writers we are trying not to disturb.

**The session settings, per query:**

| Setting | Value | Why that number |
|---|---|---|
| `LOCK_TIMEOUT` | **5,000 ms** | we yield rather than queue behind a McLeod writer (RCSI is OFF) |
| statement timeout | **15 s** | **3,750× the measured 4 ms** — can only fire on genuine pathology |
| `MAXDOP` | **1** | the board query already chose DOP 1; pinning it means we can never take parallel workers |
| isolation | **`READ COMMITTED`** | and **never `NOLOCK`** — a dirty read reaching a financial figure is worse than a query that waits, and at 4 ms these are far too short to need it |

**Circuit breaker.** If a cycle exceeds **2 s** (500× normal), stop polling, back off exponentially
and report. Something has changed on the server, and the correct response is to get out of the way
rather than retry harder.

**Done when.** `pnpm lint:agent-syntax` fails on an added `NOLOCK`, on a raw query that bypasses the
helper, and on a second connection being opened — each proven by mutation. A test asserts the pool
is `max: 1` and that a forced disconnect reconnects with backoff rather than per-query.

---

### MC4 · Sandbox freshness is reported, never assumed

`inspect.mjs` prints the connected database, and — when it is `lme_analytics` — the restore
timestamp from `msdb.dbo.restorehistory` and the age in days, as a warning line. Any figure derived
from the sandbox carries that timestamp.

**Done when.** Running against `lme_analytics` prints `⚠ sandbox restored 2026-09-10 11:36 (N days
old) — not a production source (D-MCC2)`; running against `lme` prints nothing.

---

### MC5 · Point the finance sweep at `lme`, then move it onto the detector

**Two changes, in this order, because they fail differently.**

**MC5a — change the source.** The finance sweep reads `lme_analytics` today and is measurably
behind (D-MCC2: 504 staging rows against production's 524 for September). Repoint it at `lme`. This
is a configuration change plus the LM0-shaped grant extended to the finance tables — no new code,
no new detector, and it is the change that makes the numbers true. Verify by re-running the same
75-day window and confirming the September count moves from 504 to 524.

**MC5b — change the mechanism, after the dispatch feed has run a week.** The finance tables are all
CT-tracked (§3.1), so the trailing-window sweep can become a CT delta. **Deliberately sequenced
last**: the finance path reconciles to the cent against a printed income statement, and it is not
the place to debug a new change detector. Keep the window sweep as the reconciliation control until
a week of agreement is measured.

**Done when.** MC5a: the September billing count in staging equals `lme`'s, and MC4's warning line
no longer fires for the finance run. MC5b: a CT-driven sweep and a window sweep produce identical
staging rows for the same period, compared row by row, before the window sweep is retired.

**If the finance grant on `lme` is refused:** keep the sandbox source and **automate the restore
immediately before each sweep**, so the freeze window is minutes rather than weeks. That is the
owner's original design and it works — it just has to be scheduled rather than manual, and MC4's
warning line has to stay switched on.

---

## 5. Traps

1. **`CHANGETABLE` returns `NULL`, not empty, when the watermark has expired.** Treating that as
   "nothing changed" stops the feed silently and forever.
2. **CT retention is 10 days.** An agent down over a long holiday needs a re-baseline, by design.
3. **`continuity` is not tracked** — a truck re-assignment is invisible to a `movement`-only poll.
4. **`lme_analytics` is frozen between restores**, and has been restored twice ever. It is not a
   "regularly updated copy" today; treating it as one puts three-week-old figures in front of an
   operator.
5. **RCSI is OFF.** A long read blocks McLeod's writers. Short, keyed, timed queries — never
   `NOLOCK` as a substitute for keeping them short.
6. **`MAX(date)` is never a watermark** — the sentinel is 2215-03-12.
7. **`movement.id` repeats across companies** — 18,761 collisions. Every key is composite. So does
   **`orders.id`** (16,948) and **`orders.blnum`** is not unique at all (2,020 collisions).
8. **A restore of `lme` into `lme_analytics` carries CT state with it**, so a watermark taken from
   the sandbox is meaningless against production and vice versa. Watermarks are stored per database.
9. **A time-of-day polling schedule would be expressed in Central time, which is DST-shifting.**
   That is why the dispatch cadence is flat (D-MCC8) — backing off overnight saves 2 CPU-seconds
   and buys a DST bug.
10. **Connection churn costs more than the queries.** ~110 ms to connect against 4 ms to run the
    board. One held connection, `max: 1` (D-MCC10) — reconnecting per poll is the single easiest
    way to make a negligible collector look like load.

---

## 6. Table scope per feed

Verified against `scripts/table-modules.json` and the live schema, 2026-09-10.

| Feed | McLeod tables (read-only) | CT? |
|---|---|---|
| dispatch | `movement`, `movement_order`, `continuity`, `stop`, `orders`, `trailer`, `users` | all but `continuity` and `users` |
| roster | `driver`, `tractor`, `trailer`, `users` | `driver`, `tractor`, `trailer` |
| finance | `gl_ledger(_hist)`, `gl_account`, `drs_settle_hist`, `drs_deduct_hist`, `billing_history`, `journal_*`, `voucher*`, `settlement`, `open_item`, `vendor`, `payee` | all |
| reference | `location`, `customer`, `commodity`, `city`, `gl_account` | all |

⚠ **`continuity` is the assignment source and `equipment_group`/`equipment_item` is not** — they
disagree on the live board and `continuity` is the correct one. See `LIVE-MAP-PLAN.md` §6 trap 16;
it is repeated there because that is where the SQL lives.

## 7. Progress log

- 2026-09-10 — plan written. §3 measured against live `lme`. Change Tracking found already enabled
  on 91 tables (10-day retention, 2.3 M versions retained); the only gap is the `VIEW CHANGE
  TRACKING` grant. `lme_analytics` measured as a twice-ever full restore, not a refreshing replica.
  Server measured at 42 cores / 62 GB / ~138 req/s baseline, against which the proposed collector is
  0.024%. No steps executed.
