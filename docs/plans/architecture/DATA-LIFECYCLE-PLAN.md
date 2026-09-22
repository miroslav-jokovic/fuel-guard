# data lifecycle — every table declares how it grows, and something enforces it

**Status: ACTIVE PLAN.** Decision-log document per house convention. Decision IDs `D-LIFE*`.
Opened 2026-09-21 after a growth audit of the production database. Where this document and a
`lint:*` gate disagree, the gate wins and this file has rotted — fix the file.

Everything in §2 was measured against the production Supabase on 2026-09-21. Nothing here is
inferred from code alone, and the two design decisions that looked obvious before measuring
(`D-LIFE4`, `D-LIFE7`) were both changed by the measurement.

---

## 0. Why this exists

The owner asked, on 2026-09-21: we have a lot of fuellings and a lot of engine-run data — how do we
store it without hosting becoming expensive later? The measurement answered a different question
than the one asked, which is why this plan exists rather than a fuel-storage change.

**Fuel and engine data are 1.2% of database growth.** `fuel_spend_days`, `vehicle_engine_days` and
`fuel_transactions` together add ~0.38 GB/year at 272 trucks. They are already modelled at
truck-day grain, which is the pattern that keeps telematics cheap, and they would still be ~1 GB/year
at 1,000 trucks.

**Three tables are 94% of growth**, and two of them are defects rather than data. The follow-up
question — "is our database architecture and our storing practice wrong?" — has a precise answer:

> The schema architecture is sound. The **lifecycle** architecture does not exist.
>
> This repo machine-enforces a **500-line budget on a source file** (`lint:filesize`, warn at 450,
> with a grandfathering ratchet). It has no equivalent for a table writing **three million rows a
> month**. A file that grows is a CI failure; a table that grows is a surprise seven months later.

That asymmetry is the whole plan. Everything below is one idea applied three times: a table's
lifecycle must be **declared**, **enforced**, and **observed**. Today it is none of the three.

---

## 1. What is already right, and must not be rebuilt

Recorded because the next session will be tempted to replace these, and they are the reason the
damage is confined to three tables rather than thirty.

- **The grain model works.** `fuel_spend_days` (0244), `vehicle_engine_days` (0076) and
  `idle_rollup_days` (0114) are per-truck-per-day rollups over high-volume raw feeds. 272 trucks ×
  365 days ≈ 100k rows/table/year, tens of MB. This is why the fuel section is not the problem.
- **Retention is code, not folklore.** `apps/api/src/modules/org/dataRetention.ts` has bounded
  batches, a `why` string per rule, and `RETENTION_FORBIDDEN` for evidence tables. The design is
  right; §2.4 shows the calibration is not.
- **A machine-readable table registry already exists.** `scripts/table-modules.json` — 174 tables,
  each with `module` and `layer` ∈ `raw | core | derived | infra` (D-SEP2), checked by
  `scripts/check-table-modules.mjs`. **This plan adds a field to that file. It does not add a second
  registry.** Deriving beats restating; a parallel lifecycle manifest would be a workaround with a
  delay fuse.
- Tables have owners, RLS is gate-enforced (`check-rls.mjs`), and no table merges without a writer
  (`lint:table-producers`).

**What this is not.** It is not a database-choice problem. At 31 GB/year — 3 GB/year after this plan
— Postgres is comfortable for years, and per-truck-per-day rollups are not a time-series workload.
TimescaleDB is **not available on this instance** (measured: `pg_available_extensions` has no
`timescaledb`), and reaching for ClickHouse or an S3 warehouse now would be a large migration
against a problem we do not have, while the unbudgeted audit loop that *is* the bill keeps running.
If we outgrow this, the trigger will be query concurrency on the live map and dispatch, not
gigabytes of fuel history.

---

## 2. The measurements (2026-09-21, production)

These are the calibration inputs for §4. Re-measure before changing a threshold; do not re-derive
them from these figures.

### 2.1 Size and growth

Total database: **3,992 MB**.

| Table | Total | Indexes | Rows | Rows/30d | B/row | → GB/yr |
|---|---|---|---|---|---|---|
| `audit_logs` | 1,214 MB | 653 MB | 4.73 M | 3,104,413 | 269 | **10.2** |
| `scoring_attempts` | 991 MB | 377 MB | 2.31 M | 2,205,134 | 450 | **12.1** |
| `hos_duty_segments` | 967 MB | 707 MB | 1.65 M | 894,423 | 615 | **6.7** |
| `jobs` | 133 MB | 32 MB | 182 k | 120,162 | 765 | 1.1 |
| `idle_events` | 117 MB | 50 MB | 226 k | 64,820 | 543 | 0.43 |
| `fuel_transactions` | 64 MB | 33 MB | 17.5 k | 6,139 | 1,268 avg row | 0.29 |
| `fuel_spend_days` | 11 MB | 4.7 MB | 32.5 k | ~8,200 | 355 | 0.04 |
| `vehicle_engine_days` | 5.6 MB | 3.0 MB | 20.7 k | ~8,200 | 276 | 0.03 |

Trajectory **~31 GB/year**. Top three = **29.0 GB = 94%**. Fuel + engine + rollups = **0.38 GB =
1.2%**.

### 2.2 `audit_logs` is a sync log wearing a compliance ledger's clothes

Actions, last 7 days:

```
vehicle.update                924,628      ← 97% of volume
driver.update                  50,025
transactions.backfill             242
maintenance.inspection_started     21
...everything else               < 100
```

924,628 rows / 272 vehicles / 7 days = **485 audit rows per vehicle per day**. A vehicle's
attributes do not change 485 times a day.

Decisive: **`actor_id` is null on 925,341 of 925,341 `vehicle.update` rows, and on 49,507 of 49,507
`driver.update` rows. Zero distinct actors.** These are sync writes, not edits.

⚠ **This measurement changed the design.** The obvious invariant — "an audit row must carry an
actor" — is **wrong** and would have been shipped without it: legitimate system acts
(`transactions.backfill`, `fuel.exceptions_synced`) are also actor-less, 928 of 1,191 non-sync rows
over 30 days. The correct invariant is narrower and is `D-LIFE4`.

### 2.3 `scoring_attempts` and `hos_duty_segments`

- **136 scoring attempts per fuel transaction** (2,307,520 ÷ 17,564). Its
  `idx_scoring_attempts_org_started` index is **164 MB with 0 scans**. Nobody reads attempt 4 of 136.
  The table is `derived` (rebuildable) and is **absent from `RETENTION_RULES` entirely**.
- **68.7% of `hos_duty_segments` has `driver_id = null`** — 1,130,891 of 1,647,224 rows. The
  516,333 rows that carry a driver are **perfectly unique** on (driver, started_at, ended_at), so
  ingest is correct; we are storing two-thirds unattributable ELD time at 615 B/row.
  ⚠ An earlier pass of this audit read "1,230 duplicate groups, one segment copied 917 times" — that
  was `GROUP BY` folding all NULL `driver_id` into one group, not duplication. Do not re-raise it.
  ⚠⚠ **CORRECTED 2026-09-22 at L4 — "ingest is correct" was the wrong conclusion, and uniqueness on
  (driver, started_at, ended_at) is the reason it looked right.** Every row IS unique on that triple,
  because the writer minted a fresh `started_at` on every run. 72.5% of the table's last 45 days
  (366,374 of 505,634 rows) sits at 334 shared instants, one row per driver per `sync_hos` run;
  another 9.8% is the real daily-boundary log; **the genuine per-driver segments are 89,728 rows, of
  which 231 — 0.26% — have no driver.** There was never two-thirds of unattributable ELD time to
  rule on. The mechanism, the proof and the fix are in §2.9 and `D-LIFE11`.

### 2.4 Retention has never deleted a row

`data_retention` ran **381 times in 7 days**, last at 2026-09-22 01:41. Oldest row vs. its window:

| Table | Rule | Oldest row | Age |
|---|---|---|---|
| `idle_events` | 400 d | 2026-04-14 | 160 d |
| `vehicle_engine_days` | 400 d | 2026-04-14 | 160 d |
| `weather_cache` | 400 d | 2026-07-14 | 69 d |
| `hos_duty_segments` | 400 d | 2026-08-04 | 48 d |
| `route_geometries` | 180 d | 2026-07-15 | 68 d |
| `jobs` | 90 d | 2026-07-06 | **78 d** |

Every table is younger than its own window. **Not one rule has ever fired; 381 runs were all
no-ops.** `jobs` at 78 days will be the first, and it is the only rule that has ever been anywhere
near proving itself. The windows were set by intuition before there was anything to measure them
against, which is the same failure mode as the 400-day default itself.

⚠ **Read this table's "Oldest row" as `created_at`, which for two of its rows is NOT the column the
rule prunes on (found at L4, 2026-09-22).** `hos_duty_segments` compares `started_at`, whose oldest
value is **2026-04-07 — 168 days, not 48**: the feed was first switched on 2026-08-04 and backfilled
history behind it. The conclusion above survives (168 < 400, still a no-op), but a table's distance
from its own window can only be measured on the column in its `RetentionRule.timeColumn`, and this
pass measured all six the same way. `idle_events` and `vehicle_engine_days` also prune on
`started_at` / `day`; re-measure before quoting their age at L8.

### 2.5 Indexes are added and never reviewed

| Index | Size | Scans |
|---|---|---|
| `audit_logs.idx_audit_org_time` | 349 MB | 68 |
| `audit_logs.audit_logs_pkey` | 192 MB | **3** |
| `scoring_attempts.idx_scoring_attempts_org_started` | 164 MB | **0** |
| `audit_logs.idx_audit_action_trgm` | 112 MB | 38 |
| `idle_events.idle_events_pkey` | 9.4 MB | **0** |
| `hos_duty_segments.idx_hos_seg_org_driver_start` | 162 MB | 71,188,483 |
| `hos_duty_segments.hos_duty_segments_pkey` | 75 MB | 30,754,788 |
| `scoring_attempts.scoring_attempts_pkey` | 90 MB | 4,705,948 |

653 MB of index on `audit_logs` serves ~109 scans. `idx_audit_action_trgm` is a **trigram index on a
column with 8 distinct values in 7 days**.

The bottom three rows are the opposite finding and constrain §4: those primary keys are *heavily*
used, which is what makes `D-LIFE7` conditional rather than a blanket instruction.

### 2.6 Capability of this instance (measured, not assumed)

```
PostgreSQL 17.6 (aarch64)
installed : pg_stat_statements 1.11, pg_trgm 1.6, pgcrypto 1.3, plpgsql, supabase_vault, uuid-ossp
available : pg_partman 5.3.1, pg_cron 1.6.4, pgstattuple 1.5, pg_repack 1.5.2
NOT available : timescaledb
partitioned tables in our schema : NONE   (realtime.messages is Supabase's own, not ours)
```

⚠ **There is no partitioning precedent in this repo.** An earlier read of `pg_class` without a
schema filter suggested `messages` was ours. It is `realtime.messages`. §4 is first-of-its-kind work
and carries §6's risk section because of it.

### 2.7 What partitioning would break — the green light

- **No foreign key anywhere references any of the six candidate tables.** Measured over
  `pg_constraint`: `audit_logs`, `scoring_attempts`, `hos_duty_segments`, `idle_events`, `jobs`,
  `weather_cache` have outbound FKs only. Partitioning breaks no referential integrity.
- All six have a simple `id` primary key **except `weather_cache`**, whose PK is the natural key
  `(lat_grid, lng_grid, hour_utc)`.

Postgres requires the partition key to be a member of every unique constraint, so a partitioned
`audit_logs` has `PRIMARY KEY (id, created_at)`. Because nothing references these tables, that is
safe — but an `id`-only lookup then scans every partition, which is exactly what §2.5's bottom three
rows warn about.

### 2.8 What this actually costs

Honest, because overstating it would discredit the rest. Supabase gp3 disk is **8 GB included, then
$0.125/GB/month**:

| | DB size | Billable | Disk cost |
|---|---|---|---|
| today | 4 GB | 0 | $0 |
| +1 year, unchanged | 35 GB | 27 GB | ~$3.40/mo |
| +3 years, unchanged | 97 GB | 89 GB | ~$11/mo |

**The storage bill is not the problem — it is ~$130/year even three years out.** The real exposure
is elsewhere, and none of it is priced per byte:

1. **Index working set vs. instance RAM.** `audit_logs` (653 MB) and `hos_duty_segments` (707 MB)
   carry 1.4 GB of index that queries touch. When the working set exceeds RAM the cache hit rate
   collapses and the only remedy is climbing compute tiers — where the ladder is steep
   (Small $15 → Medium $60 → Large $110 → XL $210/mo).
2. **Restore and PITR.** Backup size and restore time scale with database size. A 100 GB restore is
   a materially different incident from a 4 GB one, and PITR is $100/mo per 7 days of window.
3. **IOPS and WAL from write amplification.** 3,000 IOPS are included, then $0.024/IOPS. Three
   million audit rows a month is WAL, replication traffic and autovacuum load that buys nothing.
