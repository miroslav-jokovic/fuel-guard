# telemetry separation — the entity tables stop carrying the machine's live state

**Status: ACTIVE PLAN.** Decision-log document per house convention. Decision IDs `D-TEL*`.
Opened 2026-09-22. Owns two things that were left open by other plans and cannot be closed by
either of them alone:

- **`DATA-LIFECYCLE-PLAN.md` Q5(b)** — the real fix that migration **0352** (Q5(a), the
  `audit_row_change` ignore list) is a labelled workaround for. 0352's own header names this
  document's work as what removes it.
- **`SEPARATION-PROGRAM-PLAN.md` P2.2 / `D-SEP3`** — migration **0262** built two satellite tables
  for the learner columns on `vehicles` and left their legacy columns in place, `DEPRECATED`, mirrored
  by a trigger "until the last writer migrates". **The writers never migrated.** This is that step.

Where this document and a `lint:*` gate disagree, the gate wins and this file has rotted.

Everything in §2 was measured against production on 2026-09-22. The measurement changed the shape of
the work twice: it found the target pattern already half-built, and it found the half-built state
costing **more** than either end state.

---

## 0. Why this exists

`vehicles` is a `core` entity table in the registry — 272 rows, `growth: "fleet"`, "bounded by fleet
size, it cannot run away". It also carries the truck's live odometer, its fuel level, the scoring
engine's learned calibration and a 24-column derived idle profile. One table, two lifetimes:
identity that changes a few times a year, and machine state that changes every few minutes.

That mixture has now produced three separate problems in three separate plans, and each plan fixed
the symptom visible from where it stood:

| plan | symptom it saw | what it shipped |
|---|---|---|
| `SEPARATION-PROGRAM-PLAN` P2.2 | a learner overwriting human-entered `tank_capacity_gal` | 0262 — two satellite tables + a mirror trigger, legacy columns `DEPRECATED` |
| `DATA-LIFECYCLE-PLAN` L2 | ~10 GB/year of `vehicle.update` audit rows | 0352 — a column ignore list on the audit trigger, **labelled a workaround** |
| this document | all of the above, plus what the half-migration costs | the retirement |

None of them was wrong. But the table is now being written by three mechanisms at once, and **the
transitional state is the most expensive of the three** (§2.3). The honest end state is the one
`D-SEP3` and `D-ARC3` already describe: a table has one owner, one writer class and one lifecycle.

---

## 1. What is already right, and must not be rebuilt

Recorded first, because the instinct on reading Q5(b) is to design a telemetry architecture, and
most of it exists.

- **The satellite pattern is built, backfilled and live.** `vehicle_tank_learned` (anomalies,
  `derived`, `fleet`) and `vehicle_idle_learned` (idle, `derived`, `fleet`) exist, are declared in
  `scripts/table-modules.json`, carry deny-all RLS, and hold **32 of the 39 `vehicles` columns** in
  0352's ignore list. They are not a proposal. ⚠ 32, not all 39 — the seven that have no home
  anywhere are the four live-feed columns plus `baseline_mpg`, `monitored_tank_capacity_gal` and
  `tank_capacity_source`, and that third group is why `TS4` is not a pure writer-flip (Q-TEL2).
- **The history tables exist too.** `samsara_odometer_readings` (raw, time-grained, 49,086 rows) is
  the odometer's real history; `vehicle_positions` holds GPS. `vehicles.current_odometer` is a
  **cache of a value that is already stored properly elsewhere** — which is why this plan adds a
  current-state satellite and not a time series.
- **The live feed already diff-gates and already has one pinned writer.** `samsaraStatsFeed.ts`
  compares before writing and routes through `writeVehicleTelematics` — a single function, carrying
  a comment explaining that it is the module's one grandfathered out-of-owner write. That is the
  seam this plan needs, and somebody already cut it.
- **Ownership is machine-enforced.** `scripts/table-writers.json`, `check-table-access.mjs` (raw
  tables sealed to their collectors) and `check-table-lifecycle.mjs` mean a new satellite cannot be
  added quietly or written from the wrong module.

