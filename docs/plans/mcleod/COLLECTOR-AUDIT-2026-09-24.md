# McLeod collector — safety and load audit, 2026-09-24

**Status: CA1–CA5 BUILT 2026-09-24 (CA4 as the hash + close read); CA6 (send) and CA7 (VM cut-over) are the owner's and the carrier's.** Every statement the agent can send to McLeod was
inventoried from the code and **executed against the server** this session: the dispatch, roster
and retirement statements on live `lme` through `silvicom_dispatch_ro`, the finance statements on
`lme_analytics` (the only database the finance login can read — §4.3). Three runs each; `SET
STATISTICS IO/TIME`; median reported. Decision IDs `D-CA*`.

It answers the owner's four asks: are the queries safe, will they stay off the server's back, is
the documentation for the carrier precise, and does **all** McLeod data reach us through the VM
the carrier provides. It defers to `LOADS-GO-LIVE-PLAN.md` (L5–L10) and `LOADS-MIRROR-PLAN.md`
(LR*) for the work, and changes their order where §5 says so.

---

## 1. The target architecture (D-CA1)

```
 McLeod SQL Server (APPNEW, lme)
        │  one read-only login, one held connection, plain SELECTs
        ▼
 Board VM — inside the carrier's network, provided by their IT
   └─ Silvicom 360 connector (tools/mcleod-agent, Node + mssql, nothing else)
        │  outbound HTTPS only, bearer ingest token
        ▼
 Silvicom API  /api/tms/*  (Railway)
        ▼
 Collector tables (mcleod module, layer raw)  →  core tables (loads, drivers, …)  →  pages
```

**D-CA1 — the VM is the only thing that ever connects to McLeod.** Every feed — loads, roster,
finance — runs there, in one process, on one connection. Nothing on our side connects inbound, so
the carrier opens no firewall port and maintains no allow-list. Once the VM is live:

- the **laptop `launchd` roster sweep is uninstalled** — it is running today (`launchctl list`
  shows `com.silvicom.mcleod-roster`, every 2 minutes, against live `lme`);
- **ad-hoc probes from our machines stop**; a discovery question is written as a statement, added
  to the review file, and run on the VM by agreement;
- the **finance login (`NikiAnalytics`, `db_datareader`, reads `driver.social_security_no`) is
  retired** — the finance tables are granted to the connector's own login on `lme` instead (§4.3).

---

## 2. What was measured

### 2.1 Every shipped statement, on the server

| feed | statement | CPU | elapsed | logical reads | rows |
|---|---|---|---|---|---|
| loads | `DISPATCH_LOADS` | 16 ms | 12–16 ms | 5,171 | 162 |
| loads | `DISPATCH_LOAD_STOPS` | ≤16 ms | 8 ms | 3,811 | 337 |
| loads | `DISPATCH_DISPATCHERS` | 0 | 1 ms | 735 | 16 |
| roster | drivers / vehicles / trailers | 0 | 1–3 ms | 350 / 109 / 42 | 168 / 193 / 223 |
| retirement (by hand) | drivers / vehicles / trailers | 0 | 1–3 ms | 350 / 109 / 42 | 1,308 / 459 / 172 |
| finance | `MOVEMENT_FACTS` | **3,968–4,268 ms** | 3.4–3.6 s | **3,363,782** | 6,115 |
| finance | `GL_CONTROL_TOTALS` | 1,438 ms | 1.4 s | 41,669 | 746 |
| finance | `OFFICE_SETTLEMENT_LINES` | 953 ms | 1.0 s | 23,141 | 266 |
| finance | `MOVEMENT_FACT_COUNTS` | 531 ms | 0.5 s | 33,714 | 1 |
| finance | the other nine | 0–94 ms each | ≤113 ms | ≤72,079 | — |

The server's CPU clock ticks at ~15.6 ms, so "16 ms" means "one tick" and "0" means "under one".
All reads were logical (from memory).

### 2.2 The statements the plans will add, measured before they are written

| step | statement | CPU | elapsed | reads |
|---|---|---|---|---|
| LR3 | loads, widened with customer/weight/pieces/refs/loaded | 16 ms | 16 ms | 5,171 (unchanged) |
| LR3 | stops, widened with name/actuals/ETA/contact/PO | 16 ms | 7 ms | 3,860 |
| LR5 | close read — status of 300 held movement ids | ≤16 ms | 3 ms | 1,556 |
| L6 | `CHANGETABLE` on movement, stop, orders, movement_order (~1 h of versions) | **~60 ms** | ~48 ms | 7,330 |

Widening the board costs nothing: the same pages are read, only more columns are returned.

---

## 3. Findings

### F1 · The session settings we promise Alex are not in the code — known, still open (L5)