4. **Bloat and vacuum debt** from large batched DELETEs that never catch up — §4's reason for
   partitioning rather than deleting harder.

**→ `D-LIFE0`: the objective is a bounded working set and a bounded restore, not minimum bytes.**
Optimising for the disk line item would be optimising the cheapest thing on the list.

⚠ Prices read 2026-09-21 from public sources; verify at supabase.com/pricing before budgeting.
The compute tier this project actually runs on has **not** been measured — see Q3.

### 2.9 The third table's growth is not data — it is one moving millisecond (measured 2026-09-22, L4)

`hos_duty_segments` was the last of the three, and it does not belong in the same category as the
other two. `audit_logs` and `scoring_attempts` were writing real rows that nobody needed for long.
This table was writing rows that describe **something that never happened**, and could not stop.

The mechanism, end to end:

1. `syncHosDutySegments` computed its window as `new Date()` minus 30 days — a different millisecond
   on every run, and it runs ~27 times a day (`jobs` where `kind = 'sync_hos'`, 49 runs in 48 h).
2. Samsara answers a windowed `/fleet/hos/logs` query by **clipping the duty status already in force
   at `startTime` to the query boundary**, so `logStartTime` comes back as *our request instant*.
   `parseHosLogs` keyed a segment on it, and the upsert key is (org, samsara_driver_id, started_at).

   ⚠ **CORRECTED 2026-09-22 by L4c — the clip is not at the boundary, it is at every 24 hours from
   it.** This paragraph says "the query boundary" and L4 built to that sentence, dropping the one log
   starting exactly at `startTime`. Probing the live API read-only at two request phases shows a clip
   at every `startTime + k × 24h`, the k-th stamped a further k ms along: a start of
   `2026-09-10T00:00:00.000Z` returns 1,105 records at `2026-09-11T00:00:00.001Z`, and moving the
   start to `13:37:11` moves them to `09-10T13:37:11.001Z` and `09-11T13:37:11.002Z`. L4 removed 1 of
   30. See §8's L4c entry for what the remaining 29 cost and why they are coalesced, not dropped.
3. The orphan sweep — the only code that deletes from this table — reads back
   `started_at >= startIso`. The previous run's boundary row starts ~30 minutes *before* the new
   `startIso`. **It is below the sweep's own floor, so it can never be seen again.**

The proof is an equality, not an inference: 1,100 rows start at exactly `2026-08-22 00:01:52.633`,
and a `sync_hos` job started at `2026-09-21 00:01:52.554` — the same instant plus thirty days, plus
the 79 ms our own `new Date()` took to be called. There are 27 such instants for that day, one per
run, each carrying one row for each of the 1,109 Samsara driver ids on the account.

What it costs, measured:

| | |
|---|---|
| Rows stranded, per run | **1,109** — one per driver on the account |
| Rows stranded, per day | **~30,000** (2026-09-21: 30,890 rows survived, 29,782 of them at 27 run instants) |
| Share of the last 45 days | **72.5%** (366,374 of 505,634 rows); a further 9.8% is the real daily boundary |
| Genuine per-driver segments | **89,728 in 45 days** — ~2,000/day, of which **231 have no driver** |
| Writes per run | 67,632 of 126,266 fetched segments — ~33,000 inserts + ~34,000 `ended_at` rewrites |
| Since the feed was switched on | `n_tup_ins` **35,299,153**, `n_tup_del` **34,188,450**, `n_tup_upd` **36,427,915**, for `n_live_tup` **1,655,661** — **~21× write amplification**, and 211 autovacuums in 49 days |

The storage line (~6.7 GB/year) is the least of it. The interesting number is the last row: this one
table has written and deleted ~70 M tuples to hold 1.65 M, which is `D-LIFE0`'s "IOPS and vacuum
debt" column made concrete — and it is the reason the growth audit's §2.1 rate for this table
(894,423 rows/30 d) was never a measure of ELD volume.

⚠ A second, smaller thing the same measurement found: we ingest HOS logs for **1,109 Samsara driver
ids while the roster maps 193**. The 916 unmapped ones contribute almost no real duty activity
(they are the source of the daily-boundary rows, ~915/day), but **31 of them have rows in
`driver_vehicle_assignments`**, which is how `deriveAssignedVehicleSegments` reaches a truck without
a `driver_id`. That is 4,208 rows a month that a null-driver rule would have deleted while they were
in use. See Q2.

---

## 3. The architecture: declared → enforced → observed

One idea, three legs. A lifecycle with fewer than three legs is what we have now.

```
  DECLARED          scripts/table-modules.json gains a `lifecycle` block per table.
    ↓               One registry. The gate reads it. Nothing restates it.
  ENFORCED          lint:table-lifecycle at merge  +  partitions & retention in the database.
    ↓               A table cannot merge without a lifecycle; a declared window is a real DROP.
  OBSERVED          A growth judge measures rows/day against the declared budget and raises a
                    finding in the office inbox, in the financialFreshness.ts / D-FIN3 shape.
```

**Why all three.** §2.4 is the proof: retention *was* declared and *was* implemented, and it has
never deleted a row, because nothing observed whether it did. A budget nobody measures is the
400-day window all over again. The observation leg is what makes this plan non-recurring, and it is
the leg most likely to be cut for scope — it should not be.

### 3.1 Layer → lifecycle, derived from the taxonomy that exists

`table-modules.json` already classifies every table. This plan gives each layer a default lifecycle
rather than inventing a fifth classification:

| layer | count | meaning (existing doc string) | default lifecycle |
|---|---|---|---|
| `raw` | 45 | collector staging, frozen at ingest | partition by month; hard retention; re-fetchable from vendor |
| `derived` | 26 | harness output, rebuildable | **by grain**: event-grain → partition + prune; day-grain rollup → keep forever (tiny) |
| `core` | 77 | canonical / user-authored | never auto-pruned; **must be low-volume by construction** |
| `infra` | 26 | credentials, caches, queues, counters, logs | prune aggressively |

The `derived` split is the one piece of judgement here, and §2.1 is why: `fuel_spend_days` and
`scoring_attempts` are both `derived` and differ in annual growth by **300×**. Layer alone cannot
carry the lifecycle; grain has to be declared.

A `core` table with a high write rate is a **design smell the gate should catch** — it means
business records are being generated by a machine, which is exactly `D-LIFE4`.

---

## 4. Decisions

### D-LIFE0 — the objective is a bounded working set and a bounded restore
Not minimum bytes. §2.8. Every threshold in this plan is justified against index-working-set and
restore time; a change that shrinks disk but not the hot index set has not done the job.

### D-LIFE1 — the lifecycle is declared in `table-modules.json`, not a new file
Each entry gains a required `lifecycle` block:

```json
"hos_duty_segments": {
  "module": "samsara",
  "layer": "raw",
  "lifecycle": {
    "growth": "time",
    "retention_days": 400,
    "partition": null,
    "budget_rows_per_day": 5000,
    "why": "raw ELD duty segments. Measured 29,819/day, of which 68.7% carry no driver_id (Q2). L4 proposes 400d->120d once Q2 is ruled; the window here stays the one in force."
  }
}
```

`budget_rows_per_day` is the field that does not exist anywhere today and is the point of the plan.

**Three amendments forced by building L1 on 2026-09-22.** Each was measured, not reasoned:

1. **`grain` was dropped; `growth` replaced it.** The plan assumed grain was derivable from schema.
   It is not: a fleet-bounded table (`vehicles`, keyed `(org_id, external_id)`) and an unbounded event
   stream (`fuel_transactions`, keyed `(org_id, external_ref)`) are structurally identical, and a
   derivation that classified them the same way is worse than no derivation. `growth` —
   `time | fleet | static | unmeasured` — answers the only question the lifecycle needs: does the row
   count grow with elapsed time?
2. **The budget is `rows_per_day` fleet-wide, not `rows_per_truck_day`.** Measurement showed most
   high-volume tables are not truck-scoped at all (`jobs`, `imports`, `mcleod_*`, `weather_cache`), so
   a per-truck denominator would be a fiction for exactly the tables that matter. The L8 judge
   normalises by fleet size when it reports; the declaration stays honest.
3. **`retention_days` mirrors the window IN FORCE, never the one this plan proposes.** Encoding
   `D-LIFE5`'s targets would have failed the gate on day one and, worse, made the registry lie about
   production. The proposals live in each entry's `why`; the number moves in the step that moves the
   code. This is what makes check 3 of `D-LIFE2` meaningful rather than decorative.

### D-LIFE2 — `lint:table-lifecycle` is the merge gate
A new gate script, built to the house pattern (`--self-test`, a `"//lint:table-lifecycle"` sibling
comment in `package.json`, registered **by name** in the `gates` job of `.github/workflows/ci.yml`).
It asserts:

1. every live table has a `lifecycle` block (mirrors how `check-table-modules.mjs` already asserts
   every live table has a module);
2. `retention_days` is present unless `layer: core` or the table is in `RETENTION_FORBIDDEN`;
3. a table declaring `partition` really is partitioned in `supabase/schema.generated.sql`;
4. `RETENTION_RULES` in `dataRetention.ts` and the registry **agree** — a window declared in one and
   absent or different in the other is the gate's loudest failure, because that divergence is
   `D-LIFE4` in miniature.

⚠ Per CLAUDE.md, a gate in `package.json` and in neither CI list **is not a gate**. This one goes in
`gates` by name, in the same PR.

### D-LIFE3 — partition creation is DDL; data movement is a job
**The load-bearing decision of this plan.**

The repo's hard rule is that schema changes are next-numbered migrations, auto-applied to production
by `migrate.yml` on merge. A partition conversion that backfills 4.7M rows **cannot** run that way:
statement timeouts, lock escalation, and a deploy window now measured at 2m44s
(`docs/MIGRATION-DISCIPLINE.md`).

So every conversion is **two merges**, and this is also exactly what `lint:migration-ordering`
already requires of a column and its first reader:

- **Merge A — DDL only, fast, auto-applied.** Create the partitioned shell and its partitions.
  Sub-second. Safe inside `migrate.yml`.
- **Merge B — the drain, through the job ledger.** Bounded, resumable, idempotent batches, exactly
  the mechanism `dataRetention.ts` already uses (`BATCH`/`MAX_BATCHES`), running as a `jobs` kind so
  a failure leaves a `failed` row with Postgres's error text rather than one line in a log — the
  lesson `fuelSweepFreshness.ts` was built from.

Never a long-running data migration inside a migration file. That is the rule this plan contributes
to the repo's standing set.

### D-LIFE4 — `audit_logs` holds two things with opposite lifecycles; split by *what happened*, not by age
The registry calls `audit_logs` **`infra` ("logs")**. `dataRetention.ts` calls it inviolable
compliance evidence that may never be pruned. **Both are half right, and their disagreement is the
design error** — it is why the fastest-growing table is the one it is forbidden to trim.

The split is by origin of the row, not by its age:

- **`audit_logs` keeps** every act that changed something a regulator, an auditor or a carrier would
  ask about — human or system. Append-only, never pruned, multi-year, reclassified `core`. Low
  volume: ~1,200 rows/30d today once the sync noise is gone.
- ~~**A sync produces a counter, not a row per entity.** One row per collector run in a new
  `sync_runs` table (`infra`, partitioned, 90-day retention) carrying `examined` / `changed` /
  `failed` counts.~~ **WITHDRAWN 2026-09-22, not built.** The counter already exists: `jobs.stats`
  records `{"total": 206, "created": 0, "updated": 206, "assigned": 182}` per `sync_vehicles` run and
  the equivalent for `sync_stats`, measured in production. A `sync_runs` table would have been a
  second source of truth for a number already kept — a copy is a workaround with a delay fuse
  (CLAUDE.md). Anything wanting per-run sync counts reads the job ledger.

**The invariant, corrected by §2.2:** not "an audit row must have an actor" — system acts
legitimately have none. It is: **an audit row must record a change** that somebody could be asked
about.

⚠ **AMENDED 2026-09-22, when L2 opened and read the mechanism.** The sentence that stood here —
"`vehicle.update` firing 485×/vehicle/day records no change" — **is false**, and the plan asserted it
without checking. What is actually true:

- The writer is **not application code**. It is a database trigger: `audit_vehicles` /
  `audit_drivers`, `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW EXECUTE audit_row_change('vehicle')`.
  No amount of grepping `apps/api` would ever have found it.
- `audit_row_change()` has **no OLD/NEW comparison** — but that is not the cause either, because
- the machine writers **already diff-gate**. `samsaraStatsFeed.ts:240` compares each field and
  updates only when `Object.keys(patch).length > 0`.

So the rows are **real column changes**: `current_odometer` and `samsara_fuel_percent` on a moving
truck, measured at 20.2 updates per vehicle per hour across 272 of 272 vehicles, with **zero**
`vehicle.insert` or `vehicle.delete` in seven days. The trigger is doing exactly what it was built to
do. **The defect is that live telemetry lives on a `core` entity table and is therefore inside an
audit trigger built for business changes.** See Q5 — this is now a fork the owner must settle.