**What this is not.** It is not a time-series or telemetry-store project. The volumes are 272 trucks
and 302 drivers; every table below is `fleet`-growth and stays under a kilobyte per row. Nothing
here needs partitioning, a column store, or a new datastore.

---

## 2. The measurements (2026-09-22, production)

### 2.1 The mixture, in columns

0352's ignore list is the curated inventory — it was derived from all five writers, by meaning
rather than by author. 43 columns, in four families:

| family | columns | writer | already has a home? |
|---|---|---|---|
| live feed | `current_odometer`, `samsara_fuel_percent`, `samsara_fuel_at`, `samsara_missing_since` | `samsaraStatsFeed.ts` → `writeVehicleTelematics` | **no** |
| tank / odometer calibration | 11 (`odometer_offset*`, `tank_fill_ratio`, `tank_sensor_reliable`, `sensor_capacity_*`, `observed_max_fill_gal`, `tank_residual_sigma`, `monitored_tank_capacity_gal`, `tank_capacity_source`, `baseline_mpg`) | `learnVehicle.ts`, `persist.ts` | **8 of 11** — `vehicle_tank_learned`; `baseline_mpg`, `monitored_tank_capacity_gal`, `tank_capacity_source` have none |
| derived idle profile | 24 (`idle_capability`, `idle_optimized_pct`, `idle_states_*`, `idle_evidence_*`, `idle_learned_envelope_*`, `idle_observed_mode`) | `idleCapabilitySync.ts`, `idleEquipmentEvidenceSync.ts`, `idleLearnedEnvelopeSync.ts` | **all 24** — `vehicle_idle_learned` |
| driver live status | `current_hos_status`, `current_hos_at`, `current_hos_vehicle`, `current_location` | `hosSync.ts` → `syncHosCurrentStatus` | **no** |

**39 columns on `vehicles`, 4 on `drivers`, 32 of the 39 already housed.** The homeless seven are
the four live-feed columns (no satellite exists) and three calibration columns 0262 deliberately left
behind: `baseline_mpg`, `monitored_tank_capacity_gal` and `tank_capacity_source` — the last of which
0262's own header says is holding provenance until the `0119` autofix follow-up lands. See Q-TEL2.

### 2.2 What the entity tables actually cost

`pg_stat_user_tables`, over a 122-day stats epoch (`stats_reset` 2026-05-22):

| table | live rows | updates | HOT | autovacuums | avg row |
|---|---|---|---|---|---|
| `vehicles` | 272 | **4,891,000** | 99.6% | **7,841** | **447 B** |
| `drivers` | 302 | 449,436 | 99.8% | 1,278 | 233 B |

**17,981 updates per vehicle row**, 147 a day. The live-feed family it is mostly writing is **44
bytes** of that 447-byte row; the driver HOS block is 46 bytes of 233. Postgres has no partial row
update — every odometer write rewrites the VIN, the plate, the insurance dates, the registration and
the spec columns, and fires the audit trigger, which since 0352 renders **both** row versions to
`jsonb` and compares 91 columns to decide it has nothing to record. 4.89 M times.

### 2.2b Which writer, measured directly rather than inferred

