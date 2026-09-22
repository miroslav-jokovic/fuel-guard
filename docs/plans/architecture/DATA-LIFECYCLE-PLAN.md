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
- **A sync produces a counter, not a row per entity.** One row per collector run in a new
  `sync_runs` table (`infra`, partitioned, 90-day retention) carrying `examined` / `changed` /
  `failed` counts — which is the number anybody actually wants, and which today cannot be read at
  all without counting 925,341 rows.

**The invariant, corrected by §2.2:** not "an audit row must have an actor" — system acts
legitimately have none. It is: **an audit row must record a change.** A scheduler-emitted action
must be diff-gated (a real before/after) or aggregated into a run counter. `vehicle.update` firing
485×/vehicle/day records no change and is therefore not an audit event.

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

---

## 5. The queue

Ordered so the discipline lands before the cleanups; otherwise the next table repeats the pattern.
Each step is one PR unless stated.

| # | step | effect | depends on |
|---|---|---|---|
| **L1** | `lifecycle` block in `table-modules.json` for all 174 tables + `lint:table-lifecycle` + CI registration | the missing discipline | — |
| **L2** | Diff-gate the entity-sync audit writes; add `sync_runs` (`D-LIFE4`) | **~10 GB/yr**, in the one table that cannot be pruned | L1 |
| **L3** | `scoring_attempts` → `RETENTION_RULES` at 45 d; investigate the 136×/txn rescore loop | **~12 GB/yr** + wasted compute | L1 |
| **L4** | Null-driver `hos_duty_segments` ruling (Q2) + retention 400→120 d | **~4.5 GB/yr** | L1, Q2 |
| **L5** | Drop the two dead indexes (`D-LIFE8`) | ~276 MB now | — |
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

**Q2 — null-driver `hos_duty_segments`.** 1.13M rows, 68.7% of the table. Does anything read duty
segments with no driver? `idleDutyEvidenceSync` keys the duty overlay **by driver**, so a null-driver
row cannot participate — but that needs confirming at the call site before deleting, and it is
possible they are staged awaiting a driver mapping that arrives later. Recommend: **stop ingesting
them** if the mapping never arrives, or stage them with a 30-day TTL if it does. Either way L4 is
~4.5 GB/year and the largest single win after L2/L3.

**Q3 — what compute tier is this project on?** Not measured. `D-LIFE0` is about working set vs. RAM,
and the thresholds in `D-LIFE5` should be tightened if the instance is Micro or Small. One reading
from the Supabase dashboard settles it.

**Q4 — is PITR enabled?** At $100/mo per 7-day window it changes the §2.8 arithmetic materially, and
it makes restore time a first-class reason for L7 rather than a secondary one.

---

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