⚠ **The trap in the obvious fix.** `if old is not distinct from new then return new` **would never
fire**: `set_updated_at()` is a BEFORE UPDATE trigger that sets `updated_at = now()`
unconditionally, so by the time the AFTER trigger runs, `new` always differs. Any comparison must
exclude the machine-stamped columns explicitly — `to_jsonb(old) - 'updated_at'` — and a version that
did not would have shipped, changed nothing, and looked correct.

⚠ `audit_logs` is append-only and pinned in `RETENTION_FORBIDDEN`. Nothing in this decision deletes
a historical row. The 4.7M existing rows are dealt with by Q1, which is the owner's call, not this
plan's.

### D-LIFE5 — retention windows are calibrated per tier, and every window must be reachable
400 days uniformly is how §2.4 happened. Windows are set from measured bytes/row × rows/day against
`D-LIFE0`, and **a window longer than the product's own data history is not a policy**. Proposed
starting points, each to be re-measured at the step that ships it:

| table | now | proposed | basis |
|---|---|---|---|
| `scoring_attempts` | *(none)* | 45 d | derived + rebuildable; 136 attempts/txn; 0 scans on its own index |
| `hos_duty_segments` | 400 d | 120 d | duty overlay reads ≤120 d; Samsara re-backfills |
| `idle_events` | 400 d | 180 d | `idle_rollup_days` carries history beyond |
| `idle_park_sessions` | 400 d | 180 d | same |
| `weather_cache` | 400 d | 90 d | a cache; re-fetched on demand |
| `jobs` | 90 d | 90 d | **unchanged — it is about to fire for the first time; let it prove itself** |

### D-LIFE6 — partition with native declarative range partitioning, maintained by `pg_partman` + `pg_cron`
Monthly range partitions on the time column. `pg_partman` 5.3.1 into its own `partman` schema,
retention via `part_config` with `retention_keep_table = false`, so expiry is a `DROP` that returns
space instantly and generates no WAL storm, no bloat and no vacuum debt.

⚠ **`pg_partman`'s background worker is not available on Supabase's managed platform** — `pg_cron`
is the scheduler, calling `run_maintenance_proc()` hourly (idempotent and cheap when idle).

### D-LIFE7 — partition candidates are ordered by measured access path, not by size
§2.7 permits partitioning; §2.5 says where it is free and where it is not. An `id`-only lookup
against a partitioned table scans every partition, so the primary-key scan count decides the order:

| table | pkey scans | verdict |
|---|---|---|
| `audit_logs` | **3** | **partition first.** Nothing looks it up by id. Largest table, zero risk. |
| `idle_events` | **0** | safe, but only 117 MB — low priority. |
| `scoring_attempts` | 4,705,948 | **audit the id access path first.** Likely an upsert key; may be satisfied by retention alone. |
| `hos_duty_segments` | 30,754,788 | **do the null-driver ruling first** (Q2) — it removes 68.7% of the volume with no partitioning at all. Partition only after the access path is audited. |
| `jobs` | — | not yet. Its 90-day rule fires in ~12 days; let it prove itself (`D-LIFE5`). |
| `weather_cache` | — | **never.** Composite natural PK `(lat_grid, lng_grid, hour_utc)`; adding `fetched_at` would change dedup semantics. Plain retention. |

⚠ This decision was going to be "partition the six biggest tables" before §2.5 and §2.7 were
measured. Two of the six would have regressed a hot path.

### D-LIFE8 — an unused index is a finding, not a fact of life
An index with zero scans over a measured window is reported by the growth judge (`D-LIFE9`).
Immediately actionable from §2.5: `idx_scoring_attempts_org_started` (164 MB, 0 scans) and
`idx_audit_action_trgm` (112 MB, 38 scans, 8 distinct values). ~276 MB reclaimable.
`idx_audit_org_time` (349 MB, 68 scans) backs the audit UI — **review, do not drop blind.**

⚠ **CORRECTED 2026-09-22 by L5, which is DECLINED on its own measurement. Neither index is dead,
both are the planner's chosen path, and the ~276 MB is not reclaimable.** The decision above is kept
because the PRINCIPLE survives and only its two examples fall; see §8's L5 entry for the method.

| index | scans (re-measured) | with it | without it | verdict |
|---|---|---|---|---|
| `idx_audit_action_trgm` | 40 | **457 ms** | **57,287 ms** (2,531,818 rows dropped by filter) | **KEEP** — 125× |
| `idx_scoring_attempts_org_started` | 10 | **139–352 ms** warm | **3,879–6,263 ms** | **KEEP** — 11–45× |

Two premises were wrong. `audit_logs.action` has **100 distinct values, not 8**, over 5,063,829 rows,
so a trigram index is the right structure and not an obvious mistake — and the audit UI's filter is
`ilike('action', '<prefix>%')`, which the planner serves from exactly that index. And a low
`idx_scan` count measures HOW OFTEN A PAGE IS VISITED, not whether the index earns its keep: both of
these back real but rarely-opened screens (`AuditPage.vue`, `scoringHealth.ts`), and on the visit they
do get they are the difference between a third of a second and a minute.

⚠ **The growth judge `D-LIFE9` must not be built on `idx_scan` alone, or it will raise exactly this
finding, and a future reader will action it.** A judge needs the counterfactual — the cost of the
query WITHOUT the index — which `EXPLAIN (ANALYZE)` inside `begin; set local enable_*scan = off;
… rollback;` gives safely, without dropping anything or taking a lock.

### D-LIFE9 — the growth judge closes the loop
A scheduled pass samples `pg_class` / `pg_stat_user_indexes` into a small `table_growth_days`
(`derived`, per-table-per-day, ~200 rows/day, self-hosting under its own budget) and raises a
finding + one email to the owning module's managers when a table exceeds its declared
`budget_rows_per_truck_day`, when an index has no scans, or when partition maintenance has not run.
Same shape as `financialFreshness.ts` (D-FIN3) and `fuelSweepFreshness.ts`.

### D-LIFE10 — `pg_cron` is a new blind spot and must alarm on itself
A `pg_cron` job is invisible to every gate in this repo and to `docs/WORKER-DEPLOYMENT.md` — the
same class of blind spot as `RUN_SCHEDULERS_IN_PROCESS`, which ran the whole scheduler set on a
second service until 2026-09-05.

**If `run_maintenance_proc()` stops, inserts fail once they run past the last pre-made partition.**
That is a production outage, and it is strictly worse than the slow growth this plan exists to fix.
Therefore: `premake` generously (≥ 6 months), and the growth judge alarms when the newest partition
is less than **60 days** ahead of the write head — well before the cliff. **This alarm ships in the
same merge as the first partitioned table, never after it.**

### D-LIFE11 — a table that grows from a defect gets the defect fixed, not a shorter window

Added 2026-09-22 at L4, from §2.9. Retention, partitioning and budgets all assume the rows are
**real**: that something wanted them written, and the only question is how long they stay. Two of
the three tables in this audit fit that. `hos_duty_segments` did not — 72.5% of it is one writer
artefact — and every instrument in this plan would have shown it as healthy demand:

- a **retention window** caps the artefact instead of removing it, and refills at 30,000 rows a day;
- a **partition** makes the artefact cheap to scan and does not delete one row of it;
- the **L1 budget** was already breached (29,819/day against 5,000) and said only "too much", which
  reads as "shorten the window" — the wrong next question, and the one L4 was written to ask;
- the **L8 growth judge** will say the same thing again, unless it is read as "why?" not "how long?".

So the rule: **before a window is shortened or a table is partitioned, the growth rate must be
attributable to a writer and a reason.** For this table that meant ten minutes of `group by
started_at having count(*) > 500` — the artefact announces itself the moment rows are counted by
instant instead of by day. A rate nobody can attribute is a defect until proven otherwise.

⚠ The corollary, which cost this plan two wrong premises in three steps: `audit_logs` (L2) and
`hos_duty_segments` (L4) were BOTH writer defects wearing a lifecycle problem's clothes, and in both
cases the plan's own account of the cause was wrong before the measurement. `scoring_attempts` may
be the third — Q6 is exactly this question, still open, with the CPU and the Samsara quota still
burning behind a window that now caps only the bytes.

---

## 5. The queue

Ordered so the discipline lands before the cleanups; otherwise the next table repeats the pattern.
Each step is one PR unless stated.

| # | step | effect | depends on |
|---|---|---|---|
| **L1** | `lifecycle` block in `table-modules.json` for all 174 tables + `lint:table-lifecycle` + CI registration | the missing discipline | — |
| **L2** | Diff-gate the entity-sync audit writes; add `sync_runs` (`D-LIFE4`) | **~10 GB/yr**, in the one table that cannot be pruned | L1 |
| **L3** | `scoring_attempts` → `RETENTION_RULES` at 45 d; investigate the 136×/txn rescore loop | **~12 GB/yr** + wasted compute | L1 |
| **L4** | ~~Null-driver `hos_duty_segments` ruling (Q2) + retention 400→120 d~~ **RE-SCOPED 2026-09-22 (§2.9, `D-LIFE11`): anchor the HOS window to the calendar day + drop the boundary-clipped segment.** Neither original leg survived measurement | **~6.7 GB/yr and ~21× write amplification** | L1 |
| **L4b** | Delete the ~1.4 M rows L4 stopped producing (`Q7`) — needs an owner ruling, not a merge | ~0.9 GB now | L4, Q7 |
| ~~**L5**~~ | ~~Drop the two dead indexes (`D-LIFE8`)~~ — **DECLINED 2026-09-22, neither is dead; both are 11–125× on their query.** See `D-LIFE8` | **0 MB**, not 276 | — |
| **L6** | `pg_partman` + `pg_cron` install, `partman` schema, **plus the `D-LIFE10` alarm** | mechanism | L1 |
| **L7** | Partition `audit_logs` — Merge A (DDL) then Merge B (drain) per `D-LIFE3` | bounded working set on the largest table | L6, Q1 |
| **L8** | The growth judge + `table_growth_days` (`D-LIFE9`) | the observation leg | L1 |
| **L9** | Re-measure; then `scoring_attempts` / `hos_duty_segments` access-path audit and partition if still warranted (`D-LIFE7`) | | L7, L8 |

**L1, L2, L3 and L5 together are ~22 GB/year and touch no partitioning at all.** If this plan is
ever cut for scope, cut from L9 backwards, never from L1.

---

## 6. Risks, and what this plan does not make bulletproof

Stated plainly, because a plan claiming to be bulletproof and not listing these would be the least
trustworthy document in the repo.

1. **A live partition cutover has a non-zero window.** Postgres cannot convert a table in place; the
   documented options are a new table with backfill and cutover, or renaming the existing table into
   a partitioned shell as its `DEFAULT` partition (sub-second lock) and draining afterwards. `D-LIFE3`
   makes it short and resumable. It does not make it zero, and L7 needs a rollback rehearsed on a
   branch database first.
2. **`pg_cron` failing silently is a new, worse failure mode** than the one being fixed. `D-LIFE10`
   is the mitigation and it is not optional.
3. **A budget gate cannot see a Railway variable or a vendor changing feed volume.** It sees the
   declaration and the measurement. The judge (`D-LIFE9`) is what catches reality diverging from the
   declaration; the gate alone would be theatre — which is precisely the 400-day lesson.
4. **`CREATE INDEX CONCURRENTLY` does not work on a partitioned parent.** Index changes on
   partitioned tables need the build-on-leaves-then-attach dance. Budget time for it in L7.
5. **L2 changes what is written to an append-only compliance table.** It needs the guard test and
   counsel-visible reasoning that `RETENTION_FORBIDDEN` implies, and it is the one step where "ship
   it and see" is not available.
6. **`scoring_attempts` at 136 attempts/transaction may be a bug whose fix removes the need for L3's
   retention.** L3 does both, and if the loop turns out to be intentional the retention still stands.

---

## 7. Open questions — owner rulings required

**Q1 — the 4.7M existing `audit_logs` rows.** `D-LIFE4` stops the noise; it does not decide what
happens to 924k/week of already-written actor-less `vehicle.update` rows. Candidates:
(a) leave them, partition around them, let them age out of the hot set — **recommended**, it decides
nothing irreversible and L7 delivers the working-set benefit anyway; (b) migrate them to `sync_runs`
counters and delete; (c) delete outright. **(b) and (c) are deletions from a `RETENTION_FORBIDDEN`
table and need an explicit audited service-role act, never a side effect.** Recommend (a).

**Q2 — null-driver `hos_duty_segments`. ANSWERED 2026-09-22 at L4, and the question was wrong.**
~~1.13M rows, 68.7% of the table. Does anything read duty segments with no driver?
`idleDutyEvidenceSync` keys the duty overlay **by driver**, so a null-driver row cannot participate —
but that needs confirming at the call site before deleting. Recommend: stop ingesting them.~~

Both halves failed at the call site. Taking them in the order that matters:

1. **Null-driver rows ARE read.** `mapSegments` (`idleDutyEvidenceSync.ts:222`) keeps a row that has
   no `driver_id` and no `vehicle_id` as long as it has a `samsara_driver_id`, writes it as
   `driverId: "unresolved"`, and files it under `bySamsaraDriver` — which
   `deriveAssignedVehicleSegments` then walks to reach a truck through
   `driver_vehicle_assignments`. That path is not incidental; it is the v2 fix for incident
   2026-08-11 ("5 of 177 trucks had confident data"), because sleeper and off-duty logs — the ones
   that decide overnight idle — almost never name a vehicle. Measured: **221 Samsara driver ids have
   assignments while only 193 are mapped to a `drivers` row**, so **31 drivers, 4,208 rows a month,
   reach a truck with no `driver_id` at all.** "Stop ingesting them" would have re-opened the
   incident for those trucks.
2. **There was no two-thirds of unattributable ELD time.** Of the genuine per-driver segments in the
   last 45 days, **231 of 89,728 (0.26%)** have no driver. The 1.13 M was §2.9's writer artefact,
   which happens to mint a row for each of the 1,109 Samsara driver ids on the account while the
   roster maps 193 — that ratio, not ELD reality, is where "68.7% null" came from.
3. **The writer already ruled on this, in a comment, in 2026-08.** `hosSync.ts` stores an unresolved
   segment deliberately — "so a later driver match can link it, and On-Duty/rest attribution is not
   lost" — and the sync re-walks a rolling 30 days, so a mapping that arrives within the window
   back-fills itself. The plan proposed to overturn a decision it had not read.

**No ruling is needed and none is taken.** The 400→120 leg is declined too, on its own measurement:
the scoring attribution check reads segments around any fill it rescores, and **9,406 of 17,297 fuel
transactions are older than 120 days** while Q6's rescan re-scores 2,000–7,500 of them every hour.
A 120-day window would flip those fills' logbook verdict from a real answer to `unknown` on their
next rescore — degrading evidence to buy 194,404 rows, 11.8% of a table whose other 72.5% was the
defect. Revisit only after Q6 bounds what actually gets rescored.

**Q7 — the ~1.4 M rows L4 stopped producing. OPENED 2026-09-22.** §2.9's artefact accrued at ~30,000
rows/day from 2026-08-04, and L4 stops the production but deletes nothing: the rows sit below the
orphan sweep's floor, and retention will not reach them for 400 days. They are identifiable exactly
— `started_at` shared by ~1,100 drivers at a single millisecond, matching a `sync_hos` run instant
minus the window — so a bounded delete is straightforward to write and to verify. Candidates:
(a) delete them in bounded batches as an explicit, audited service-role act, **recommended** —
~0.9 GB and, more usefully, a duty timeline that stops being fragmented at arbitrary instants;
(b) leave them and let the 400-day window take them in 2027 — costs nothing to decide, but the
fragments keep splitting real segments in every overlay read until then; (c) shorten the window to
reach them sooner — rejected, that is `D-LIFE11`'s exact mistake and would also take real history.
This table is NOT in `RETENTION_FORBIDDEN` (raw telematics, re-fetchable from Samsara for 30 days
and rebuilt daily), so (a) is permitted — but a 1.4 M-row delete on production is the owner's call,
not a merge's side effect.

**Q3 — what compute tier is this project on?** Not measured. `D-LIFE0` is about working set vs. RAM,

**Q3 — what compute tier is this project on?** Not measured. `D-LIFE0` is about working set vs. RAM,
and the thresholds in `D-LIFE5` should be tightened if the instance is Micro or Small. One reading
from the Supabase dashboard settles it.

**Q4 — is PITR enabled?** At $100/mo per 7-day window it changes the §2.8 arithmetic materially, and
it makes restore time a first-class reason for L7 rather than a secondary one.

**Q5 — telemetry on a `core` entity table. THE L2 BLOCKER, opened 2026-09-22.** `vehicles` carries
`current_odometer`, `samsara_fuel_percent`, `samsara_fuel_at` and ~30 `idle_*` learned/evidence
columns alongside `vin`, `plate`, `ownership_type`, `insurance_expires_at` and `has_apu`. One table,
two lifetimes: identity that changes a few times a year and telemetry that changes every three
minutes. `audit_vehicles` cannot tell them apart, so the compliance ledger takes ~10 GB/year of
odometer readings. Three candidate answers:

- **(a) Column ignore-list in the trigger.** `audit_row_change` takes a per-table set of
  machine-maintained columns and skips the row when the changed set is a subset of it. Smallest
  change; one migration; no reader moves. **Cost:** the ignore-list is a second place that knows
  which columns are machine-owned, and it will rot the first time somebody adds a telemetry column
  and forgets — so it needs its own gate, which is real work. Recovers substantially all of the
  ~10 GB/year.
- **(b) Move telemetry off `vehicles` into its own table.** The honest fix: `vehicles` becomes what
  the registry already calls it (`core`, `growth: "fleet"`), and telemetry becomes `time`-growth with
  a retention window like every other feed. **Cost:** every reader of `current_odometer` /
  `samsara_fuel_percent` moves, which is a wide blast radius across fuel, live map and dashboards,
  and it is a rename-shaped migration needing the four-step dance. Removes the problem instead of
  filtering it, and stops the next telemetry column recreating it.
- **(c) Route machine-origin audit rows to a separate table.** Keeps every row, moves the volume out
  of `audit_logs`. **Cost:** preserves the conflation D-LIFE4 exists to end, and the new table
  inherits the same growth with no reader.

**Recommendation: (a) now, (b) on the record as the real fix.** (a) is one migration plus a gate and
recovers the bytes this quarter; (b) is correct and is a separate programme that should be planned
on its own rather than smuggled into a lifecycle step. Shipping (a) **without** writing (b) down
would be precisely the labelled-workaround case in CLAUDE.md, so the ignore-list carries a comment
naming (b) as what removes it. ⚠ (c) is not recommended and is recorded only so it is not
rediscovered as novel.

**⚖ RULED 2026-09-22, later the same day: (b) is adopted and has its own plan —
`docs/plans/architecture/TELEMETRY-SEPARATION-PLAN.md` (`D-TEL*`). 0352 stands until it lands.**
Two things measured while scoping it changed the answer's shape, and both are why (b) is smaller and
more urgent than this question assumed:

- **The target pattern is already built.** Migration **0262** (2026-08-27, `D-SEP3`,
  `SEPARATION-PROGRAM-PLAN` P2.2) created `vehicle_tank_learned` and `vehicle_idle_learned` — which
  hold **32 of the 39 `vehicles` columns in 0352's ignore list** — backfilled them, and left the legacy columns
  in place with `DEPRECATED` comments saying they "retire when their writers migrate". The writers
  never migrated and no plan owned the step. (b) is therefore not a new programme; it is the
  retirement half of a strangler this repo already started, plus one satellite for the live feed and
  one for the driver HOS block.
- **The half-migrated state costs more than either end state.** 0262's mirror trigger has no diff
  gate, so an odometer write — which touches no learner column — rewrites both satellites as well as
  the 447-byte `vehicles` row. `vehicles` + the two satellites + `vehicle_positions` are **932 rows
  taking 14.55 M updates and 27,573 autovacuum cycles in 122 days**. Waiting is not free, and "a copy
  is a workaround with a delay fuse" is already measurable: `odometer_offset` disagrees between
  `vehicles` and its satellite on one vehicle.

⚠ The estimate in (b) above — "a wide blast radius" — was checked rather than inherited: **53 source
files** mention any of the 43 columns, but the browser reads most of these values from API responses
rather than the database, and the 15 direct `.from("vehicles")` sites in the SPA contain exactly one
`select("*")`. That one is the silent hazard, and it is named in `D-TEL5`.

**Q6 — what rescans the whole fleet's fills every hour? OPENED BY L3, 2026-09-22.**

⚠ **ANSWERED 2026-09-22 (third and final revision) — read the LAST entry of §8 first, not this
section.** Everything below that is derived from `result_hash` change rates is an artefact: the hash
contains `samsara_recon_checked_at`, a wall clock stamped on every non-`skipRecon` pass, so it counts
live reconciliations and not verdicts. The answer is three `efs_processing_runs` rows stuck since
2026-08-28 and retried 235 times, which are 48.9% of all scoring in the product. The chain of
reasoning below is kept because the order in which it was wrong is the point of `D-LIFE11` — but do
not act on the age-band table or on recommendations (a)/(b)/(c) as they are stated here.

L3 caps the
storage; this is the work behind it, and it is compute as well as bytes.

Measured: **2,415,317 attempts against 17,293 fuel transactions = 139.7 per transaction.** The hourly
profile is the decisive part — between 2,000 and 7,500 **distinct** transactions are rescored *every
hour*, against roughly 200 genuinely new fills a day. So this is a continuous full-fleet rescan, not
new work arriving.

Two things it is **not**, both checked:

- **Not deploy-driven.** `scoringEngineVersion()` is `rs-<RULESET_HASH>+<commit>` and there are 677
  distinct values — but that spans months, nowhere near hourly, and `persist.ts:50-58` documents the
  commit half as deliberate.
- **Not rule churn.** Those 677 versions cover **6 distinct ruleset hashes**, two of which carry 99%
  of the rows (1,985,028 + 423,230). By the engine's own content hash, ~99% of these rescores could
  not have changed a verdict.

The leading hypothesis, **unconfirmed**, is the Samsara recon tier: `SAMSARA_RECON_BATCH` fills every
`SAMSARA_RECON_SYNC_MINUTES` re-walk fills to attach telematics, and each pass rescores. If it
re-walks fills that already have `samsara_recon_at` set, the rescan is self-sustaining. Confirming it
needs the two Railway variables (same blocker as Q5) and a read of the recon tier's selection query.

⚠ **ANSWERED 2026-09-22. It is not the recon tier. Every EFS import re-scores the ENTIRE fill
history of every vehicle it touches, oldest-first, and the job is killed before it ever reaches the
recent ones.**

The recon hypothesis is ruled out on volume: both variables are **unset in production**, so the
defaults apply (`SAMSARA_RECON_SYNC_MINUTES` 60, `SAMSARA_RECON_BATCH` 250) — **250 fills an hour
against a measured 2,000–7,500**. The `backfill` JOB KIND is ruled out the same way, 38 runs a day of
33 — though `backfill.ts` is where the real mechanism lives, which is why the kind is a red herring.

The chain, each link measured:

1. **`scoreVehicle` is unbounded in time** (`backfill.ts:400`). It pages `fuel_transactions` for one
   `vehicle_id` with **no date predicate at all**, `order fueled_at ascending`, and scores every row.
2. **`scoreImportWithCascade` calls it once per affected vehicle** (`backfill.ts:443`). The cascade is
   deliberate and documented — "importing history changes MPG baselines and over-fuel windows for the
   affected vehicles' neighbouring fills" — but it re-scores **every** fill of those vehicles, not the
   neighbouring ones, and the set grows with history forever.
3. **One import touches ~58 vehicles holding 5,640 fills.** Measured on the 15:56–16:32 run.
4. **The job never finishes.** It scored **973 of those 5,640 (17%)** before being reclaimed. Over
   24 h: **146 done (avg 0.9 min, the small imports) and 56 failed (avg 72.5 min)**, killed by
   `startJob`'s unique-slot conflict path (`jobs.ts:200-226`) when a later import finds the lease stale.
5. **The replacement restarts from the oldest fill**, so the same prefix is re-scored forever. This is
   why **94.6% of attempts (6,131 of 6,480 in three hours) are on fills older than 120 days** and only
   18 are on fills newer than two days.

⚠ **This is a correctness finding, not only a cost one.** Because the walk is oldest-first and is
killed at ~17%, the cascade's re-scoring **never reaches recent fills** — the ones whose MPG baseline
and over-fuel window the cascade exists to correct. The work is not merely wasted; it is spent on the
wrong end of the history.

⚠ **Two lease clocks, and the one being renewed is not the one that decides reclaim.** `locked_by` is
null on these rows: production runs `JOB_EXECUTION_MODE=inprocess`, so `dispatchJob` → `runJob`, and
the queue's 30-minute lease plus the renewal `inprocessDrain.ts` documents (2026-09-05) never apply.
Same two-sources-of-truth shape as `D-SEP3`, in the queue rather than in a table. Worth fixing, but it
is the amplifier here, not the cause.

**Candidate fixes — owner's ruling needed, because all of them change scoring behaviour:**

- **(a) Bound the cascade to the neighbourhood its own docstring describes.** The justification is
  MPG baselines and over-fuel windows, both of which have finite lookbacks; the code takes the whole
  history instead. This is the real fix and it removes ~99% of the work.
- **(b) Let the job finish** (raise the lease for this kind, or stop the conflict-path reclaim).
  ⚠ **On its own this makes things WORSE**: finishing means ~112 minutes of scoring per import, and the
  posted feed opens an import every ~30 seconds.
- **(c) Walk newest-first**, so the fills that matter are scored before the kill. A one-line ordering
  change that fixes the correctness half without touching the cost half.