No statement sets `LOCK_TIMEOUT`, `DEADLOCK_PRIORITY LOW` or `MAXDOP 1`; the review README already
says so. `requestTimeout` is **120 s** (`roster.mjs`, `withPool`) where the letter promises a 15 s
ceiling. The pool opens **per call** with `max: 2` and closes after.

Measured today: `OPTION (MAXDOP 1)` costs nothing on any dispatch statement (16 ms either way) and
removes the only mechanism by which a 16 ms read could take several cores. SHOWPLAN is not granted,
so the plans themselves could not be inspected; `cpu > elapsed` was seen once (31 ms vs 16 ms) on
`DISPATCH_LOADS` as shipped and never with `MAXDOP 1`. **Nothing here is dangerous today; it is the
gap between what we will sign and what we run.**

### F2 · `MOVEMENT_FACTS` returns other companies' orders, and costs 15× what it should — NEW

Its two correlated lookups (`movement_order`, `equipment_item`) and both `equipment_item` joins
match on `movement_id` / `equipment_group_id` **without `company_id`**. `movement.id` repeats across
companies (`TMS` 278,276 movements, `TMS2` 19,614, `TMS3` 311 — the collision trap in
`mcleod-data-model-traps`), so:

- **Wrong data:** 128 of 6,115 movements in the 75-day window carry order numbers belonging to a
  `TMS2`/`TMS3` movement with the same id — e.g. movement 1012 reads `0000535,0000900` where its own
  order is `0000535`. Only `order_ids` differs; units, drivers and miles are identical. Production
  `mcleod_movements` holds 25,169 rows, 148 of them with more than one order — the contaminated set
  is inside those. `order_ids` is stored and returned by `financialReads.ts`; no calculation reads it
  today, so **no published figure is wrong yet.**
- **Cost:** adding `company_id` to the four lookups takes it from **3,968 ms CPU / 3,363,782 reads
  to 266 ms / 156,849** — every index on `equipment_item` and `movement_order` leads with
  `company_id`, so without it each lookup is a scan inside a spool.

`MOVEMENT_FACT_COUNTS` has the same missing predicate on one join; measured, its result is
identical scoped and unscoped today. Fix it anyway — it is identical by luck, not by design.

### F3 · Change detection costs the server more than reading the board

`CHANGETABLE` across the four tables is **~60 ms CPU**; the whole board is **~32 ms**. This
re-confirms `mcleod-full-sweep-beats-change-tracking` (76 vs 16 ms, 2026-09-17). D-MCC16 kept the
detector for three reasons; each now has a cheaper answer:

| D-MCC16 reason | answer without the detector |
|---|---|
| (a) do not re-post 160 loads to our API every minute | the agent hashes each movement and posts only changed ones — the roster already does exactly this (`roster-state.json`) |
| (b) notice a cancellation or a disappearance | LR5 reads the status of every movement we hold open, by id: 3 ms, and a **positive** statement rather than an inference |
| (c) survive a 10× larger board | a 10× board is still ~160 ms a minute; revisit when it exists |

**D-CA2 (recommended, owner to rule): drop L6/L7.** Full sweep + agent-side hash + LR5 close read.
It removes the most complex code in the plan and the `VIEW CHANGE TRACKING` dependence, and it is
the cheaper option **for the carrier**, which is the argument that matters to Alex.

### F4 · Four processes, not one

Each feed is its own `--flag` with its own loop and its own pool (`agent.mjs`: `--loads`,
`--roster`, `--financial`, each `while (true) … sleep`). On the VM that is up to three concurrent
connections and no guarantee two sweeps never overlap. **D-CA3:** one long-running process, one
connection, one internal schedule that runs feeds **one after another, never concurrently**, and a
single-instance lock so a second copy refuses to start.

### F5 · The finance sweep reads with the wrong login, from a frozen copy

It uses `NikiAnalytics` (`db_datareader` on everything, including SSNs) against `lme_analytics`,
last restored 2026-09-10 — this is L10/MC5a. Under D-CA1 it moves to the VM and to `lme`, which
needs SELECT on the finance tables for the connector's login. The request must be **column-scoped
where the table holds anything personal** and name the tables exactly (§4.3).

### F6 · Plaintext connection

`MCLEOD_SQL_ENCRYPT=false` today, because the server presents SQL Server's self-signed fallback
certificate. Already asked of Alex as a choice (review letter Q3). Unchanged; stays on the list.

### F7 · The database runs at compatibility level 110