`DATA-LIFECYCLE-PLAN` recorded this as owed ("the exact writer mix behind 20.2 updates/vehicle/hour
is NOT established"). Settled by snapshotting all 91 columns of all 272 rows eight minutes apart
(14:27:42 → 14:36 UTC, 2026-09-22) and diffing every key:

| | rows changed |
|---|---|
| rows rewritten at all | **131 of 272** |
| `samsara_fuel_at` | 105 |
| `current_odometer` | 83 |
| `samsara_fuel_percent` | 62 |
| `odometer_offset` (calibration) | **1** |
| any idle column | **0** — the idle family moves hourly, ~216 rows |

**The live feed is the writer.** Four columns, 44 bytes, cause essentially all of it; the two
families that already have satellites contributed one row between them in that window. This is the
measurement behind `D-TEL2`, and it is why the queue starts with the family that has no satellite
rather than with the retirement.

⚠ And a second thing the full-row diff found, which no value-level query would show: **26 of the 131
rewrites (20%) changed nothing at all except `updated_at`.** A no-op UPDATE still writes a new tuple,
still fires `set_updated_at()`, still fires the audit trigger's 91-column comparison, and still fires
the 0262 mirror into both satellites. It is invisible to every diff on values. See Q-TEL4.

### 2.3 The half-migrated state costs more than either end state

This is the finding that reordered the work. 0262's mirror is a trigger on `vehicles` that upserts
the satellites on every write whose guard predicate holds — and the guard is "any learner column is
non-null", not "a learner column changed". **There is no diff gate in the mirror.** So a pure
odometer write, which touches no learner column at all, still rewrites both satellite rows with
`updated_at = now()`:

| table | live rows | updates | autovacuums |
|---|---|---|---|
| `vehicles` | 272 | 4,891,000 | 7,841 |
| `vehicle_idle_learned` | 272 | **2,725,881** | 4,260 |
| `vehicle_tank_learned` | 183 | **2,678,961** | 5,982 |
| `vehicle_positions` | 205 | 4,256,716 | 9,490 |
| **total** | **932 rows** | **14.55 M updates** | **27,573** |

Four tables holding 932 rows between them have taken 14.55 million updates and 27,573 autovacuum
cycles in 122 days.

The mirror is the demonstrable cause, not a suspicion: `trg_vehicle_learned_satellites` is declared
`after insert or update on vehicles for each row` with **no `WHEN` clause**, and the function's only
gate is a non-null presence check. And the satellites' own writers cannot account for the volume —
the idle syncs touch ~216 rows hourly, which over 122 days is ~632,000 writes against the
**2,725,881** measured. The other ~2.1 M arrive through `vehicles`. One truck reporting its odometer costs three row rewrites — 447 B + 2 satellites
— plus a 91-column trigger comparison, to record 44 bytes that were already written to
`samsara_odometer_readings` anyway.

⚠ The satellites currently **agree** with their legacy columns — 183 rows compared, `tank_fill_ratio`
and `sensor_capacity_gal` identical, **`odometer_offset` disagreeing on one vehicle**. One row of
drift in a mirror with no diff gate is not reassuring; it is the delay fuse in CLAUDE.md's "a copy is
a workaround with a delay fuse", already lit.

### 2.4 Blast radius, measured rather than feared

`DATA-LIFECYCLE-PLAN` Q5(b) estimated "every reader of `current_odometer` / `samsara_fuel_percent`
moves, a wide blast radius across fuel, live map and dashboards". Counted:

| | |
|---|---|
| source files mentioning any of the 43 columns (excl. tests, `dist/`) | **53** — 21 api, 19 web, 13 shared |
| `.from("vehicles")` sites in the API | 78, across 52 files |
| `.from("vehicles")` sites in the **browser** | 15 — the SPA reads this table directly over PostgREST |
| of those, selects naming a telemetry column | 5 (four idle-shaped, one `select("*")`) |

The number that matters is smaller than 53: the web reads most of these values from **API responses**,
not from the database, so a storage split that keeps the response contract stable does not touch
them. The API-side work is concentrated in the modules that own the values anyway — `samsara`,
`anomalies/scoring`, `idle` — which is exactly what `D-ARC3` ownership predicts.

⚠ **The `select("*")` in the browser is the one silent hazard.** `VehicleDetailPage` selects every
column; on the day the columns are dropped it keeps working and quietly renders nothing where the
odometer was. No test fails. This is named in `D-TEL5` and gets an assertion before the drop merge.

---

## 3. Decisions

### D-TEL1 — the end state is the one `D-SEP3` already describes: one owner, one writer class, one lifecycle

`vehicles` and `drivers` carry identity and human-entered facts. Machine state lives in a
per-domain satellite owned by the module that computes it, 1:1 with the entity, `fleet` growth, no
audit trigger, deny-all client RLS unless a reader needs otherwise. Two satellites exist; two are
missing; nothing else is invented.

**Why not one "telemetry" table for all four families.** Because ownership is the split criterion
this repo already enforces (`table-writers.json`, `check-table-access.mjs`, ARCHITECTURE §table
ownership). A single table would have four owning modules and four writer classes contending on one
row, and the first question any gate asks — "who writes this?" — would have no single answer.

### D-TEL2 — the live feed goes first, because it is ~90% of the cost and the smallest change

Ordering by measurement rather than by plan order. The live-feed family is four columns behind **one
pinned writer function**, and it is the family driving the 3-write cascade in §2.3. Retiring the
deprecated 35 columns is a larger change for a smaller share of the writes. So: new satellite for
the live feed first (`TS1`–`TS3`), then the 0262 retirement (`TS4`–`TS6`).

### D-TEL3 — the mirror trigger is removed in the same merge that flips a family's writer, never later

0262's mirror exists to keep the satellite current while the legacy column is still the source of
truth. The moment a family's writers write the satellite directly, the mirror is a second writer for
the same values and can only introduce drift (§2.3 already has one row of it). Each family's flip
merge drops its half of `sync_vehicle_learned_satellites()`.

### D-TEL4 — 0352's ignore list shrinks with each flip, and reaching `updated_at` alone is the definition of done

The ignore list is the workaround's visible surface, so it is also the progress bar. Every merge that
moves a family off `vehicles` removes that family's names from the trigger argument. When the argument
is `'updated_at'` alone, Q5(a) is retired and Q5(b) is closed. **A gate asserts it** (`D-TEL6`), so
the list cannot quietly grow back.

### D-TEL5 — the drop of a column is its own merge, after a soak, and after a reader assertion

Per `docs/MIGRATION-DISCIPLINE.md`: the deploy window means a merge can be served against the
previous schema, so a column and its first reader never ship together. Dropping runs the same risk in
reverse. Therefore, per family: **flip writers → soak → flip readers → soak → drop**, and before the
drop merge, an assertion that no reader (including the browser's `select("*")` and the shared
contracts) still expects the column. New tables are exempt from the window rule, so `TS1` is free.

### D-TEL6 — the enforcement moves from a hand-written list to a gate

The cost 0352 accepted was that its ignore list is "a second place that knows which columns are
machine-owned, and it will rot the first time somebody adds a telemetry column and forgets". That is
still true today. The end state replaces it with two machine checks:

1. `lint:table-lifecycle` (or a sibling) asserts the `audit_vehicles` / `audit_drivers` trigger
   arguments are exactly `'updated_at'` — any re-added telemetry column forces the conversation.
2. `table-writers.json` already requires a manifest entry per writer; after the flip, `vehicles` has
   no machine writer for telemetry at all, so adding one is a visible, reviewable act.

**This is the part that makes the fix permanent rather than another sweep.** 0352 fails *safe* — a
new telemetry column is audited by default — which means the ~10 GB/year returns silently rather than
loudly. A gate turns a silent regression into a red build.

---

## 4. The queue

| # | step | effect | depends on |
|---|---|---|---|
| **TS1** | Create `vehicle_live_telemetry` (samsara, raw, fleet) + `driver_live_status` (samsara, raw, fleet), RLS, registry, writers manifest, backfill | mechanism; new tables are window-exempt | — |
| **TS2** | `writeVehicleTelematics` and `syncHosCurrentStatus` write the satellites; legacy columns still written | dual-write, one merge, reversible | TS1 |
| **TS3** | Readers of the live feed move; then legacy columns stop being written and leave the 0352 list | **~90% of 14.55 M updates**, and the 3-write cascade collapses | TS2 |
| **TS4** | Flip `learnVehicle.ts` / `persist.ts` to `vehicle_tank_learned`; drop the mirror's tank half (`D-TEL3`). **Not a pure flip** — three of the eleven calibration columns have no satellite column yet (Q-TEL2) | ends 2.68 M satellite rewrites | TS1, Q-TEL2 |
| **TS5** | Flip the three idle syncs to `vehicle_idle_learned`; drop the mirror's idle half | ends 2.73 M satellite rewrites | TS1 |
| **TS6** | Drop the 39 deprecated columns; ignore list → `'updated_at'`; **0352 is retired** | the workaround is gone | TS3, TS4, TS5 + soak |
| **TS7** | The gate of `D-TEL6` | it cannot come back | TS6 |

**TS1–TS3 are the value.** If this is ever cut for scope, cut from TS6 backwards — but note that
stopping before TS6 leaves the repo in the §2.3 state, which is the expensive one. A cut here should
be a pause, recorded, not a silent stop. That is precisely how 0262 came to be half-done.

---

## 5. Risks

1. **The browser reads `vehicles` directly, including one `select("*")`.** Dropping columns is a
   silent behaviour change there. `D-TEL5` requires the assertion; `lint:table-access` already knows
   these 15 sites.
2. **Two writers for one value, during dual-write.** The window between TS2 and TS3 has the same
   shape as the drift already measured in §2.3. Keep it short, and reconcile before the flip.
3. **`baseline_mpg` has no satellite** and is read by 50 files — the widest single column in the
   inventory. It is Q-TEL2 and deliberately not swept into TS4.
4. **A flip merge that lands while the previous schema is being served.** `docs/MIGRATION-DISCIPLINE.md`
   §the-deploy-window: 2m44s, unwatchable. Every step above is ordered so that no merge both creates
   and first-reads a column.
5. **This plan touches the tables every other feature reads.** `vehicles` has 78 API access sites.
   The mitigation is that satellites are additive and the legacy columns are dropped last, not that
   the work is small.

---

## 6. Open questions — owner rulings required

**Q-TEL1 — does `current_odometer` need a satellite column at all, or a read of
`samsara_odometer_readings`?** The history table already holds every reading (49,086 rows, raw,
time-grained). A cached "latest" is a denormalisation, and denormalisation is what this plan is
unwinding. Against that: the live map and the roster read the current odometer per truck on every
page load, and "latest row per vehicle" over a growing history is the more expensive read.
**Recommendation: keep the cache, in `vehicle_live_telemetry`, and say in its comment that it is a
cache of `samsara_odometer_readings` with one writer.** A cache with a named source and one writer is
not a second source of truth; a cache with neither is how this started.

**Q-TEL2 — the three calibration columns 0262 left behind.** `baseline_mpg`,
`monitored_tank_capacity_gal` and `tank_capacity_source` are calibration by meaning but have no
satellite column, so `TS4` cannot be a pure writer-flip. `tank_capacity_source` is the deliberate
one — 0262's header keeps it on `vehicles` as provenance until the `0119` autofix follow-up lands, so
it moves with that step or not at all. The open question is `baseline_mpg`: the scoring engine's
learned fuel-economy figure, calibration by meaning, belonging in `vehicle_tank_learned` — but that
table is named for the tank, and `baseline_mpg` is referenced in **50 files**, more than any other
column here. Candidates: (a) add it to `vehicle_tank_learned` and accept
the name is now wrong; (b) rename that satellite to `vehicle_fuel_learned` in the same merge —
a rename needs the four-step dance and touches an existing table; (c) leave it on `vehicles`,
audited, and shrink the ignore list by one fewer name. **Recommendation: (b)**, because the name will
otherwise mislead every reader after this, and the dance is the price of the rename being correct.
⚠ Do not fold this into TS4 without the ruling — 50 files is not a detail.

**Q-TEL4 — ANSWERED 2026-09-22, and it is not 20%.** The writer is `learnVehicle.ts`, gated on
`Object.keys(vehUpdate).length` — "was a value computed", never "did it change" — and the candidates
guessed below were both wrong. `pg_stat_statements` attributes it directly rather than by inference,
and every statement runs at `rows/call = 1.00`, so these are real tuple rewrites and not scans that
match nothing:

| family | tuple writes on `vehicles` | share | step that owns it |
|---|---|---|---|
| tank calibration (`learnVehicle`) | **2,350,324** | **48.8%** | `TS4` — scheduled LAST |
| live feed | 2,159,619 | 44.8% | `TS1`–`TS3` |
| `assigned_driver_id` | 215,996 | 4.5% | unowned |
| idle | 89,952 | 1.9% | `TS5` |

Over a 12-minute production window the learner issued **375 tuple writes while an md5 of all 272
vehicles' six learned columns did not move at all**, against ~200 fills a day that could move one.
⚠ **This also corrects §2.2b, and the correction is methodological**: that pass snapshotted values 8
minutes apart and concluded the calibration family was quiet because only `odometer_offset` moved, on
one truck. A snapshot diff cannot see a no-op write BY CONSTRUCTION — it compares values, and the
defect is a write that leaves values identical. `odometer_offset` looked different only because it is
the one column that already had a diff gate. Fixed on `claude/telemetry-noop-writes`: the vehicle row
that was already read once is now also the diff basis, and every learner compares before it writes.
⚠ The comparison must go through `n()` — PostgREST returns `numeric` as a STRING, so a strict `===`
is false on every run and the gate would be no gate while reading like one. Pinned by "compares
against Postgres' string numerics, not just JS numbers", which survived two earlier drafts of itself
that were vacuous.
**Still open, deliberately NOT fixed here** — `persist.ts:328` writes `current_odometer` (32,414
calls) and `baseline_mpg` (23,645) with the same ungated shape. Together 1.2%, and `current_odometer`
is one of the four columns `TS1`–`TS3` moves, so it belongs to `TS3`'s flip rather than to this
change. Named here so it is not rediscovered as a surprise: a writer that patches unconditionally
will follow the columns into the new satellite.

*Superseded — the original question and its guesses, kept because the reasoning is instructive:*

**Q-TEL4 — 20% of the writes change nothing. Which statement issues them? OPENED 2026-09-22.**
26 of 131 rewrites in the measured window moved only `updated_at`. A no-op UPDATE costs exactly what
a real one costs — a new tuple, the `set_updated_at()` trigger, the audit trigger's 91-column
comparison, and the 0262 mirror into both satellites — and it is invisible to any diff on values,
which is why it has never been seen. The candidates are the writers that patch without comparing
first: `samsaraVehicleSync`'s identity path re-sends `{...identity, samsara_vehicle_id}` on conflict,
and `equipmentInspection.ts` and the assigned-driver write take no diff gate either.
**Recommendation: find it before `TS3`, because it decides whether the live-feed flip removes 100% of
this table's machine writes or 80% of them** — and a writer that patches unconditionally will follow
the columns into the new satellite if it is not fixed first. ⚠ This is the same shape as the two
defects the lifecycle plan has already found (`D-LIFE11`): a write that changes nothing, running
forever, with nothing in the instrument panel that could show it.

**Q-TEL3 — should `vehicle_positions` be in scope?** It is already a separate table (205 rows,
4.26 M updates, 9,490 autovacuums — the single most-vacuumed table measured). It is not a mixture
problem, so this plan does not own it, but the same "one row per vehicle, rewritten every few
minutes" pattern is there and the live map is its only reader. **Recommendation: out of scope here,
raised for the lifecycle plan's L8 growth judge**, which is the instrument that should be asking why
a 205-row table is rewritten 4.26 M times.

---

## 7. Progress log

Append dated lines at the END. Never edit a row above (see `plan-progress-log-not-table-rows`).

- **2026-09-22** — Plan opened, in answer to `DATA-LIFECYCLE-PLAN` Q5(b) and as the retirement half
  of `SEPARATION-PROGRAM-PLAN` P2.2 / migration 0262. Nothing built. The measurement changed the
  shape of the work twice. First: **the target pattern is already built** — `vehicle_tank_learned`
  and `vehicle_idle_learned` hold 35 of the 39 columns in 0352's ignore list, backfilled and live
  since 2026-08-27, with their legacy columns carrying `DEPRECATED` comments that say in so many
  words "retire when their writers migrate". The writers never migrated, and no plan owned the step;
  this document does. Second, and the reason the queue is ordered as it is: **the half-migrated state
  costs more than either end state.** 0262's mirror trigger has no diff gate, so an odometer write —
  which touches no learner column — rewrites both satellites as well as the 447-byte `vehicles` row.
  Four tables holding 932 rows have taken **14.55 M updates and 27,573 autovacuum cycles** in 122
  days. So the live feed goes first (`D-TEL2`): four columns, one pinned writer function, ~90% of the
  cost. Blast radius measured rather than feared — 53 source files, but the web reads most of these
  through API responses, and the 15 browser `.from("vehicles")` sites hold exactly one `select("*")`,
  which is the silent hazard named in `D-TEL5`. One row of drift already exists between
  `vehicles.odometer_offset` and its satellite. The writer mix that `DATA-LIFECYCLE-PLAN` recorded as
  owed is settled here by full-row snapshot diff (§2.2b): the live feed is the writer, and **26 of 131
  rewrites in the measured window changed nothing at all** — `Q-TEL4`, and the third instance in three
  days of a write that runs forever and changes nothing.

- **2026-09-22 — Q-TEL4 answered, and the queue's premise is wrong by half**
  (`claude/telemetry-noop-writes`). The question was which statement issues the writes that change
  nothing. `pg_stat_statements` answers it directly — it was available all along, and it is the
  instrument §2.2b's snapshot diff cannot substitute for, because a snapshot compares VALUES and the
  defect is a write that leaves values identical. The writer is `learnVehicle.ts`, committing whatever
  it recomputed from the last 30 fills, gated on `Object.keys(vehUpdate).length`. Measured: **375
  tuple writes in a 12-minute production window while an md5 of all 272 vehicles' six learned columns
  did not move**, and the family is **48.8% of this table's 4.8M writes** — larger than the live feed's
  44.8%. Neither candidate named in Q-TEL4 was involved.
  **This reorders the queue.** `TS1`–`TS3` is introduced as "~90% of 14.55M updates" and starts with
  the live feed; on `vehicles` the live feed is 44.8% and the strangler `TS4` retires is 48.8%. The
  14.55M figure spans other tables (`vehicle_positions` alone is 4.26M) and is not disputed here —
  what is corrected is the claim that the live feed is the biggest writer OF THIS TABLE. The cheapest
  win was neither: a diff gate in one file, no migration, no new table, no deploy-window exposure.
  **The fix is the idiom this repo already had.** `samsaraStatsFeed.ts` carries DIFF-BEFORE-WRITE and
  a comment recording the same class of defect found in 2026-08 — "862k+ vehicle updates, most of them
  writing identical values". The learner never got it. The vehicle row it already read once is now
  also the diff basis, moved above the learners to serve that fourth job.
  **Two drafts of this change were wrong, and the tests caught both.** The first invented a
  `COLUMN_SCALE` table to round each value to its column's declared scale before comparing — deleted
  once measured, because every learner already rounds (`learnOdometerOffset` → integer,
  `learnTankSensorReliability` → 3 dp, `learnSensorCapacity` → 1 dp) and the table would only have
  restated the schema. The second shipped a test for that imagined trap which passed under mutation,
  i.e. proved nothing. The real trap is the WIRE TYPE: PostgREST returns `numeric` as a string, so
  `"0.991" === 0.991` is false and the gate would have written as often as no gate. It is pinned now
  by a test with a Postgres-shaped fixture AND a positive control asserting the learner is reached at
  all — without the control, a fixture that silently learned nothing would also write nothing and pass.
  **Verification.** Four mutations of the real file, bytes restored by `cp` and md5-verified after
  each: no gate at all; strict `===` without `n()`; the diff basis dropped; the boolean path ungated.
  The `===` mutation SURVIVED two earlier versions of the test and is the reason the fixture was
  rebuilt against a calibrated learner output rather than a guessed one.