⚠ **(a) IS NOT SUPPORTED BY THE MEASUREMENT EITHER. Third revision, same day.** Bounding the cascade
assumes the old fills it re-scores cannot change. They change more often than any other band.

775,573 attempts over seven days, classified by comparing each attempt's `result_hash` with the
previous attempt for the SAME transaction. `scoringResultHash` covers `{txnId, engineVersion,
caseFired, outcome}`, so a deploy forces a new hash whether or not the verdict moved — which is why
the engine version has to be held constant to see a real change:

| | attempts | share |
|---|---|---|
| changed nothing (identical hash) | 319,967 | **41.3%** |
| hash moved, but the ENGINE moved too — indistinguishable | 337,323 | 43.5% |
| **hash moved under the SAME engine — a genuine input-driven change** | **101,268** | **13.1%** |
| first ever scored | 17,015 | 2.2% |

The 43.5% is real deploy churn and not a defect: **38–50 commits land on `main` a day**, every merge
redeploys, and `scoringEngineVersion()` deliberately carries the commit (`persist.ts:59` argues why).

Change RATE per attempt, by the fill's age — the number that kills (a):

| age of fill | attempts | genuine changes | rate |
|---|---|---|---|
| ≤ 2 d | 883 | 153 | 17.33% |
| 3–14 d | 20,769 | 450 | 2.17% |
| 15–60 d | 91,844 | 116 | 0.13% |
| 61–120 d | 125,083 | 122 | 0.10% |
| **> 120 d** | **536,984** | **100,427** | **18.70%** |

⚠ Read this with its confound stated: the cascade walks oldest-first and dies at 17%, so old fills are
most of what gets scored at all. The rate controls for that; the *shape* may still be selection. What
it rules out is the premise (a) rests on — "old fills are settled". A verified sequence shows one
fill's hash moving four times in ten hours **under one unchanged engine version**
(`7a6da4dd → c62e29e9 → 269448c4 → e3844e5b`).

**So the real question is not scope, it is IDEMPOTENCE.** The same code, on the same fill, is
producing different outcomes, which means a scoring input is sliding underneath it. The leading
candidate is the per-vehicle learned calibration: `learnVehicle` recomputes `baseline_mpg`,
`tank_fill_ratio` and the capacity figures from a ROLLING LAST-30-FILLS window, so every new fill
shifts values that every historical fill's score reads. **Unverified**, and it must be verified before
anything is built — a 56-minute window after Q-TEL4's diff gate deployed (2026-09-22 16:13 UTC) shows
the same-engine change rate at 1.12% against 6.00% before it, which is suggestive and badly confounded
by window length and job mix. **Re-measure over ≥ 24 h before treating it as a result.**

**Recommendation: measure idempotence first; build nothing yet.** Score one fill twice under one
engine with no import in between and diff the outcome; if it differs, the sliding input is the defect
and neither bounding nor re-ordering the cascade addresses it. (c) — walking newest-first — remains
safe and useful on its own, because a walk that is always killed at 17% should spend that 17% on the
fills anyone is looking at.

⚠ This is the THIRD recommendation recorded for Q6 in one day: "(b) raise the lease" (wrong — the
mechanism was not a lease lapse), "(a) bound the cascade" (wrong — the bounded-out fills are the ones
that change), and now "measure idempotence first". Each was overturned by the next measurement, and
each was stated with more confidence than the evidence carried. The lesson belongs in `D-LIFE11`
alongside the defects: **a mechanism believed but not measured is a hypothesis, and writing it into a
plan does not promote it.**

**Recommendation: do not fold this into L3.** L3's window is safe and independently justified.
This is a scoring-engine question, not a lifecycle one, and it wants its own measurement — the prize
is CPU and Samsara API quota at least as much as the 12 GB/year retention already caps.

**Also owed before L2 builds:** the exact writer mix behind 20.2 updates/vehicle/hour is NOT
established. `SAMSARA_STATS_SYNC_MINUTES` defaults to 20, which would give 3/hour — the measured
rate implies ~3 minutes in production, and the Railway variable could not be read non-interactively.
Four other pinned writers touch `vehicles` (`learnVehicle.ts`, `persist.ts`, `idleCapabilitySync.ts`,
`samsaraVehicleSync.ts`). The ignore-list must be derived from all of them, not from the stats feed
alone.

**⚖ SETTLED 2026-09-22 while scoping Q5(b), by measurement rather than by reading the variable.** All
91 columns of all 272 rows, snapshotted eight minutes apart and diffed key by key: **131 rows
rewritten; `samsara_fuel_at` on 105, `current_odometer` on 83, `samsara_fuel_percent` on 62,
`odometer_offset` on 1, and no idle column at all.** The live feed is the writer — the four columns
that have no satellite — while the two families that do have one contributed a single row between
them. 0352's ignore list was derived correctly from all five writers, so nothing there changes; what
changes is the ORDER of the fix, which is why `TELEMETRY-SEPARATION-PLAN` starts with the live feed
(`D-TEL2`). ⚠ The same diff found something no value-level query could: **26 of those 131 rewrites
changed nothing but `updated_at`** — a no-op UPDATE that still costs a tuple, the audit trigger's
91-column comparison and the 0262 mirror. That is `Q-TEL4` over there, and it is the third instance
of `D-LIFE11`'s shape in three days.

---


**Q6a — the three stuck EFS processing runs: resolve them how? OPENED 2026-09-22.** Runs
`7516924d`, `6f0c6a6c` and `b9f1f710` have been `running` since 2026-08-28 / 2026-09-05 with 233–235
attempts and have never completed. They are 47,522 scoring attempts and ~47,500 live Samsara
reconciliation calls per day, against fills from January–May 2026. Candidates: (i) mark the three rows
terminal and leave their imports scored as they stand — cheapest, and their fills already hold 85–133
generations of recon evidence, so nothing is lost that has not already been collected many times over;
(ii) run each once to completion out of band, with recon suppressed, then mark terminal; (iii) leave
them and fix only the retry ceiling, which stops the 236th attempt but not the 235 already spent.
**Recommendation: (i).** These are writes to production, so this is Miki's, not a merge.

**Q6b — a run that has failed 235 times must not be offered a 236th: what is the ceiling?** Nothing
consults `efs_processing_runs.attempts`; it is incremented and never read. There is no dead-letter
state. Candidates: a fixed ceiling (5? 10?) moving the run to a terminal `abandoned` status with
`last_error` preserved and a console warning in the shape `dueRunIds` already uses for stranded runs;
or an exponential `next_attempt_at` ladder with no ceiling, which slows the loop without ending it.
**Recommendation: a ceiling.** A retry that has never once succeeded in 235 tries is not a retry.

**Q6c — should `scoreImport` skip a live recon for a fill that already has one?** `claimReconBatch`
already carries the right predicate (`samsara_recon_at is null`, `backfill.ts:76`); `scoreImport` has
none, so it re-fetches evidence it successfully collected on every previous pass. The counter-argument
is real and is why this is a question and not a change: a live refresh is how corrected station
coordinates and recovered fueling instants reach an old fill, and `mergeReconciliation` exists to
let a better measurement win. **Recommendation: bound it by age of the last SUCCESSFUL recon rather
than by its existence** — refresh evidence older than some window, never refresh the same fill twice
in one day. The number wants measuring; nothing in this plan measures it yet.

**Q6d — split `result_hash` into a verdict hash and a payload hash?** As long as
`samsara_recon_checked_at` is inside the hashed payload, `scoring_attempts` cannot answer "did this
fill's verdict change" — three revisions of Q6 measured the clock instead. Candidates: exclude the
recon metadata (`samsara_recon_checked_at`, `samsara_recon_evidence_version`) from the hashed value —
one line, but it silently changes the meaning of 2.4 M stored hashes; or add a second column
`verdict_hash` over the verdict-bearing fields only, leaving `result_hash` as the payload identity its
docstring says it is. **Recommendation: the second column**, and note it lands in two merges behind
its reader per `lint:migration-ordering`.


**Q6e — what should a historical verdict be scored against? OPENED 2026-09-22, blocks fix (a).** A
fill's verdict reads the vehicle's CURRENT learned gates (`context.ts:27`), not their values as of the
fill, and every live fill re-learns them while the live path cascades only 5 fills forward. So
history is already scored against stale gates between imports, and the import cascade's full-history
walk is the only — erratic — re-sync. (a) gates as they are NOW: keep a full-history pass on every
gate change, including on the live path; (b) gates as they WERE: needs as-of calibration history,
which does not exist; (c) accept drift: bound the cascade, re-sync history only on an explicit
rebuild. **Recommendation: (c)**, pending the `verdict_hash` measurement in §8's 2026-09-22 entry for
#971 — it is what the live path already does, and it makes the import path agree with it.

## 8. Progress log

Append dated lines at the END. Never edit a row above (see `plan-progress-log-not-table-rows`).

- **2026-09-21** — Plan opened. Growth audit measured against production: 3,992 MB total, ~31 GB/yr
  trajectory, 94% in `audit_logs` + `scoring_attempts` + `hos_duty_segments`, fuel + engine data at
  1.2%. Established: no FK references any partition candidate (§2.7); `audit_logs` sync noise is
  100% actor-less (925,341/925,341) and its pkey sees 3 scans (§2.2, §2.5); retention has never
  deleted a row in 381 runs (§2.4); `pg_partman` 5.3.1 / `pg_cron` 1.6.4 available, `timescaledb`
  not, no partitioning precedent in our schema (§2.6). Three measurements each changed a decision
  that looked settled beforehand: the actor invariant (`D-LIFE4`), the partition ordering
  (`D-LIFE7`), and the cost framing (`D-LIFE0` — disk is ~$130/yr three years out; the exposure is
  working set, restore and IOPS). Nothing built.
- **2026-09-22 — L1 built** (`claude/data-lifecycle-l1`). All 174 tables in
  `scripts/table-modules.json` carry a `lifecycle` block; `scripts/check-table-lifecycle.mjs` is the
  gate, registered in `package.json` with its `"//lint:table-lifecycle"` comment and **by name** in
  the `gates` job of `ci.yml`. Turned on at **zero violations**: 16 `fleet`, 61 `time`, 97
  `unmeasured`, 13 retention windows mirrored. Eight self-test detectors, plus four mutations against
  the real files (registry drifts from code; code drifts from registry; a stripped lifecycle block; a
  table leaving the ratchet) — all four failed the gate, bytes restored and md5-verified afterwards.
  Three amendments to `D-LIFE1` are recorded there, all forced by measurement: `grain` is not
  derivable from schema and became `growth`; the budget is fleet-wide because most high-volume tables
  are not truck-scoped; and `retention_days` mirrors the window in force rather than this plan's
  proposals. **Two findings the work produced, neither of them the point of L1:**
  `driver_vehicle_assignments` is a `core` table taking 3,210 writes/day against 272 vehicles and 302
  drivers — possibly a fourth instance of the `vehicle.update` loop, flagged for L2; and
  `vehicle_engine_days` carries a 400-day prune rule that is in tension with `idle_rollup_days` being
  the long-horizon store, raised for L9 rather than changed here.
- **2026-09-22 — L2 opened, and stopped on a corrected premise.** No code written. Reading the
  mechanism before changing it found that `D-LIFE4`'s central factual claim was wrong: the writer is
  the `audit_vehicles` / `audit_drivers` **database trigger** (`audit_row_change`), not application
  code; the trigger has no OLD/NEW comparison but that is not the cause, because the machine writers
  already diff-gate (`samsaraStatsFeed.ts:240`); and the rows are therefore **genuine** telemetry
  changes — 20.2 updates per vehicle per hour, 272 of 272 vehicles, **zero** inserts or deletes in
  seven days. `D-LIFE4` is amended in place and **Q5** now carries the fork (column ignore-list vs
  moving telemetry off `vehicles`) with a recommendation. Also found and recorded: a naive
  `old is not distinct from new` guard **cannot ever fire**, because `set_updated_at()` is a BEFORE
  trigger that bumps `updated_at` unconditionally — a fix written without checking that would have
  shipped, changed nothing, and looked right.
- **2026-09-22 — L2 built as Q5(a)** (`claude/data-lifecycle-l2`). Migration **0352** gives
  `audit_row_change` an optional second trigger argument: a comma-separated ignore list consulted on
  UPDATE only, so a row is written when at least one NON-ignored column actually changed. INSERT and
  DELETE are never filtered, and a column added later is audited **by default** — the safe direction
  to fail. `audit_vehicles` ignores live telemetry, learned tank/odometer calibration and the derived
  `idle_*` family; `audit_drivers` ignores the HOS position block. The list is by MEANING, not by
  author: `samsaraVehicleSync` writes `vin`, `plate` and `unit_number` and `samsaraDriverSync` writes
  `cdl_number`, all of which stay audited, because a machine changing a VIN is *more* interesting to
  an auditor than a human doing it. `has_apu` / `apu_type` / `has_optimized_idle` stay audited too —
  they grant idle avoidability and are admin-set.
  **Verification:** `supabase/tests/audit-telemetry-ignored.test.mjs`, 20 assertions, and two
  mutations against the real migration prove it can fail in *both* directions — removing `updated_at`
  turns the whole filter into a no-op (6 failures, the trap the header warns about), and adding `vin`
  and `has_apu` to the list silences a VIN change (4 failures). Bytes restored and md5-verified.
  `rls` (542 assertions), `identity-provenance`, `equipment-section-split` and `restricted-records`
  all still green.
  **`audit_logs` gained a budget** (500 rows/day, ~12× the measured non-telemetry rate of ~40/day)
  and `BUDGET_WAIVED` in `check-table-lifecycle.mjs` is now **empty**, exactly as its comment
  promised in L1. ⚠ The budget is PROVISIONAL until the post-0352 rate is measured in production.
  **`sync_runs` was withdrawn, not built** — `jobs.stats` already carries the per-run counts.
  ⚠ **This is a labelled workaround.** Q5(b) — moving telemetry off `vehicles`/`drivers` — is what
  removes 0352, and the migration header says so in its own register.