`STRING_SPLIT` does not exist (`Invalid object name`), nor `OPENJSON` or `STRING_AGG`. Any new
statement must use SQL Server 2012 syntax — `FOR XML PATH` for aggregation (already the pattern)
and **a list of typed parameters** for an id set (LR5 measured this way: 300 × `VarChar(32)`,
3 ms). Never pass ids as one string to split: it is unavailable, and the obvious fallback
(`LIKE '%,' + id + ',%'`) is a scan.

### F8 · The agent posts to the web service, not the api service

`FUELGUARD_INGEST_URL` in the agent's config is `fleetguardweb-production`. Both Railway services
serve the same API, but they deploy at different commits (`deployed-is-a-per-service-question`),
so a feed can hit code that is one merge behind the one we just verified. The VM's config should
name the `api` service's address. One line of config; recorded so it is not copied onto the VM.

### What passed

- **Read-only, by construction:** the login holds no write permission; the code contains no
  `INSERT`/`UPDATE`/`DELETE`/`EXEC`/temp table (checked by `git grep`).
- **No `NOLOCK` / `READ UNCOMMITTED`** anywhere.
- **Every parameter typed** — all `.input()` calls declare `VarChar`/`DateTime`/`Int` (D-MCC11).
- **Every statement bounded** by company and by status or date window; the largest board read is
  5,171 pages from memory.
- **One connection helper** (`withPool`) is the only door to the server — which is what makes L5 a
  one-place fix.
- `readOnlyIntent: true` and `appName: "Silvicom 360 connector"` on every connection.

---

## 4. The load budget, after the fixes

### 4.1 Per feed

| feed | cadence | CPU per run | CPU per day |
|---|---|---|---|
| loads board (3 statements) | 60 s | ~32 ms | ~46 s |
| close read (LR5) | 10 min | ≤16 ms | ~2 s |
| roster (3 statements) | **15 min** (today 2 min — nothing on it changes that fast) | <16 ms | <2 s |
| finance (13 statements, F2 fixed) | **nightly 02:00 Central**, plus the month-start hardening pass | ~3.7 s | ~4 s |
| **total** | | | **~55 CPU-seconds a day** |

APPNEW has 42 cores: 3,628,800 core-seconds a day. **55 s is 0.0015%.** Statements: ~4,800 a day
(1,440 × 3 board + 144 close + 96 × 3 roster + ~13 finance) against a measured baseline of ~138
batches a second (~11.9 million a day) — **0.04%**.

### 4.2 Limits the connector enforces on itself (D-CA4)

| limit | value | why |
|---|---|---|
| connections | 1, held | a reconnect costs more than the query (D-MCC10) |
| `LOCK_TIMEOUT` | 5,000 ms | we give up; their user never waits on us |
| `DEADLOCK_PRIORITY` | `LOW` | if SQL Server must pick, it picks us |
| `MAXDOP` | 1, on every statement | we never take a second core |
| isolation | `READ COMMITTED`, never `NOLOCK` | no half-written rows reach finance |
| statement timeout | 15 s | the slowest statement after F2 is 1.4 s |
| circuit breaker | 3 timeouts or lock-timeouts in a row → pause 15 min, then retry | a busy server gets left alone, not retried harder |
| overlap | a feed never starts while another runs | one statement on the wire at a time |
| finance window | 02:00 Central | outside dispatch hours, even though it is small |

### 4.3 The access the VM needs (one request, in the letter)

| for | table | grant |
|---|---|---|
| loads, roster | `movement`, `movement_order`, `orders`, `stop`, `tractor`, `trailer`, `continuity`, `users`, `driver` (column-scoped) | **already granted** |
| PU number (LR7) | `reference_number` | SELECT |
| customer name (LR7) | `customer` | SELECT on the id, name and city/state columns only — no credit, billing or contact fields |
| finance | `gl_ledger`, `gl_ledger_hist`, `gl_account`, `billing_history`, `drs_settle_hist`, `drs_deduct_hist`, `voucher`, `voucher_hist`, `fuel_detail`, `fuel_detail_hist`, `equipment_item` | SELECT |
| plans (optional) | SHOWPLAN | lets us prove a statement's plan instead of inferring it from timings |

`VIEW CHANGE TRACKING` can be **given back** if D-CA2 is ruled. Column lists for `reference_number`
and `customer` must be read from `INFORMATION_SCHEMA` on the VM before the request is final — this
login cannot see those tables' columns.

---

## 5. Steps

Ordered so that **nothing is scheduled on the VM until the code does what the letter says** — the
rule L2 set and this audit keeps.

