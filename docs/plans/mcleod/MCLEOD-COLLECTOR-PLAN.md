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
turns out not to be the binding constraint. §3.3 measures it: the proposed collector runs at
**0.024% of the server's existing request load**. The real hazard is lock contention, not volume,
and D-MCC6 is the decision that addresses it.

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
  rule is that it must carry its restore timestamp — MC6 builds that check once so nobody has to
  remember it.

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
  follows touches only the changed ids through a clustered seek — the whole active board is 0.3 s
  and 420 continuity rows are 0.19 s. **(3)** Every collector query carries an explicit statement
  timeout and an explicit `READ COMMITTED` isolation level; **`NOLOCK` is not used**, because a
  dirty read that reaches a financial figure is a worse outcome than a query that waits, and the
  queries here are too short to need it.

  For scale: the server sustains **~138 batch requests/second** across 141 hours of uptime on 42
  cores and 62 GB, with 0 blocked sessions at the time of measurement. A 30-second collector tick is
  **0.033 req/s — 0.024% of that**. Volume was never the constraint.

- **D-MCC7 — the on-prem agent stays the only thing that touches McLeod.** Railway has no route to
  `10.0.1.171` and never gets one. The agent reads over the LAN and pushes over HTTPS with an ingest
  token. This is already true and is restated because a live map creates the temptation to open a
  tunnel; the answer is no.

- **D-MCC8 — cadence is per feed and stated, not global.** A single interval would over-poll the
  roster and under-serve dispatch. Measured daily change volume on the dispatch tables is **26–345
  stops and 26–263 movements per day** (7-day sample; Mondays and Tuesdays peak), so a 30-second
  dispatch tick returns **zero rows on the large majority of ticks** — which is exactly the
  behaviour CT is designed for and the reason it is cheap.

  | Feed | Tables | Cadence | Why |
  |---|---|---|---|
  | dispatch | `movement`, `stop`, `orders`, `movement_order` + `continuity` re-read | **60 s** | the live board; D-LM9b's budget |
  | roster | `driver`, `tractor`, `trailer`, `users` | **daily** | changes a few times a month |
  | finance | `gl_ledger*`, `drs_*`, `billing_history`, `journal_*`, `voucher*` | **existing 75-day window sweep** | monthly close; D-FIN4's manual-entry lag |
  | reference | `location`, `customer`, `commodity`, `city`, `gl_account` | **weekly** | slow-moving lookups |

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
| Concurrency at measurement | 48 sessions, 1 running, **0 blocked** |
| **Our proposed dispatch tick** | **0.033 req/s = 0.024% of baseline** |
| Board query cost | ~0.30 s including TLS connect |
| `continuity` active re-read | 420 rows, ~0.19 s |
| Dispatch change volume | **26–345 stops/day, 26–263 movements/day** (7-day sample) |

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

### MC3 · The isolation and timeout policy, applied once

Every McLeod query in the agent goes through one helper that sets an explicit statement timeout and
`READ COMMITTED`, and **no query uses `NOLOCK`** (D-MCC6). A lint rule in `check-agent-syntax.mjs`
asserts both — the point of a policy nobody can accidentally opt out of.

**Done when.** `pnpm lint:agent-syntax` fails on an added `NOLOCK` and on a raw query that bypasses
the helper; both proven by mutation.

---

### MC4 · Sandbox freshness is reported, never assumed

`inspect.mjs` prints the connected database, and — when it is `lme_analytics` — the restore
timestamp from `msdb.dbo.restorehistory` and the age in days, as a warning line. Any figure derived
from the sandbox carries that timestamp.

**Done when.** Running against `lme_analytics` prints `⚠ sandbox restored 2026-09-10 11:36 (N days
old) — not a production source (D-MCC2)`; running against `lme` prints nothing.

---

### MC5 · Move the finance sweep onto the detector — after the dispatch feed has run a week

The finance tables are all CT-tracked (§3.1), so the existing 75-day trailing-window sweep can
become a CT delta. **Deliberately sequenced after dispatch**: the finance path reconciles to the
cent against a printed income statement, and it is not the place to debug a new change detector.
Keep the window sweep as the reconciliation control until a week of agreement is measured.

**Done when.** A CT-driven sweep and a window sweep produce identical staging rows for the same
period, compared row by row, before the window sweep is retired.

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
7. **`movement.id` repeats across companies** — 18,761 collisions. Every key is composite.
8. **A restore of `lme` into `lme_analytics` carries CT state with it**, so a watermark taken from
   the sandbox is meaningless against production and vice versa. Watermarks are stored per database.

---

## 6. Progress log

- 2026-09-10 — plan written. §3 measured against live `lme`. Change Tracking found already enabled
  on 91 tables (10-day retention, 2.3 M versions retained); the only gap is the `VIEW CHANGE
  TRACKING` grant. `lme_analytics` measured as a twice-ever full restore, not a refreshing replica.
  Server measured at 42 cores / 62 GB / ~138 req/s baseline, against which the proposed collector is
  0.024%. No steps executed.