- **2026-09-22 — L3 built** (`claude/data-lifecycle-l3`). `scoring_attempts` joins `RETENTION_RULES`
  at **45 days** — the largest single line in the audit at 12.1 GB/year, larger than `audit_logs`,
  and until today it had no rule at all in a policy whose first principle is that derived and
  reproducible data is pruned. **45 is DERIVED, not chosen:** `scoringHealth()` is the only reader
  and clamps its own window to at most 30 days, so 30 is the hard floor and 45 leaves a fortnight;
  `backfill.ts` only names the table in an error string. The 0156 idempotency guard needs seconds.
  `dataRetention.test.ts` pins the 45 > 30 relationship and was proven to fail at 30 — the failure
  mode it guards is silent, since a health page reading past the horizon shows a healthy-looking zero
  rather than an error.
  **L1's gate did its job on the very next step:** adding the rule while the registry still said
  `null` failed `lint:table-lifecycle` with "they move together (D-LIFE2)", which is exactly the drift
  it exists to catch. 14 windows now mirrored, up from 13.
  **Q6 opened, and deliberately not folded in here.** Retention caps the storage; it does not stop
  the work. 139.7 attempts per transaction, and 2,000–7,500 DISTINCT transactions rescored every hour
  against ~200 new fills a day — a continuous full-fleet rescan whose driver is not yet confirmed.
  Ruled out: deploy churn (677 engine versions span months) and rule churn (those 677 cover just 6
  ruleset hashes, two carrying 99%). The prize there is CPU and Samsara quota, not bytes.
  **Two things the step forced that were not in its scope.** `dataRetention.ts` hit 526 lines against
  the 500-line budget, so the POLICY (the `RetentionRule` interface, `RETENTION_RULES`,
  `RETENTION_FORBIDDEN`) split into `dataRetentionPolicy.ts`, re-exported so no call site or test
  moved — `lint:filesize` says plainly that a waiver is the deliberate alternative to a split, and
  there was a real seam. And repointing the gate at the new file exposed **a latent bug in L1's own
  parser**: `parseRetention` matched `RETENTION_FORBIDDEN` on its first MENTION rather than its
  declaration, so a prose reference above the declaration could capture a slice of `RETENTION_RULES`
  instead. ⚠ L1 shipped CORRECT — the old file's layout happened to land on the right block, verified
  by re-running the old regex against the old file — but it was one comment away from wrong. The
  match is anchored on `export const` now, and the self-test gained a detector that fails when the
  parse finds no rules at all, which is the shape this class of bug takes: a gate enforcing nothing
  while printing a tick.

- **2026-09-22 — L4 built, but not the L4 that was written down** (`claude/data-lifecycle-l4`). The
  step was "rule on null-driver rows (Q2), then 400→120". Measurement killed both legs and found the
  real cause underneath them, which is §2.9 and `D-LIFE11`: **72.5% of this table's last 45 days is
  one writer artefact** — `syncHosDutySegments` took its window start from `new Date()` minus 30
  days, Samsara clips the in-force duty status to `startTime`, and the orphan sweep reads back
  `started_at >= startIso`, so every run minted ~1,109 rows at an instant the next run's sweep could
  never see. ~30,000 rows a day, kept for good. The proof is an equality: 1,100 rows at
  `2026-08-22 00:01:52.633` against a `sync_hos` job at `2026-09-21 00:01:52.554`.
  **The fix is two lines and no migration.** The window now starts on a calendar day — via
  `idleCalendarStartIso`, the anchor the idle feeds reading this table already use, whose own comment
  gives the reason — so re-runs within a day ask for the same instant and collide on the same key;
  and `parseHosLogs` learned `windowStartMs`, dropping the segment clipped to the boundary, which is
  a duty transition that never happened. Nothing is lost: the driver's real segment spanning that
  instant was stored by an earlier run, when its true start was inside the window.
  **Verification.** Three mutations of the real files, each failing exactly one test and no others —
  parser keeps the clipped row; writer reverts to the rolling instant; writer stops passing
  `windowStartMs` — bytes restored by `cp` and md5-verified after each. The pre-existing suite needed
  ten fixture edits: every one placed its first log exactly on the window start, which is precisely
  the case that is now unreadable, so the windows moved an hour earlier rather than the assertions
  changing. ⚠ The suite's one window test could not have caught this: its `endIso` was midnight,
  where `now - 30d` and the calendar anchor agree. Production never is. The new test uses 09:17:00.123
  and 09:51:00.202 on the same day and asserts both runs ask for the same instant.
  **Two corrections to earlier passes, both in place.** §2.3's "ingest is correct, the rows are
  perfectly unique on (driver, started_at, ended_at)" — they are unique *because* the writer minted a
  fresh `started_at` every run; uniqueness on a column the defect generates proves nothing. And
  §2.4's age table reads `created_at` while `hos_duty_segments` prunes on `started_at`: 168 days, not
  48. Both conclusions survive; both numbers were measured on the wrong column.
  **Q2 is answered, not ruled on** — null-driver rows are read (`mapSegments` files them under
  `bySamsaraDriver`, and 31 Samsara drivers reach a truck through `driver_vehicle_assignments` with
  no `driver_id` at all, 4,208 rows/month), genuine unattributed ELD time is 231 rows in 45 days, and
  the writer had already ruled on staging them in a 2026-08 comment the plan never read. 400→120 is
  declined with its own number: 9,406 of 17,297 fills are older than 120 days and Q6 rescores them
  hourly, so the window would trade real logbook verdicts for 11.8% of a table.
  **Q7 opened**: L4 stops the production but deletes nothing — the ~1.4 M existing artefact rows are
  below the sweep's floor and 400 days from retention. Recommended (a), a bounded audited delete;
  it is an owner's call, not a merge's side effect.

- **2026-09-22 — L4c: L4 removed 1 of 30 boundary artefacts, and the other 29 were never the same
  kind of thing** (`claude/data-lifecycle-l4c`). The step was the handoff's ten-minute verification of
  L4 in production. It failed: rows were still landing at instants shared by ~1,100 drivers, now at
  calendar midnights, 33,245 of them in the first post-fix run. The millisecond column is what gave it
  away — `.000 .001 .002 .003 .004 .005 .006` and then `.000` again, a seven-day sawtooth resetting
  exactly on `HOS_FETCH_CHUNK_DAYS`. Settled by probing the live API read-only at two request phases
  rather than by reasoning: a start of `2026-09-10T00:00:00.000Z` returns 1,105 records at
  `2026-09-11T00:00:00.001Z`; moving the start to `13:37:11` moves them to `13:37:11.001` and
  `.002`. **Samsara clips the in-force status at every `startTime + k × 24h`, not only at k = 0**, and
  §2.9 is corrected in place to say so.
  **Why they could not be dropped the way k = 0 was.** Each clipped record carries an explicit
  `logEndTime` and the status continues past it: of 1,105 boundary records in that window, 1,105 had
  the same status, the same vehicle, and a gap of **exactly 1 ms** from the log before them. They are
  continuation fragments, so dropping them deletes real coverage; keeping them stores one fake duty
  change per driver per day and files a three-day rest as three rows. `parseHosLogs` therefore
  COALESCES: same status, same truck, gap ≤ `CONTINUATION_GAP_MS` (1 s, against a measured 1 ms) is one
  segment. The rule needs no knowledge of the request phase, which is why it also swept up a second
  family nobody had named — the ELD's own daily restatement at local midnight (05:00 UTC).
  **Measured on a real 30-day production window, both parsers over byte-identical raw data:**

  | | main | L4c |
  |---|---|---|
  | segments | 128,154 | **48,766** (−61.9%) |
  | instants shared by >500 drivers | 61 | **1** |
  | rows at those instants | 67,336 | **1,039** |
  | duty seconds asserted | 2,904,115,514 | **2,904,115,542** (+28 s) |

  Coverage is identical to within the 1 ms gaps now filled — which is the assertion that matters, and
  the one that caught a defect in this step's own first draft. Coalescing initially ran across the
  window-start fragment too, so a driver holding one status for the whole window merged into the run
  L4 drops and was discarded entire: coverage fell to 0.42 Gs, an 85% loss, concentrated in exactly the
  ~916 Samsara ids with no roster activity that §2.9 flags as reachable through
  `driver_vehicle_assignments`. The parser now refuses to coalesce into the dropped run, and the
  ≤24 h the window's first fragment still surrenders is the trade L4 made and §2.9 already accepts.
  **Verification.** Four mutations of the real file, each killing exactly the test written for it and
  no others — coalescing disabled; `CONTINUATION_GAP_MS` widened to an hour; the vehicle guard removed;
  the window-start drop moved back inside the fragment loop — bytes restored with `cp` and md5-verified
  after each. The surviving cluster is the first local midnight after the window start: the head of
  each driver's coverage, above the orphan sweep's floor, superseded rather than stranded.
  **What this does not do.** It does not delete the 33,245 rows the post-fix run already wrote, nor
  Q7's ~1.4 M. Those are orphans under the new parser and inside the sweep's window, so the sweep
  removes the 33,245 on its own; Q7's remain below the floor and still need the owner's ruling.

- **2026-09-22 — L5 is DECLINED, and the step is the measurement that declined it**
  (`claude/data-lifecycle-l5`). The queue called this one "no dependencies, cheap": drop two dead
  indexes, reclaim ~276 MB. Re-measuring before dropping — which the step's own instruction demanded
  — found neither index dead and both load-bearing, so **nothing is dropped and no migration is
  written**. The counterfactual was taken safely, without dropping anything and without taking an
  `ACCESS EXCLUSIVE` lock on a 5 M-row production table, by running `EXPLAIN (ANALYZE)` inside
  `begin; set local enable_bitmapscan = off; … rollback;`.

  | index | with it | without it | |
  |---|---|---|---|
  | `idx_audit_action_trgm` (113 MB) | 457 ms | **57,287 ms** | 125×, 2,531,818 rows dropped by filter |
  | `idx_scoring_attempts_org_started` (169 MB) | 139–352 ms | 3,879–6,263 ms | 11–45× |

  **Both premises in `D-LIFE8` were wrong.** `audit_logs.action` has **100 distinct values, not 8**,
  over 5,063,829 rows — so a trigram index is the correct structure, and the audit UI's filter is
  `ilike('action', '<prefix>%')`, served from exactly that index. And `idx_scan` counts how often a
  PAGE IS VISITED, not whether an index earns its keep: 40 scans and 10 scans in 122 days are two
  rarely-opened screens (`AuditPage.vue`, `scoringHealth.ts`), and on the visits they do get, these
  indexes are the difference between a third of a second and a minute.
  ⚠ **This measurement nearly went the other way, and the reason is worth keeping.** The first
  comparison on `scoring_attempts` showed the fallback FASTER (4.10 s seq vs 6.17 s index) and an
  index-only scan doing 129,396 heap fetches, which reads like an index that has stopped paying for
  itself on a write-heavy table. It was a cold index against a warm heap. Alternating the two plans
  three times each reversed it: warm, the index is 139 ms and the sequential scan is still ~4–6 s.
  **One timing against another timing is not a measurement unless both are warm** — the same lesson
  as calibrating a renderer against a ruler rather than against a second renderer.
  **What this means for `L8`.** The growth judge must NOT raise "index with zero scans" on `idx_scan`
  alone: built that way it would raise exactly this finding, and a future reader would action it and
  take a 125× regression on the audit page. A judge needs the counterfactual, and the
  `set local enable_*scan = off` recipe above is how it can be taken safely.
  **The space L5 promised does not exist.** `scoring_attempts` is already at its steady state — L3's
  45-day window HAS fired (oldest row 2026-08-09, a 44-day span against `keepDays: 45`), and the
  table is 1,023 MB with 389 MB of indexes, all three of which are used. There is no index drop
  available on either table, so the remaining lever on this storage is `L7`, which still needs `Q1`.