| step | what | replaces / relates |
|---|---|---|
| **CA1** | Fix F2: `company_id` on the four `MOVEMENT_FACTS` lookups and the `MOVEMENT_FACT_COUNTS` join. Test: a fixture with the same movement id in two companies must yield only its own orders — **proven by mutation**. Re-sweep the finance window so the 128 rows are corrected. | new |
| **CA2** | One connection, the §4.2 settings on every statement, `OPTION (MAXDOP 1)` appended by the helper, 15 s timeout, breaker. Gates in `lint:agent-syntax`: no `NOLOCK`, no query outside the helper, no second pool, no untyped `.input`, no `STRING_SPLIT`/`OPENJSON`/`STRING_AGG` (F7). | **is L5** |
| **CA3** | One process, internal schedule (§4.1), single-instance lock, feeds never concurrent. Windows service or a Task Scheduler "at startup" task on the VM. | new; L9's "Task Scheduler every 10 min" becomes this |
| **CA4** | Agent-side hash so unchanged movements are not re-posted; LR5 close read. | **replaces L6/L7** if D-CA2 is ruled |
| **CA5** | Regenerate `review/SILVICOM-READ-ROUTINE.sql` to hold **every** statement the VM runs — including finance (not in it today) and LR3/LR5 — with the §4.2 settings, and re-run it on the server as one batch. | extends L2 |
| **CA6** | Send the letter (`review/LETTER-TO-ALEX.md`) with the routine file attached. Nothing is scheduled until Alex answers. | L2 |
| **CA7** | VM cut-over: install, run each feed once by hand and compare to the laptop's output id by id, turn the schedule on, **then uninstall the laptop launchd job** and stop using the finance login. | L9 + L10 |

---

## 6. Open questions

1. **Q-CA1 — drop change detection (D-CA2)?** Recommendation: yes; §3 F3.
2. **Q-CA2 — roster cadence.** 2 minutes today. Recommendation: 15 minutes; a hire lands within a
   quarter hour, which is faster than any office process that depends on it.
3. **Q-CA3 — a separate finance login, or one login for everything?** Recommendation: one login
   (`silvicom_dispatch_ro`); two logins double the
   credentials on the VM without narrowing anything, because both would live in the same process.

---

## 7. Progress log

Append a dated line per merge. Never edit a status column.

- 2026-09-24 — audit written; every statement measured on the server (§2).
- 2026-09-24 — **Owner rulings:** Q-CA1 yes (no change detection; the letter says so), Q-CA2 roster
  every 15 minutes, Q-CA3 one login. Given as "fix and update all things … I will send this to Alex
  today".
- 2026-09-24 — **CA1–CA5 built, one PR.**
  CA1: `company_id` on the four `MOVEMENT_FACTS` lookups and the `MOVEMENT_FACT_COUNTS` join; measured
  through the new connector on `lme_analytics`: **218 ms CPU** (was 3,968–4,268), same 6,115 rows.
  `queries.test.mjs` now fails any statement naming a table alias without `company_id` — it finds
  exactly these five and nothing else. ⚠ The 148 multi-order rows already in production
  `mcleod_movements` are corrected only where the next finance sweep's window reaches them; older
  ones need one backfill. Nothing reads `order_ids` today.
  CA2: `connection.mjs` is the only door — session settings before and `OPTION (MAXDOP 1)` on its own
  line after every statement, `max: 1`, 15 s, a breaker (3 busy signals → 15 min, checked before
  connecting). **Verified on APPNEW from our own session**: `@@LOCK_TIMEOUT` 5000,
  `deadlock_priority` −5, isolation 2, program_name "Silvicom 360 connector". `lint:agent-syntax`
  rules (NOLOCK, compat-110 functions, own hints, a pool outside connection.mjs, untyped `.input`)
  each proven by a scratch violation.
  CA3: `--service` — one process, `schedule.mjs` (loads 1 min, close 10, roster 15, finance 02:00
  Central, DST pinned), single-instance lock. Ran 2 minutes against live `lme` posting to a local
  stub: 162 loads posted once then "none changed", roster ran, finance waited, a second copy refused,
  SIGINT released the lock.
  CA4 (as ruled): per-load hash so unchanged loads are never re-posted; the keyed close read
  (`closeReadQueries`, one typed parameter per id). **Dry run on the production backlog: 181 loads
  off the board → McLeod says 178 D, 3 V.** Not posted — that is day one on the VM
  (`INSTALL-ON-VM.md` §4).
  CA5: `review/build-routine.mjs` builds `SILVICOM-READ-ROUTINE.sql` (24 statements) from the code;
  `review.test.mjs` fails if it is one character stale or a statement is missing. All 24 executed
  through the connector (loads/close/roster/retirement on `lme`, finance on `lme_analytics`).
  ⚠ **Found on the way: the agent's unit tests had never run in CI** — `lint:agent-syntax` was in
  neither list, so `review.test.mjs` pinned nothing. Now chained onto `lint:cli-streams`.
  11 mutations run against the new code, each caught and each restored byte-for-byte.