- **2026-09-22 — Q6 answered: every EFS import re-scores each affected vehicle's whole history,
  oldest-first, and never reaches the recent fills** (`claude/data-lifecycle-q6`). Investigation only;
  nothing in the scoring path is changed, because every candidate fix alters scoring behaviour.
  The plan's leading hypothesis — the Samsara recon tier — is **ruled out on volume**: both
  `SAMSARA_RECON_*` variables are unset in production, so the defaults give 250 fills an hour against
  a measured 2,000–7,500.
  **The mechanism.** `scoreVehicle` (`backfill.ts:400`) pages a vehicle's `fuel_transactions` with **no
  date predicate**, ordered `fueled_at ascending`, and scores every row; `scoreImportWithCascade`
  (`backfill.ts:443`) calls it once per vehicle the import touched. One import touches ~58 vehicles
  holding **5,640 fills**; the run scored **973 of them (17%)** before being reclaimed. 146 done at
  0.9 min and 56 failed at 72.5 min in 24 hours. The replacement restarts from the oldest fill, which
  is why **94.6% of attempts are on fills older than 120 days** and 18 of 6,480 were on fills newer
  than two days. The cascade is deliberate and documented; what is not deliberate is that it takes the
  whole history rather than the "neighbouring fills" its own docstring names.
  ⚠ **It is a correctness finding too.** Killed at 17% of an oldest-first walk, the cascade never
  reaches the recent fills whose MPG baseline and over-fuel window it exists to correct.
  **Three measurements corrected earlier drafts of this same entry, and the last one reversed its
  recommendation.** (i) Run COUNTS hid it — a job that runs an hour and dies looks like any other row;
  `where extract(epoch from (updated_at - created_at)) > 300` is what surfaced it. (ii) The first
  write-up blamed `efsSync.ts:250`'s import-wide select and "~2,300 rows of one import"; one window's
  scored set spans **26 import_ids**, which killed that claim. (iii) The recommendation was "raise the
  lease first" until the 973-of-5,640 measurement showed that finishing means ~112 minutes of scoring
  per import against an import opened every ~30 seconds — **(b) is now the one option that must not
  ship alone.** Recommendation is (a) bound the cascade, with (c) newest-first as the mitigation.
  ⚠ `locked_by` is null on these rows — production is `JOB_EXECUTION_MODE=inprocess`, so `runJob`
  owns them and the queue's 30-minute lease and `inprocessDrain.ts`'s renewal never apply. Two lease
  clocks, and the renewed one is not the one that decides reclaim. The amplifier, not the cause.

- **2026-09-22 (later) — the cascade's scope is not the defect either; scoring is not idempotent**
  (`claude/data-lifecycle-q6`, second revision). Asked to analyse before building, the measurement
  overturned the fix this plan had just recommended. 775,573 attempts over seven days, each compared
  with the previous attempt for the same transaction: **41.3% changed nothing**, 43.5% moved only
  because the engine version moved, and **13.1% moved under an UNCHANGED engine version** — a genuine,
  input-driven change. The 43.5% is not a defect: 38–50 commits land on `main` a day, every merge
  redeploys, and the commit is in the stamp on purpose (`persist.ts:59`).
  **What killed the fix.** Bounding the cascade to recent fills assumes old fills are settled. By
  change rate per attempt they are the least settled band measured — **18.70% for fills older than
  120 days**, against 0.10–0.13% for the 15–120 day range and 17.33% for fills under two days. A
  verified sequence shows one fill's hash moving four times in ten hours under one engine version.
  ⚠ The shape may still be selection — the cascade walks oldest-first and dies at 17%, so old fills
  are most of what gets scored — but the premise the fix rested on is gone either way.
  **The question is idempotence, not scope.** Identical code on an identical fill is producing
  different outcomes, so an input is sliding. Leading candidate: `learnVehicle` recomputes
  `baseline_mpg`, `tank_fill_ratio` and the capacity figures from a ROLLING last-30-fills window, so
  each new fill shifts values every historical score reads. **Unverified.** A 56-minute window after
  Q-TEL4's gate deployed shows 1.12% against 6.00% before — suggestive, confounded by window length
  and job mix, and **not to be treated as a result until re-measured over ≥ 24 h**.
  **Three recommendations for Q6 were recorded in one day and the first two were wrong**: raise the
  lease (the mechanism was not a lease lapse), bound the cascade (the bounded-out fills are the ones
  that change), and now measure idempotence before building. Each was overturned by the next
  measurement and each was written more confidently than its evidence. That belongs next to the
  defects in `D-LIFE11`: a mechanism believed but not measured is a hypothesis, and writing it into a
  plan does not promote it.

- **2026-09-22 (later still) — scoring IS idempotent; the instrument was the defect, and Q6's answer is
  three stuck runs, not a design** (`claude/q6-idempotence`, third revision, and the last one that is
  supported by a measurement rather than by an argument). The task set for this session was "score one
  fill twice under one engine with no import between, and diff the outcome". That experiment cannot be
  run in production without writing, so it was run as a natural experiment instead: every pair of
  CONSECUTIVE scoring attempts on the same transaction under the same `engine_version`, over 24 h
  (48,797 pairs).

  **Result: 0.34%.** Outside three imports named below, 28,290 same-engine pairs produced 97 hash
  changes. Of those 97, 72 were fills that had a live Samsara reconciliation inside the window — the
  artefact described next — leaving **24 pairs, 0.085%, of movement that is not otherwise explained**.
  The engine re-scores a fill to the same answer. The sliding-input hypothesis (`learnVehicle`'s
  rolling last-30-fills window shifting what a historical score reads) is NOT what these numbers show,
  and it is withdrawn.

  ⚠ **`result_hash` cannot answer the question it was asked, and every rate computed from it is void.**
  `scoringResultHash({ txnId, engineVersion, caseFired, outcome })` (`persist.ts:79`) hashes the
  outcome patch, and `buildTxnOutcomePatch` (`persist.ts:141`) carries `samsara_recon_checked_at` —
  which `resolveReconciliation` sets to `new Date().toISOString()` on EVERY pass that is not
  `skipRecon` (`reconcile.ts:322`, `:330`, `:336`), whether the live refresh succeeded, returned no
  data, or failed. Two attempts on one fill under one engine therefore **cannot** share a hash unless
  both ran under `skipRecon`. The hash is a payload identity, exactly as its docstring says; it was
  read here as a verdict identity, and it is a clock. This is the same shape as the labelPdf flake:
  an indirect timestamp inside a value that is compared for equality.

  **So the age-band table is an artefact, and fix (a) is un-killed.** Split the same 24 h by whether a
  fill belongs to the three imports below: **62.37% change on 20,507 pairs inside them, 0.34% on
  28,290 pairs outside**. Those three imports cover 2026-01-01 → 2026-05-18 — i.e. they sit entirely
  inside the ">120 d" band, and they ARE the 18.70% that the second revision used to rule out bounding
  the cascade. The 0.10–0.13% measured at 15–120 days was never evidence that old fills settle; it is
  what a `skipRecon` rebuild path looks like when its hash is stable. **Bounding the cascade is back on
  the table on its merits; nothing measured has been shown to argue against it.**

  **Q6's actual answer.** Three `efs_processing_runs` rows have never completed and are being retried
  forever:

  | run | import | created | attempts | fills | span |
  |---|---|---|---|---|---|
  | `7516924d` | `d184c165` | 2026-08-28 17:25 | 233 | 2,151 | 2026-01-01 → 02-03 |
  | `6f0c6a6c` | `187127b6` | 2026-08-28 17:23 | 235 | 853 | 2026-05-06 → 05-18 |
  | `b9f1f710` | `57317aa4` | 2026-09-05 13:51 | 235 | 1,172 | 2026-04-17 → 05-05 |

  Every other run in the table — **7,566 of them** — is `succeeded`. These three are the only rows not
  in a terminal state, and they are the whole of the "continuous full-fleet rescan":

  - **47,522 scoring attempts in 24 h across their 4,176 fills** — 11.4 complete passes per fill per
    day — against 97,182 attempts fleet-wide. **48.9% of all scoring in the product is these three
    rows.**
  - `processEfsProcessingRun` → `scoreImportWithCascade` → `scoreImport`, and `scoreImport` passes no
    `skipRecon` (`backfill.ts:364`), so **each of those 47,522 attempts makes a live Samsara
    reconciliation call** on a fill that is four to nine months old. The cascade half DOES pass
    `skipRecon: true` (`backfill.ts:453`) and is not the expensive half — that correction matters,
    because the docstring naming `skipRecon` sits above the cascade and was read as covering both.
  - The receipts are on the rows: `samsara_recon_evidence_version` averages **85.2 / 116.7 / 132.5**
    across the three imports and reaches **235** — that column increments only on a SUCCESSFUL live
    refresh (`reconcile.ts:172`). 3,906 fills older than 120 days were live-reconciled in the last
    24 h; in the 15–120 day range the figure is **zero**. The fills nobody can see are the only ones
    being refreshed.
  - A run is offered again because nothing consults `attempts`. The column is incremented and never
    read: there is no ceiling, no dead-letter state, and no terminal status short of success. A run
    that has failed 235 times is dispatched a 236th time on the same terms as its first.

  **Why they cannot finish, and why "let the job finish" still fails.** The `jobs` row for these runs
  is reclaimed on age (`STALE_JOB_MS = 2 h`, `jobs.ts:137`) because `lease_expires_at` is null under
  `JOB_EXECUTION_MODE=inprocess` — but the observed lifetimes are 28, 29, 36, 50, 72, 74, **190 and
  374 minutes**, so age is not the binding constraint. Two overnight runs got 3.2 h and 6.2 h
  uninterrupted and still did not reach the end. A pass is ~2,151 live recons plus a full-history
  cascade over 139–155 vehicles; the daytime runs are cut short by ordinary deploys (38–50 commits a
  day on `main`), and the quiet-hours runs simply are not long enough. **No lease value fixes this**,
  which is the second revision's conclusion reached by a different road.

  **Step 2 (re-measure Q-TEL4 over ≥ 24 h) is answered and does not need the wait.** Q-TEL4 gated
  writes to `vehicles`; the churn being counted is `samsara_recon_checked_at` on `fuel_transactions`.
  The two do not touch, so the gate cannot have moved that rate by any mechanism. The window was also
  unusable on its own terms: the stuck-import share of same-engine pairs was **42% before 16:13 UTC and
  67% after** — job mix, exactly as suspected. **1.12% vs 6.00% was never a result and should not be
  cited.**

  **Recommendation — none of (a), (b) or (c) first.** Ordering a loop differently does not stop the
  loop: (c) newest-first, offered as safe to ship alone, would only re-reconcile the NEWEST of the
  Jan–May fills 11 times a day instead of the oldest, and it is withdrawn as a first step for these
  three runs. The order is:

  1. **Resolve the three runs.** They are three rows, not a design, and they are 48.9% of scoring and
     substantially all of the Samsara reconciliation spend. This is a production write → owner ruling
     (see Q6a).
  2. **Give a run somewhere to die** — an attempt ceiling and a terminal state, so the 236th attempt is
     impossible (Q6b). This is the missing capability; retrying forever is not a policy anybody chose.
  3. **Stop re-fetching evidence that already succeeded.** `claimReconBatch` has exactly the right
     predicate — `samsara_recon_at is null` (`backfill.ts:76`) — and `scoreImport` has no predicate at
     all. A fill reconciled successfully 133 times over does not need a 134th (Q6c).
  4. **Then** re-open bounding the cascade (a) on its own merits, with an instrument that works.

  ⚠ **Fix the instrument before measuring anything here again** (Q6d). While
  `samsara_recon_checked_at` is inside the hashed payload, "did this fill's verdict change" has no
  answer in `scoring_attempts` — the next person to ask will measure the clock, as this plan did three
  times.

  ⚠ **A method note that belongs with `D-LIFE11`, since it cost most of a day across two sessions.**
  The first classification attempt in this session split pairs by whether any of the vehicle's fills
  had moved in between, using `fuel_transactions.updated_at` — and found 28% change with "nothing
  touched". That number is meaningless: `updated_at` is last-write-wins and holds one instant per row,
  so it cannot report a write that happened inside an interval and was overwritten. The split was
  discarded. **A column that stores only the most recent event cannot answer a question about whether
  an event occurred in a window** — the same error as reading a count to answer a question about state.

- **2026-09-22 (later still) — Q6b SHIPPED: a processing run now has somewhere to die, and Q6a
  resolves itself as a consequence** (`claude/q6b-run-attempt-ceiling`, migration 0354). The ceiling
  and the terminal status ship in ONE migration because the CHECK must already permit `abandoned`
  before anything writes it, and one file is what guarantees that order. **100 attempts**, and the
  number is measured rather than picked: among the 7,566 runs that DID succeed the worst needed
  **66**, with 56/54/53/46/46/45 behind it, so a ceiling of 5 or 10 would abandon work that goes on
  to complete — silently, which is the worst thing this change could introduce. Erring long only
  delays abandoning a dead run; erring short destroys a live one. Same asymmetry migration 0317
  states for the lease.
  **The ceiling lives in `claim_efs_processing_run`, not in TypeScript**, because the failure mode
  never reaches TypeScript: `processEfsProcessingRun`'s catch block writes `failed` with a backoff,
  and these three runs die mid-pass with the process, so they advance only through 0317's
  stranded-reclaim branch — which is exactly why `attempts` climbs while `last_error` stays null. A
  ceiling anywhere else is a ceiling the real failure walks around. It is tested on the claimed row
  under its lock and BEFORE the increment, so the run is abandoned on the attempt that would have
  been 101, and two racing workers cannot both spend it.
  **Q6a needs no owner UPDATE after all.** All three runs are past 100, so each self-abandons on its
  next claim — within ~20 minutes of the migration applying. The recommendation recorded against Q6a
  (mark the rows terminal by hand) is withdrawn in favour of the same rule that will catch the
  fourth one.
  Pinned by `supabase/tests/efs-run-attempt-ceiling.test.mjs` — 14 assertions, and four mutations
  prove they can fail: `>=` → `>` (4 fail), exempting the `running` branch (1), overwriting
  `last_error` instead of coalescing (1), and removing the ceiling entirely (6). `last_error` is
  written only when empty, because a run that recorded a real diagnosis has said something more
  useful than the sentence this migration writes.
  ⚠ **Still owed, and deliberately not in this merge:** the abandoned state is quiet. `dueRunIds`
  stops offering an abandoned run for free, which is the whole behaviour change, but
  `getEfsSoapStatus` counts only `pending`/`running`/`failed`, so an abandoned run drops out of the
  operator surface entirely — trading a loud permanent loop for a silent permanent stop. That is the
  next merge, and it reads a value that already exists by then.

- **2026-09-22 (later still) — Q6b's second half: an abandoned run is now LOUD**
  (`claude/q6b-abandoned-visibility`). 0354 gave a permanently-stuck run somewhere to die; on its own
  that traded a loud failure for a silent one. `getEfsSoapStatus` selected
  `pending`/`running`/`failed`, so an abandoned run **drops out of the query entirely** and the
  operator watches the batch count fall to zero — the same picture as work that finished. The three
  runs the ceiling was written for were invisible for 25 days while being 48.9% of all scoring, and a
  fix whose only visible effect is a number going down would have preserved exactly that.
  `processingAbandoned` is counted separately and is NOT folded into `processingPending`: nothing will
  pick an abandoned run up, so counting it as pending reports work in progress that does not exist.
  Its `last_error` outranks a `failed` run's, because a failed run is mid-ladder and its error may be
  transient while an abandoned run's error is the final word on that import.
  ⚠ **The `EfsSoapStatus` shape is declared TWICE** — inline in `efsSoapCredentials.ts` and again in
  `apps/web/src/features/settings/useEfsSoap.ts` — against the rule that `packages/shared` is the only
  home for an api/web contract. That predates this merge and is not made worse by it, but it is a
  copy with a delay fuse and it is recorded here rather than left silent; the field had to be added in
  both places by hand, which is exactly the cost the rule exists to prevent.
  The web field is declared OPTIONAL for the deploy window: for the few minutes a new SPA is served by
  the old API it is simply absent, and a missing field read as `undefined` renders nothing, where a
  required field read as `0` would assert "nothing abandoned" — the one answer that is actively wrong.
  Pinned by three cases in `efsSoapCredentials.test.ts`; the fixture HONOURS the `.in("status", …)`
  filter rather than returning a flat array, so dropping `abandoned` from the query fails two of them
  (a flat array could never catch that). Mutations: drop it from the filter (2 fail), count abandoned
  as pending (1), remove the error precedence (1).
  ⚠ Adding one field pushed `efsSoapCredentials.ts` to 509 lines, over the 500-line budget
  (`lint:filesize`). Split rather than waived, along a seam that was already there:
  `efsSoapStatus.ts` now holds everything that READS and renders (369 + 153 lines), while
  `efsSoapCredentials.ts` keeps what stores, seals and rotates. **Nothing in the new module touches a
  password** — that is the property worth keeping the two apart for, not the line count.
  **VERIFIED IN PRODUCTION 2026-09-22 18:2x UTC: all three runs are `abandoned`** at attempts 234,
  236 and 236, within ~20 minutes of 0354 applying, exactly as 0354's header predicted and with no
  manual data write. Q6a is CLOSED.

- **2026-09-22 (later still) — Q6c SHIPPED: a settled fill is no longer re-asked every pass**
  (`claude/q6c-recon-refresh-bound`, `SAMSARA_RECON_REFRESH_HOURS`, default 24). `scoreImport` passes
  no `skipRecon` and, unlike the collector tier, had **no bound at all**, so every re-score of an
  import re-fetched every one of its fills from Samsara.
  **Measured BEFORE it was written, which is the part that matters given Q6's history.** The
  production reconciler — `reconcileWithSamsara` itself, which contains no insert/update/upsert/rpc
  and is therefore safe to run read-only, not a re-implementation of it — was re-run over **55 fills
  sampled from the three stuck imports**: 30 `tank_confirmed` and **all 25 `stop_estimated`**,
  spanning January to May, carrying 56 to 199 previous refreshes. It returned evidence **identical to
  what was stored in 55 of 55 cases** — no field changed, no basis upgraded. The `stop_estimated` half
  is the decisive one: those are the fills a refresh could legitimately have improved, and ~105
  refreshes each had not improved one of them. The refresh is a no-op on settled evidence, measured
  rather than argued.
  **The default is 24 h and not 0 for one reason**: a live refresh is still the path by which a
  CORRECTED STATION PIN reaches an old fill. One refresh per fill per day keeps that path open and
  removes ~91% of the calls. `0` disables the bound and restores the old behaviour.
  ⚠ **The condition is "has this fill EVER succeeded", not "was it checked recently", and that is
  what keeps the collector tier alive.** `claimReconBatch` selects `samsara_recon_at is null`
  (`backfill.ts:76`), so a bound keyed on recency alone would have refused the tier's own claims —
  the tier would claim a fill and the reconciler would decline to fetch it, silently undoing SAM-S3
  and re-opening the historical hole it exists to close. Keying on prior SUCCESS makes the two
  populations disjoint by construction. It is its own env knob rather than a reuse of
  `SAMSARA_RECON_RETRY_HOURS` for the same reason: retry asks "when do we try a fill that never
  worked", refresh asks "when do we re-ask one that already answered".
  ⚠ **Checked, not assumed: the skip branch does not change any rule input.** The live branch ends in
  `applyReconciledContext`, which the skip branch does not call — but `toTxnView` already derives
  `eventAt`, `timeConfirmed`, `fueledAtPrecision` and the station pin from the STORED columns by the
  identical predicate (`tank_confirmed || (samsara_recon_at != null && samsara_location_matched)`),
  and says so in its own comment: "derived from stored columns, so prior fills reconstruct correctly
  on rebuild". That equivalence is what the `skipRecon` path has always relied on.
  `suppressSystematicStationOffset` still runs — it sits outside the branches.
  Pinned by 7 cases in `reconRefreshBound.test.ts`. Four mutations: drop the ever-succeeded condition
  (fails the collector-tier exemption), remove the bound (1), invert the window (2), treat an
  unparseable stamp as fresh (1).

- **2026-09-22 (later still) — Q6d part 1: `verdict_hash` column** (`claude/q6d-verdict-hash-column`,
  migration 0356). Schema only; the writer is the next merge, because a merge is SERVED ~3 minutes in
  while `migrate.yml` waits for CI green, and a writer shipped here would insert a column the database
  does not have — every scoring attempt in the fleet failing for that window.
  **A SECOND column, not a redefinition of the first.** Dropping the recon metadata out of
  `result_hash` is one line and would silently redefine the 2,427,180 hashes already stored: old rows
  computed under the old definition, new rows under the new, and nothing in the table saying which is
  which. A comparison across that boundary would be meaningless and would look fine. `result_hash`
  keeps the payload identity its docstring claims — the right answer to "would this write have changed
  the row" — and `verdict_hash` answers the other question.
  Nullable, no default, no backfill: null means "written before the verdict hash existed", which is
  true and is the only honest value for 2.4M existing rows. No new index — the question walks one
  transaction's attempts in order, which `idx_scoring_attempts_transaction_started` already serves.
  ⚠ A first draft of this migration cited L5's 139 ms → 3,879 ms timing as evidence that the
  transaction index is live. That measurement is `idx_scoring_attempts_org_started`'s — a different
  index and a different query. Corrected before commit, and noted here because a borrowed number
  reads exactly like a measured one.

- **2026-09-22 (later still) — Q6d part 2 shipped; fix (a) re-argued, and NOT built**
  (`claude/q6d-verdict-hash-writer`, #971, merged `00ca2a8`). Opened only after 0356 was confirmed
  applied — production `information_schema` showed `verdict_hash text NULL` and both services'
  `/api/version` reported `schema.state = "current"`. Rebased on main before opening, which surfaced
  one stale citation: the code comments said "0355", taken mid-PR by `reserved_units_ordered`; they
  now say 0356. **VERIFIED IN PRODUCTION 2026-09-22 19:44 UTC:** the first 27 attempts after the 19:40:18 deploy all `succeeded`, all 27 carry a `verdict_hash`, 0 failed, one engine version.
  **Fix (a) is un-killed but its case has changed, and the instrument to decide it only starts
  accumulating now.** Three things, each checked rather than carried over:
  1. **The urgency fell by ~6× when Q6a closed.** Last hour before this entry: **670 attempts** (≈16k a
     day, against 97,182 when the three stuck runs were alive), and **all 11 EFS runs `succeeded`**,
     3.4 min average, 23.1 max. The cascade now FINISHES, so the correctness half of the original
     argument — "killed at 17%, never reaches the recent fills" — no longer holds. What remains is
     cost: 410 of the 670 (61%) are still fills older than 120 days, because `scoreVehicle` still walks
     the whole history. That half runs `skipRecon`, so it is database and CPU, not Samsara quota.
  2. **A fill's verdict reads three things, and a date bound is wrong for two of them.** From the code:
     (i) its PREDECESSORS in business time — 12 before and 12 after `fueled_at`, the latter filtered
     back to earlier-in-business-time rows (`consumptionContext.ts:134`, `:140`, `:145`) — and it reads
     their VERDICTS (`odoBad`, `contaminatesBaseline`), so a changed verdict can propagate forward
     fill-to-fill with no fixed horizon; (ii) a TWO-SIDED `cumulativeWindowHours` window, default
     48 h, around its anchor (`scoreTransaction.ts:308`), so an imported fill also moves fills up to
     48 h BEFORE it; (iii) the vehicle's CURRENT learned gates — `tank_sensor_reliable`,
     `tank_residual_sigma`, `observed_max_fill_gal`, `sensor_capacity_*`, `odometer_offset`
     (`context.ts:27`) — not their values as of the fill. `baseline_mpg` is write-once
     (`persist.ts:376`) and is not one of them.
     So a fixed "N days" bound under-reaches (i) and cannot express (iii), which is vehicle-wide.
  3. **The honest shape of (a), if the measurement supports it:** per affected vehicle, start at the
     earliest imported fill minus the window, walk FORWARD, and stop once K consecutive fills come out
     with an unchanged `verdict_hash` — a convergence bound, which is exactly what the column makes
     possible and `result_hash` never could. Plus a full-history pass ONLY when `learnVehicleValues`
     actually changed a gate, which is knowable since Q-TEL4's `setIfChanged`.
  ⚠ **(iii) is an owner question, not a detail.** Every live fill already re-learns the gates, and the
  live path cascades only 5 fills forward (`scoreWithCascade`, `backfill.ts:21`, `:25`). So between
  imports, history is ALREADY scored against stale gates; the import cascade is the only thing that
  re-syncs it, erratically, whenever an import happens to touch the truck. Whether a historical
  verdict is meant to reflect the calibration as it WAS or as it IS decides whether the full-history
  pass is a feature or the bug. **Recorded as Q6e in §7 and below; not assumed either way.**
  ⚠ Side finding, unmeasured: `scoreWithCascade`'s 5-fill forward bound is below the 12 predecessors
  a verdict reads, so the live path may under-cascade. Same measurement answers it.
  **The measurement, owed on or after 2026-09-23 19:40 UTC (≥ 24 h of `verdict_hash`):** consecutive
  attempt pairs on one transaction, SAME `engine_version`, both `verdict_hash` non-null; change rate by
  distance in fills from the vehicle's earliest fill in the triggering import, split by whether that
  vehicle's learned gates moved in the window. Build (a) as above if changes beyond ~12 fills are ~0
  outside gate moves; otherwise the bound is wrong and this entry is the fourth revision.
  **Q6e — what should a historical verdict be scored against?** (a) the gates as they are NOW —
  keeps the full-history pass on gate change, and argues the live path should do it too; (b) the gates
  as they WERE at the fill — needs as-of calibration history, which does not exist (the columns are
  last-write-wins); (c) accept drift: bound the cascade, re-sync history only on an explicit rebuild.
  **Recommendation: (c)** — (b) is the right answer and costs a new table; (a) makes every live fill a
  full-history rescore; (c) is what the live path already does, and makes the import path agree with it.
