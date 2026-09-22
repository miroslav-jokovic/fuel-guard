# Fleet census and idle verdict — what a truck is, and why the idle report shows 30 of them

**Status:** PLAN — measured, nothing built. Opened 2026-09-22; rewritten twice the same day, once
after the owner rejected the first pass's central claim and once after the owner ruled on Q-2/Q-4.
**Owner question that opened it:** "trucks are missing from the live map, and idling only covers 30
of 175."

Everything below is measured against **McLeod production (`lme`)**, the **live Samsara API** (org 6308
SILVICOM INC) and **production Supabase**, all on **2026-09-22**. Every count was produced by a query
recorded here.

---

## §0 — The governing rule, and the correction

### 0.1 Mastery (owner-stated, 2026-09-22) — D-FC0

| domain | single source of truth |
|---|---|
| Drivers, Dispatchers, **Trucks**, Trailers, Loads | **McLeod** |
| Mileage, Movements, Duty statuses | **Samsara** |
| Fuel and all card-used expenses | **EFS** |
| Maintenance and repairs (money reconciled against McLeod) | **FleetPal** |
| Toll expenses per truck | **Silvicom 360** (module not built) |

Operative sentences, both owner-stated:

> *"Not all trucks are running at the moment, but if they are active in McLeod they should be in our
> database and properly displayed on our map."*
>
> *"We don't want to retire these in our system, they are active for now, and we have to follow the
> source from McLeod for these trucks — 552 has a driver and is running, for example."*

**Membership in our roster is McLeod's decision. We do not retire a truck McLeod still carries.**

### 0.2 The correction

The first pass reported **"56 trucks have no telematics gateway."** The row count was right and the
conclusion was wrong — it matched Samsara vehicle *names* against unit numbers and read a non-match
as a missing gateway. That is an assumption, not a measurement. The owner rejected it.

**176 of 176 real trucks are in Samsara. Telematics coverage of the operating fleet is 100.0%.** The
"56" are **54 reserved unit numbers** and **3 purchased trucks awaiting gateway installation**.

---

## §1 — The evidence

### 1.1 There is a delivery → gateway pipeline, and it is running right now

Every purchased truck gets a Samsara record **1–6 weeks after `purchase_date`**:

| unit | purchase_date | Samsara record created |
|---|---|---|
| 789–796 | 2026-08-25 | 2026-08-31 → 09-01 |
| 798, 799 | 2026-09-04 | 2026-09-15 |
| 803, 804, 806, 807 | 2026-09-14 | 2026-09-17 |
| 802 | 2026-09-14 | 2026-09-18 |
| **805, 809** | 2026-09-14 | **2026-09-21** |
| **808** | 2026-09-14 | **2026-09-22 (today)** |
| **797, 800** | 2026-08-01 | not yet |
| **811** | 2026-09-14 | not yet |
| **812–864 (53)** | **NULL** | never — §1.2 |

Gateways are being installed as this document is written. 797, 800 and 811 are **purchased trucks in
the queue**, not trucks without telematics.

### 1.2 A reserved unit number is not a truck — `purchase_date` is what says so

McLeod's `service_status = 'A'` selects **247** rows. Split by whether a vehicle exists:

| group | rows | in Samsara | has serial/VIN | ever dispatched |
|---|---:|---:|---:|---:|
| `purchase_date` **or** `model_year` present | **193** | 181 | 193 | 181 |
| **neither present** | **54** | **0** | 53 | **0** |

Those 54 share `inservice_date = 2026-09-04`, no driver, no `fleet_id`, and **zero `continuity` rows
ever**. 53 of them *do* carry a serial/VIN, so **VIN is not a discriminator; `purchase_date` /
`model_year` is.** They are unit numbers reserved against an order whose trucks have not been bought.

### 1.3 `tractor_status` is an OPERATIONAL sub-status, and the owner's reading is corroborated

Owner's ruling on Q-2 (2026-09-22): **`S` = Service / Shop — in shop, maintenance, unavailable.
`V` = Available — available or positioning to become available.**

Measured profile of every `service_status='A'` row, which the ruling predicts and the data confirms:

| `tractor_status` | rows | with driver | in Samsara | dispatched < 14 d | median days since last dispatch |
|---|---:|---:|---:|---:|---:|
| **A** | 150 | 149 | 149 | 149 | **1** |
| **V** — available | 15 | 8 | 15 | 10 | **5** |
| **S** — shop | 12 | 2 | 12 | 3 | **40** |
| I | 15 | 1 | 5 | 9 | 11 |
| ~ (reserved) | 55 | 0 | 0 | 0 | — |

`S` is unmistakable: **40-day median since last dispatch, only 2 of 12 hold a driver, and 12 of 12
still carry a gateway.** A truck that is owned, wired and not moving is a truck in a shop. `V` is
equally clear the other way — 15 of 15 wired, 5-day median, and **four of them (802, 805, 808, 809)
have never been dispatched at all** because their gateways were fitted in the last five days. They
are new trucks waiting for a first load.

`I` is the wind-down cohort: only 5 of 15 still have a gateway, 1 holds a driver — but 9 were
dispatched in the last fortnight. **Per D-FC0 these are not retired by us.** McLeod still carries
them as `service_status='A'`, so we do too.

### 1.4 `outservice_date` is a historical event here, and must not be read at all

| unit | `tractor_status` | `outservice_date` | dispatches/60 d | driver | Samsara fix |
|---|---|---|---:|---|---|
| **552** | A | **2022-06-03** | 25 | BMORGAN | < 15 min |
| **555** | A | **2023-03-03** | 27 | LMONTERR | < 15 min |
| **569** | V | **2021-08-09** | 33 | DSAINTJE | < 24 h |

**This McLeod instance does not clear `outservice_date` when a truck returns to service.** Three
trucks running today carry dates from 2021, 2022 and 2023, and both of our predicates
(`queries.mjs:126-127` and `:177-179`) read them as current state.

It is also **redundant**: of the 472 rows McLeod has genuinely deactivated (`service_status='I'`),
**471 also carry an `outservice_date`.** The real retirement act is `service_status`, so reading
`outservice_date` adds nothing true and subtracts three running trucks. **D-FC2: we stop reading it.**

### 1.5 The census — membership from `service_status`, sub-status from `tractor_status`

Four candidates, scored against Samsara as ground truth:

| predicate | selects | in Samsara | no gateway (explicable) | retires a running truck? |
|---|---:|---:|---|---|
| **P0 — what we run today** | 228 | 172 | 56 (53 reserved + 3 queued) | **yes — 552, 555, 569** |
| P2 — earlier recommendation | 179 | 176 | 3 | no, but drops the 15 `I` trucks |
| P3 — `tractor_status` alone | 176 | 176 | 0 | no, but drops `I` **and** the 3 queued |
| **P4 — RECOMMENDED** | **193** | **181** | **12** | **no** |

```sql
-- P4: membership. outservice_date and tractor_status are NOT consulted.
WHERE t.company_id = @companyId
  AND t.service_status = 'A'
  AND (t.purchase_date IS NOT NULL OR NULLIF(LTRIM(RTRIM(t.model_year)),'') IS NOT NULL)
```

**P4 is what D-FC0 says in SQL: McLeod's own active flag, minus rows that describe no vehicle.** It
retires nothing McLeod still carries. Its 12 gateway-less trucks are all explicable — the 9 `I`
trucks whose gateways have already been pulled (506, 550, 557, 563, 568, 572, 592, 594, 607) and the
3 in the install queue (797, 800, 811).

**P4 keeps no dead trucks.** Ten of its rows have not been dispatched in 120 days and every one has a
reason: 579 / 660 / 681 are `S` (shop, 125–518 days — which is what a shop truck looks like); 797 /
800 / 811 are awaiting gateways; 802 / 805 / 808 / 809 are `V`, brand new, gateways fitted this week.
Nothing needs `tractor_status` for *exclusion* — only for *display*.

### 1.6 `S` maps onto a status we already have, and the live map predicted this

`vehicle_status` is a Postgres enum from migration 0001 — `('active','maintenance','retired')` — and
`VEHICLE_STATUSES` in `packages/shared/src/constants.ts:108` matches it. There is **no CHECK
constraint and no migration needed**; `maintenance` is already legal and currently holds **zero
rows**.

`liveMapBoard.ts:60-70` wrote this situation down before it happened:

> *"filtering to `active` would ALSO drop every truck sitting in the shop — which is precisely a
> thing a dispatcher wants to see on a map. This carrier happens to have no `maintenance` rows today
> … and would stay that way until the first truck went into the shop and quietly vanished from the
> board."*

The carrier has had **12 shop trucks all along**. We never read the column that says so. The map's
`<> retired` predicate was written defensively for exactly this and needs no change (D-FC3).

**D-FC9: `tractor_status = 'S'` → `status = 'maintenance'`. Everything else in P4 → `active`.**

### 1.7 Unit 732 — Q-1 from the first pass, ANSWERED

```
unit_number       status    identity_source  mcleod_tractor_id  vin
732               retired   samsara          NULL               NULL
G6AA-5HS-XTC      active    mcleod           732                3HSDZAPR3TN519824
```

**Two rows, one truck.** `G6AA-5HS-XTC` is a **Samsara gateway serial** inherited as the vehicle's
name. McLeod's matcher runs `link → VIN → unit` (`rosterMatch.ts`), VIN won, and tractor 732 linked to
the serial-named row. `D-MR11` then correctly refuses to rewrite a `unit_number` as a sync side
effect — so **the truck is on the map today labelled with its gateway serial**, while the row a human
would recognise sits retired beside it.

Blast radius: **exactly one** such row. The 10 `- OLD` / `- SOLD` rows are all correctly retired.

#### 1.7a What `- OLD` means, and a wrong turn worth recording (2026-09-22, owner-corrected)

While implementing F4 I read the two rows' **different `samsara_vehicle_id`s** — one named `732`, one
named `732 - OLD` — as two physical trucks, rewrote this section to say so, and built the migration
around it. **The owner rejected it and was right.** The rule, owner-stated:

> *"trucks marked with OLD are marked like that when the Samsara device is replaced, we don't remove
> this we just rename them old"*

The vendor data agrees with the carrier, and I had already fetched it without reading it properly:

| `samsara_vehicle_id` | name | gateway | VIN | driver |
|---|---|---|---|---|
| 281474996337444 | `732 - OLD` | **`{serial: "", model: "none"}`** — no device | none | none |
| 281475005971830 | `732` | `G6AA-5HS-XTC`, model VG55NA | 3HSDZAPR3TN519824 | ANTHONY CASTILLO |

**One truck, one gateway swap.** The `- OLD` record is the decommissioned DEVICE's record, kept and
renamed rather than deleted. §1.7's original reading stands.

**The lesson is the one §0.2 already records and I repeated anyway: a vendor's NAME is not a
measurement.** The first pass of this plan matched Samsara names to unit numbers and called 56 trucks
gateway-less; this pass read a name suffix and called one truck two. The gateway field was in the
same API response both times.

D-FC5 therefore stands unchanged — **one physical truck is one row** — and F4 is a **merge**, not a
rename. It is also bigger than it looked: the two rows split this truck's life down the middle
(the old row 102 fills, 123 idle days, 217 spend-days and a learned 240-gal tank; the new row 30
engine-days), so the merge decides where that history ends up. **F4 is deferred out of merge 5 and
needs an owner answer first — see Q-9.**

### 1.7b Why unit 732 is RETIRED, and the ten trucks retired beside it — ANSWERED 2026-09-22

The owner's question ("I don't know why 732 is getting retired — it is active in McLeod and Samsara
and currently dispatched") has one event behind it, found in `audit_logs`:

```
2026-09-14 19:11:20   mcleod.roster_reconciled   retired: 33
```

`reconcileAbsentFromTms` builds its candidate set as `!activeSet.has(String(row[link] ?? ""))`, so a
row with **no McLeod link at all** reads as `""`, is never in the active set, and is retired. That is
deliberate for genuinely stale Samsara rows — its docstring says so — and it is **indiscriminate**:
it cannot tell a legacy row from a live truck McLeod happens to have linked somewhere else.

Unit 732 lost its link because the gateway swap created a SECOND row (`G6AA-5HS-XTC`, 2026-08-24,
from `samsaraVehicleSync`), and McLeod's tractor 732 matched that row by VIN. The row holding the
truck's whole history was left unlinked, and the next reconcile retired it.

**That sweep retired 11 trucks that were still fuelling**, in two distinct groups:

| units | McLeod link | fills in 30 d | cause |
|---|---|---|---|
| 569, 552, 555, **732**, 568, 563 | **none** | 19, 17, 14, 11, 8, 2 | **the NULL-link rule — NOT fixed by merge 4** |
| 607, 550, 578, 556, 551 | present | 8, 4, 4, 2, 1 | the stale `outservice_date` predicate — fixed by F1/F2 (#963) |

The second group is already handled. The first is a live defect with nothing in front of it: the next
reconcile sweep retires the same rows again. New item **F14**.

⚠ **F6 would not have saved 732.** The guard reads telematics fixes, and 732's last fix is
2026-08-24 — the day its device came out. It took a fuel fill that same day and eleven since.
**A fill is evidence of life too**, and F14 carries that.

### 1.8 The roster delta P4 produces

| | today | under P4 |
|---|---:|---:|
| active | 235 | **181** |
| maintenance | 0 | **12** |
| retired | 37 | 79 |

- **12 trucks come back from retired**: 550, **552**, **555**, 556, 563, 568, **569**, 578, 607, 720,
  721, **732**. (721 returns as `maintenance` — it is `S`.)
- **54 rows leave**: the 53 reserved numbers 812–864, plus `G6AA-5HS-XTC` which merges into 732 (F4).
- **12 become `maintenance`**: 579, 638, 641, 660, 669, 677, 681, 703, 721, 727, 749, 787.
- **0 trucks in P4 lack a roster row** — no creates are needed, so no create sweep runs and
  `rosterIngest`'s untested create path stays untested.

### 1.8a The real problem behind Q-3 — 17 sites hand-write a vehicle status comparison

Researched 2026-09-22, and it found a defect in **F3 as originally written**.

`vehicles.id` is referenced by **33 foreign keys**:

| `ON DELETE` | count | examples |
|---|---:|---|
| RESTRICT | 9 | `fuel_transactions`, `financial_entries`, `inventory_assets`, `hazmat_loads` |
| SET NULL | 11 | `anomalies`, `fuel_events`, `loads`, `tms_movements`, `fuel_cards` |
| **CASCADE** | **13** | `idle_rollup_days`, `vehicle_engine_days`, `fuel_spend_days`, `samsara_odometer_readings`, `vehicle_positions`, `fleetpal_units`, `idle_park_sessions` |

The 53 reserved rows have **zero dependent rows** in every one of those tables today, so deleting
*these* rows is safe. The hazard is the **mechanism**: a delete path for `vehicles` is a tool that
silently destroys thirteen tables' worth of history the next time it is pointed at a truck that has
any. This repo has already been bitten once by exactly that
([[merge-driver-cascade-trap]], `merge_driver`).

And the status vocabulary is read by hand in **17 places** — 10 comparing `= 'active'`, 7 comparing
`<> 'retired'`. Two of them decide things that matter:

- **`equipmentInspection.ts:205`** — `.from("vehicles").eq("status","active")`. **F3 as first written
  would have dropped all 12 shop trucks out of the §396.17 annual-inspection roster.** A truck in a
  shop is precisely a truck whose inspection must stay tracked. This is a compliance surface and the
  defect was in this plan, not in the code.
- **`askData.ts:415`** — the same filter, so the fleet count would quietly fall by 12.

**So Q-3 is not really "which value do the 53 get".** It is that every new status value silently
re-means seventeen hand-written comparisons, and the next one will too. The fix is a derived
predicate, not a value choice — and the repo already has the pattern:

```ts
// packages/shared/src/constants.ts:133,149 — the DRIVER answer to the same shape
export const DRIVER_STATUSES = ["applicant", "active", "inactive", "on_leave", "terminated"] as const;
export const EMPLOYED_DRIVER_STATUSES = DRIVER_STATUSES.filter((s) => s !== "applicant");
```

…spread into `.in("status", [...EMPLOYED_DRIVER_STATUSES])` at both the API route
(`roster/routes/drivers.ts:102`) and the web composable (`useDrivers.ts:92`). **`applicant` is
precisely "this record exists but is not yet an operating asset."** A vehicle on order is the same
shape, and symmetry beats invention.

Enum extension also has an established convention here — migrations **0077, 0210, 0266, 0279** —
whose header states the two constraints that govern the work:

> *"Postgres will not let a newly-added enum value be USED in the transaction that adds it"* and
> *"ONE-WAY DOOR: Postgres has no `ALTER TYPE … DROP VALUE`."*

### 1.8b Trailers have the same shape, smaller

`trailer` under `company_id='TMS'`: `is_active='A'` → 231 rows, of which **9** have no
`purchase_date`; `is_active='I'` → 172, **all** carrying an `outservice_date`. The same reserved-row
pattern and the same redundancy of `outservice_date`, at 9 rows instead of 53. The owner's mastery
list names Trailers, so the fix should be symmetric — but it is not urgent and it is scoped
separately (E5).

### 1.9 The live map, recounted

| | count |
|---|---:|
| Samsara vehicle records (incl. 22 `- SOLD` / `- OLD`) | 207 |
| Roster under P4 | **193** (181 active + 12 maintenance) |
| …with a gateway | 181 |
| Markers drawn today | 178 |

The feed is **healthy**: across 15-minute, 24-hour and 72-hour windows, zero Samsara vehicles with a
fresh fix were stale on our side. One linked truck (**802**) has no `vehicle_positions` row because
that table is written *only* by the 5-second delta feed and 802 has never emitted a fix — a parked
truck is invisible rather than offline.

### 1.10 Idling, scoped to the real fleet

Window 2026-08-23 → 2026-09-21, `idle_rollup_days`.

| gate | trucks |
|---|---:|
| has idle data | 171 |
| coverage ≥ 50% | 155 |
| HOS duty evidence ≥ 80% | 152 |
| **equipment flag not NULL** | **53** |
| judgeable | 45 |
| minus Optimized-Idle trucks dropped by §1.11 | **28** ← the banner's "30" |
| actually contributing hours | **13** |

Fleet totals: **23,988 h of continuous main-engine park idle**, **22,508 h** of it during HOS rest —
at 0.8 gal/h × $5.91, **~$113,000/month burned at rest** against a reported $3,660. **17,280 h is
excluded solely because a checkbox is NULL**; `has_apu` is set on 47 of 176, both flags NULL on 122.

The HOS duty overlay is **exonerated**: 8.2% of continuous idle seconds are unevidenced fleet-wide
and 152 of 171 trucks clear the 80% gate.

### 1.11 `weather_cache` has never once been read successfully

For an `optimized_idle` truck `computeAvoidable` sets avoidable = `insideSec`. Over the window:
**inside 0.0 h · outside 0.0 h · unknown 3,945 h**; `optimized_envelope_status` is `insufficient` on
all 546 applicable rollup-days and `evidenced` on **none, ever**.

One line. `readCachedDay` (`idleSessionWeather.ts:64-77`) hands PostgREST's `hour_utc` to
`pickHourlyTempF`, which does `Date.parse(raw.endsWith("Z") ? raw : raw + "Z")` (`weather.ts:29`).
PostgREST serialises `timestamptz` as `2026-06-14T00:00:00+00:00` — **verified against the live REST
endpoint** — so the helper builds `…+00:00Z` and **`Date.parse` returns NaN**. A temperature is only
ever available from a *live* Open-Meteo fetch, and the cell is cached immediately after, so the second
read of any cell is null forever.

Ambient coverage on `idle_park_sessions`: **Apr 36% · May 39% · Jun 46% · Jul 18% · Aug 0% · Sep
0.18%** (80 h known against 63,683 h unknown). `weatherBackfill.ts:41-50` has the same bug and
survives by accident — its cache key includes the UTC date, so each new day is a miss and goes live.
**734,136 cached hours have never been read.**

---

## §2 — Decisions

**D-FC0 — mastery, as stated by the owner** (§0.1). McLeod decides which trucks exist and which are
active. Samsara decides where they are and what they are doing.

**D-FC1 — membership is P4** (§1.5): `service_status = 'A'` **and** the row describes a vehicle.
Nothing else. It is McLeod's own active flag, and the second clause only removes rows that describe
no truck at all.

**D-FC2 — `outservice_date` is never read.** It is a historical event on this instance (§1.4) and is
redundant against `service_status` on 471 of 472 genuinely-retired rows.

**D-FC9 — `tractor_status` decides the sub-status, never membership.** `S` → `maintenance`; all else
→ `active` (§1.6). No migration: the enum and the shared contract already carry the value.
⚠ The letters are the **owner's reading, corroborated by behaviour** (§1.3) — not read from McLeod's
`labelfile`, which our login cannot reach. Q-2 stays open as a confirmation, not a blocker.

**D-FC3 — the live map's `<> retired` filter stays.** Its author wrote the shop case down in advance
(§1.6) and it now does what it was built for. Fixing the filter to compensate for a wrong `status`
would put a second definition of "real truck" beside the roster's.

**D-FC4 — a truck with no gateway is a truck.** 797, 800, 811 and the 9 wind-down units are in the
roster and in every fleet count. On the map they show as *awaiting telematics* / *no telematics*,
never omitted — an omitted truck is indistinguishable from a bug, which is how this began.

**D-FC5 — one physical truck is one row, and `unit_number` is McLeod's.** §1.7. `D-MR11`'s refusal to
rename as a side effect stays; a gateway serial standing in a McLeod-mastered field is not a name a
human chose. The merge is an explicit audited act.

**D-FC6 — the weather timestamp is parsed as an instant, in one place** (§1.11).

**D-FC7 — the avoidable caption names its own population.** `confidentTrucks` = 45, hours come from
13. One caption may not carry both under one noun (`idleBreakdown.ts:437-448`).

**D-FC8 — the APU's own burn is netted out of "avoidable".** `idle_gal_per_hour` is 0.80 and models
the main engine; an APU burns ~0.2 gal/h. Overstated ~25% on the trucks the model does score.

**D-FC10 — a vehicle on order is `status = 'ordered'`, not a deleted row** (Q-3 resolved, §1.8a).
It mirrors `drivers.status = 'applicant'`: a record that exists and is not yet an operating asset.
Deletion is rejected on the **FK graph, not on taste** — 13 CASCADE edges make a vehicle-delete path
a standing hazard even though these 53 rows are clean today. Keeping them also keeps a fact the
business uses: 53 trucks inbound, on a measured 1–6 week delivery→gateway pipeline (§1.1).
⚠ **ONE-WAY DOOR.** Postgres has no `ALTER TYPE … DROP VALUE`; this value cannot be withdrawn.

**D-FC11 — no surface hand-writes a vehicle status comparison again.** The vocabulary gains derived
predicates in `@silvicom/shared`, exactly as `EMPLOYED_DRIVER_STATUSES` already does for drivers, and
the 17 existing comparisons are audited **once**, each choosing deliberately between "in the
operating fleet" and "on the road right now":

```ts
export const VEHICLE_STATUSES = ["ordered", "active", "maintenance", "retired"] as const;
/** The operating fleet: delivered and not disposed of. A shop truck IS in service — it is
 *  inspected, insured, financed and counted. Excludes not-yet-delivered and retired. */
export const IN_SERVICE_VEHICLE_STATUSES =
  VEHICLE_STATUSES.filter((s) => s !== "ordered" && s !== "retired");
```

This is the plan's own **"deriving beats restating"** obligation. Seventeen copies of a rule is how
`session.canManage` happened; the count only goes up from here, and `ordered` would be the value that
makes each copy wrong in a different direction.

---

## §3 — Work items

| id | item | proof it worked |
|---|---|---|
| **F1** | Replace the active predicate with P4 (`queries.mjs:123-127`); add `tractor_status` to `VEHICLE_MATCH`/`VEHICLE_IDENTITY`. | Dry run selects 193, not 228; the 53 reserved numbers are named in its output. |
| **F2** | Replace the retire predicate with `service_status <> 'A'` (`queries.mjs:177-179`) — drop the `outservice_date` clause entirely (D-FC2). | 552, 555, 569, 556, 568, 607, 720, 721, 732, 550, 563, 578 leave the retire payload. |
| **F3** | Map `tractor_status='S'` → `maintenance`, else `active`, on the ingest patch (D-FC9). **No migration.** | 12 rows land in `maintenance`, a status that has held zero rows since 0001; all 12 still render on the map. |
| **F4** | Merge 732's duplicate: one row, `unit_number = '732'`, McLeod-linked. Audited act, human-reviewed, not a sync side effect (D-FC5). ⚠ **Ordered, not atomic** — `(org_id, unit_number)` is unconditionally unique (G9), so the retired twin is renamed or removed FIRST; a single `update … set unit_number` fails with 23505. | No `vehicles` row has a gateway-serial unit number; 732 renders as `732`; the 23505 path has a test. |
| **E0** | **Give the ingest a status-reconcile path** (G1). Status becomes part of the update patch, derived from McLeod by one pure function in `packages/shared` — `ordered` \| `maintenance` \| `active`. Routed through the existing `applyOutcome` update, never a new `.from("vehicles")` write site. | A unit test drives all three transitions; mutating the derivation to a constant fails it. `lint:table-modules` still reports 60 grandfathered sites, not 61. |
| **E1** | Migration, **value only, nothing else in the file**: `alter type vehicle_status add value if not exists 'ordered';` — per the 0077/0210/0266/0279 convention, with their ONE-WAY-DOOR header. | `pg_enum` carries the value in production; no code references it yet. |
| **E2** | `VEHICLE_STATUSES` gains `ordered`; add `IN_SERVICE_VEHICLE_STATUSES` (D-FC11). Zod schemas in `fleet.ts:37,258` follow the constant, so they need no edit. | `pnpm typecheck` forces every exhaustive `switch` on `VehicleStatus` to be revisited — that is the audit doing its job, not a failure. |
| **E3** | Enumerate every vehicle status comparison with E4 in report mode (G4) **and by querying `pg_proc` (G10 — a PL/pgSQL comparison is invisible to a TypeScript gate)**, then convert. Covers **both** directions: `= "active"` sites that would lose shop trucks (`equipmentInspection.ts:205`, `askData.ts:415`) **and** `<> "retired"` sites that would gain 53 `ordered` trucks (`useIdleBreakdown.ts:181`, `useIdleDrivers.ts:84`, `useIdleConfidence.ts:72`, `useIdleCapabilities.ts:62`, +7 API) — G3. **Includes `rosterRetire.ts:191`** so a `maintenance` truck stays retirable (G2). Enumerate count-consumers at the same time (G7). | The §396.17 roster returns 193, not 181; the idle denominator does **not** move when 53 `ordered` rows appear; a mutation flipping either filter back fails a test by name. |
| **E4** | Gate `lint:vehicle-status`: a `status` literal on a `vehicles` query outside `packages/shared` fails the build. Add it to `package.json` **and** to `ci.yml`'s `gates` job by name, with its `"//lint:vehicle-status"` comment — per CLAUDE.md, a gate in neither list is not a gate. | The gate fails on a deliberately reintroduced `eq("status","active")` and passes on the audited tree. |
| **F5** | Set the 53 reserved rows to `ordered` (E1+E2 deployed first). Audited service-role act. | Roster lands on 193 in-service + 53 ordered; map foot and idle denominator agree with McLeod. |
| **E5** | Apply the same `purchase_date` clause and `outservice_date` removal to the **trailer** query (§1.8b, 9 rows). Scoped separately; not urgent. | Trailer active count moves 231 → 222 with the 9 named. |
| **E6** | **Establish and record the roster sync cadence** (G8, Q-6). Needs an owner answer first; then either a documented scheduled invocation inside the carrier's network or a freshness stamp the product can show. | `GET /api/version`-style freshness for the roster: a surface states when McLeod was last read, and a stale read is visible rather than assumed. |
| **F6** | Guard: the roster sweep refuses to retire a vehicle whose last telematics fix is < 24 h old, and reports it. | A synthetic payload retiring a fresh-fix truck is refused; removing the guard makes the test fail. |
| **F7** | Show D-FC4's state: *awaiting telematics* for a McLeod-active truck with no `samsara_vehicle_id`; census sentence reads "181 of 193 reporting". | 797, 800, 811 and the 9 wind-down units are visible and countable. |
| **F8** | **Fix the `hour_utc` parse** (D-FC6) in `weather.ts` + both readers. | A `+00:00` fixture returns a temperature; mutating back to `raw + "Z"` fails the test. |
| **F9** | Backfill the envelope for Aug–Sep once F8 lands. | `optimized_envelope_status = 'evidenced'` becomes non-zero for the first time ever. |
| **F10** | Split the avoidable caption (D-FC7). | 13 / 15 / 17 / 122 named separately. |
| **F11** | Net the APU burn out of avoidable cost (D-FC8). | Avoidable dollars fall ~25% on APU trucks; hours unchanged. |
| **F12** | Seed `vehicle_positions` from `GET /fleet/vehicles/stats?types=gps` on a slow cadence. | Unit 802 acquires a position and renders offline rather than absent. |
| **F13** | Fill the 122 NULL equipment flags. **Not derivable from McLeod** — `sys.columns` on `tractor` has no APU/idle/aux/power column (direct query). Needs a carrier spec list or a data-entry pass. | `has_apu` NULL count on the real fleet reaches zero. |
| **F14** | **An UNLINKED row is not an absent truck** (§1.7b). `reconcileAbsentFromTms` reads `String(row[link] ?? "")` and so retires every vehicle McLeod has never linked — it took 6 live trucks on 2026-09-14, including the one the owner asked about. Two halves: the reconcile must decide on evidence rather than on a missing link, and **F6's guard must read FUEL as well as telematics**, because 732's device was out while its card was still buying diesel. | A synthetic reconcile over a roster missing an unlinked, recently-fuelled truck retires nothing and reports it; removing either half fails a test by name. The 6 rows return to `active` and stay there across two consecutive reconcile sweeps. |

**Sequencing — five merges, and the order is load-bearing.**

| merge | contents | why it cannot move |
|---|---|---|
| **1** | **F8** (+F9 after it deploys) | Independent of everything. One line, restores 17 trucks to the idle verdict, un-breaks a cache that has never been read. |
| **2** | **E1** — the enum value, alone | Postgres refuses to *use* a value in the transaction that adds it, and Railway serves a merge ~3 min before `migrate.yml` applies the schema. Anything writing `'ordered'` in this merge fails on live traffic for the length of the deploy window. |
| **3** | **E2 + E3 + E4** — derived constants, the enumerated audit, the gate | E3 is a correctness fix in its own right (§1.8a, G2, G3): it must land **before** F3 creates the first `maintenance` row, or 12 trucks drop out of the §396.17 roster and become unretirable the moment F3 runs. |
| **4** | **E0 + F1 + F2 + F3 + F6** | E0 is the mechanism F3 needs and does not have (G1) — without it F3 is a silent no-op. One behavioural change to the sync; F6 is the guard that makes the *next* wrong predicate visible instead of silent, so it ships with the change it guards. |
| **5** | **F4 + F5**, then **F7**, then **E5** | Audited data acts, human-reviewed before they run. F7 needs F1–F3's statuses to exist first. |
| **—** | **E6** | Blocked on Q-6. Not in the critical path, but the plan is not *finished* without it: a correct predicate on a stale sync is still a stale roster. |

⚠ **The E3-before-F3 ordering is the one a reasonable person would get wrong.** Doing the sync change
first "because it is the point of the plan" ships a silent compliance regression that no test in the
repo would catch, because nothing today produces a `maintenance` row to catch it with.

**Migration discipline.** Only E1 is a migration, and it is a value-only file per
`lint:migrations`. F3 needs none (§1.6). The E1 → F5 gap is the `lint:migration-ordering` rule
applied to an enum: the value and its first **writer** are two merges apart, because the deploy
window is 2m44s and cannot be watched (`docs/MIGRATION-DISCIPLINE.md` §the-deploy-window).

---

## §4 — Open questions

**Q-1 — ~~What retires unit 732?~~ ANSWERED, §1.7.** A duplicate identity, the only one in the roster.

**Q-2 — ~~What do `tractor_status` `V` and `S` mean?~~ RULED by the owner, 2026-09-22:** `S` = Service
/ Shop, `V` = Available. Corroborated independently by behaviour (§1.3). **Remaining, and non-blocking:**
the ruling is a reading, not a citation. McLeod's `labelfile` holds the definitions and our production
login cannot read it (SELECT on seven tables only). Worth one request for SELECT on `labelfile` so the
mapping cites a source rather than an inference — but D-FC9 does not wait on it, because
`tractor_status` no longer decides membership, only display.

**Q-3 — ~~What happens to the 53 reserved unit numbers?~~ RESOLVED by research, 2026-09-22 —
D-FC10 + D-FC11, evidence in §1.8a.** `status = 'ordered'`, plus derived predicates and a gate.

The four candidates were scored on cost, not preference:

| option | verdict |
|---|---|
| (a) **delete** — my earlier recommendation | **Rejected.** 13 `ON DELETE CASCADE` edges into `vehicles` make a delete path a standing hazard (`idle_rollup_days`, `vehicle_engine_days`, `fuel_spend_days`, `vehicle_positions`, …). These 53 rows are clean today, so the rows are not the risk — the reusable mechanism is. It also discards a fact the business uses: 53 trucks inbound on a measured 1–6 week pipeline. |
| (b) `retired` | Rejected. Wrong word; a path built for disposal would later have to un-retire a truck that was never in service. |
| **(c) `ordered` + derived predicates** | **Chosen.** Mirrors `drivers.status='applicant'`, which is live and proven at two call sites. Enum-extension convention already exists (0077/0210/0266/0279). |
| (d) leave them, fix denominators | Rejected — the workaround. It puts a second definition of "real truck" into every reader, which is the failure mode this repo's register is named for. |

**What made the decision, and it was not the 53 rows:** the audit found **17 hand-written status
comparisons**, two of which matter — `equipmentInspection.ts:205` would have dropped 12 shop trucks
out of the §396.17 inspection roster the moment F3 created the first `maintenance` row. Option (a)
would have left that latent. Option (c) forces the audit, and E4's gate stops the eighteenth copy.

**Residual risk, stated:** `ordered` is a **one-way door** — Postgres has no `ALTER TYPE … DROP
VALUE`. The mitigation is that it is a *lifecycle* value on an asset that already has a lifecycle,
not a feature flag, and `IN_SERVICE_VEHICLE_STATUSES` means a later reader never has to know it
exists.

**Q-4 — ~~The 9 trucks being wound down.~~ RULED by the owner, 2026-09-22: do not retire them.** They
are active for now and we follow McLeod. P4 implements this by not reading `outservice_date` at all
(D-FC2). Consequence to accept knowingly: 9 of them have had their gateways pulled from Samsara, so
they will sit in the roster with **no position and no idle data** until McLeod sets
`service_status='I'`. F7 is what stops that reading as a bug.

**Q-6 — What runs the McLeod roster agent, and how often? (G8 — OWNER ANSWER NEEDED)**
`tools/mcleod-agent` is invoked only by `pnpm` scripts; there is no scheduler, workflow or Railway
service for it in this repository, yet all 272 vehicle rows were refreshed today. So something runs
it and the repo does not know what. Candidates: (a) the owner runs it by hand; (b) a `cron`/Task
Scheduler entry on a machine inside the carrier's network; (c) something else.
**Recommendation:** answer (a)/(b) first, then E6 — if it is (a), a scheduled invocation on an
in-network machine plus a visible freshness stamp; if it is (b), document where it lives and put the
stamp on a surface so a stopped job is *seen* rather than inferred from a wrong number weeks later.
This is the difference between the plan fixing today's roster and fixing the roster.

**Q-5 — Which denominator does the idle page state?** After F1–F5 the roster is right and the page can
read it. **Recommendation:** say which of the two it is — "171 of 193 trucks reported engine time" is
falsifiable; "175 trucks" is not.

**Q-7 — ~~Does the office keep a hand-editable vehicle status?~~ DECIDED 2026-09-22: (a), delegated by the owner ("make these decisions based on analysis and research").** Built as `isStatusFromTms` in `@silvicom/shared`; see the progress log.

E0 made the sweep a writer of `vehicles.status`, and `VehicleForm.vue` has always offered the field.
Two writers, one column, and since 2026-09-22 the sweep runs the more often of the two — so an office
edit is now expected to be reverted, silently, within the hour.

The obvious move is the wrong one. 0241's `claim_identity_for_office` trigger would freeze the row on
any hand edit of a column the sync owns, and that claim is **whole-row**: adding `status` to its
argument list means one person marking a truck as in the shop also stops McLeod refreshing that
truck's VIN, plate, registration and inspection date, permanently. That is the defect 0286 had to
unpick for `dot_annual_inspection_expires_at` — one certified inspection cost a trailer its VIN — in
a wider form. So `status` is NOT in the trigger's list, and `rosterFields.claimParity.test.ts` now
carries its first named carve-out saying so.

| candidate | cost |
|---|---|
| **(a) make the field read-only, show McLeod as its source** | Honest and cheap. Matches D-FC0 exactly: membership and lifecycle are McLeod's. Costs the office the ability to park a truck the TMS has not parked. |
| (b) give `status` its own `status_source`, the 0286 pattern | Correct in the general case and a migration plus a branch in the sweep. Worth it only if the carrier actually needs a local override McLeod cannot express. |
| (c) add `status` to the 0241 trigger | **Rejected** — whole-row claim; one status edit costs the truck every other McLeod-maintained field. |
| (d) leave both writers, say nothing | Rejected. This is the "second source of truth because the first is inconvenient" shape the repo's no-workarounds rule is named for, with the added cruelty that the losing writer is a human being who watched their edit stick and then vanish. |

**Recommendation: (a)**, unless the owner names a case where the office must park a truck McLeod
still reports as running. It is one field's `disabled` and a source label, and it can become (b)
later without anything to undo.

**Q-9 — ~~Unit 732 is one truck in two rows. Where does its history end up?~~ DECIDED 2026-09-22: (a),
delegated by the owner. Built as 0357–0359; see the progress log.**

The gateway swap of 2026-08-24 split one truck across two rows, and each half holds real data:

| row | name | link | Samsara device | tank | history |
|---|---|---|---|---|---|
| `de57e742` | `732` | **none** | 281474996337444 — the pulled device | **240 gal, learned** | 102 fills (from 2026-01-01, 11 of them since the swap, latest today), 123 idle days, 217 spend-days |
| `698c08f1` | `G6AA-5HS-XTC` | `mcleod_tractor_id = 732` | 281475005971830 — the live device | 0 | 30 engine-days, 29 spend-days |

The end state is not in doubt — **one row, named `732`, McLeod-linked, carrying the live Samsara
device id, the learned 240-gal tank and all of the history**. What needs an answer is how to get
there, because the two candidates move different data:

| option | what moves | cost |
|---|---|---|
| **(a) keep `de57e742`** (the history row): write the McLeod link, VIN and live `samsara_vehicle_id` onto it, move the newer row's 30 engine-days and 29 spend-days across, then retire the duplicate | 59 derived rows | Smallest move, and it is all **derived** data that a re-run recomputes. The fuel history — the part that cannot be recomputed — never moves. |
| **(b) keep `698c08f1`** (the McLeod-linked row): move 102 fills, 123 idle days and 217 spend-days onto it | 442 rows, 102 of them fuel | Re-parents evidence. Every moved fill re-scores against a different tank (240 vs 0) and envelope. |

**Recommendation: (a)**, and it is not close: it moves a quarter of the rows, and none of what it
moves is evidence. ⚠ Neither option is a `delete` — `vehicles.id` has **33 inbound foreign keys, 13
of them CASCADE** (§1.8a), and `merge_driver`'s history in this repo is the reason a merge here has
to name every one of them rather than trust a cascade ([[merge-driver-cascade-trap]]).

⚠ **Until this is answered, unit 732 renders on the map as `G6AA-5HS-XTC`** and its fuel history sits
on a row marked retired. F14 is what stops the retired half being retired AGAIN; it does not merge
anything.

---

## §4a — Pre-implementation audit, 2026-09-22

Run adversarially against this plan before writing any code. **Three of these would have broken the
implementation**; one is the owner's own requirement with no work item behind it.

### G1 — the roster ingest CANNOT change an existing row's status ⛔ blocks F3

`vehiclePatch` (`rosterFields.ts`) writes `vin, make, model, year, plate, plate_state,
registration_expires_at, dot_annual_inspection_expires_at, purchased_at` and **never `status`**.
`status` is written in exactly one place — `rosterIngest.ts:394`, hardcoded `"active"` and **only on
insert**.

So there is **no mechanism** for `S → maintenance` (F3), and none for `ordered → active` when a truck
is delivered. Both are silent no-ops as the plan is written.

**This is a prerequisite for F3 regardless of Q-3's answer**, so it is not a cost of choosing
`ordered`. New item **E0**. ⚠ The write must go through the existing `applyOutcome` update — a new
`.from("vehicles").update()` would be a fresh `lint:table-modules` violation (`vehicles` is
`module: roster`, and the gate passes today with 60 grandfathered sites; that list may shrink, never
grow — [[samsara-feed-and-vehicles-writer]]).

### G2 — the retire path only retires rows that are exactly `active` ⛔ one-way trap

`rosterRetire.ts:191-192`: `else if (row.status === "active") { patch.status = "retired"; }`.

Once F3 writes the first `maintenance` row, **that truck can never be retired by McLeod again** —
the sync will silently leave it in the shop forever. Same for `ordered`. Folded into **E3**: the
retire path reads `IN_SERVICE_VEHICLE_STATUSES`, not a literal.

### G3 — `neq("status","retired")` is NOT safe once `ordered` exists ⛔

Four web composables filter vehicles that way — `useIdleBreakdown.ts:181`, `useIdleDrivers.ts:84`,
`useIdleConfidence.ts:72`, `useIdleCapabilities.ts:62` — plus 7 API sites. The moment 53 `ordered`
rows exist, each of those surfaces **silently gains 53 zero-data trucks**, which is precisely the
inflated-denominator bug this plan exists to remove. E3 must convert them, not just the two
`= "active"` sites named in §1.8a.

### G4 — the "17 sites" figure in §1.8a was imprecise, and is corrected here

There are **93** `.from("vehicles")` call sites across `apps/api`, `apps/web` and
`packages/shared`; 11 pair a status filter within six lines, and a filter can sit further away than
that. **E3's first deliverable is the authoritative enumeration**, produced by the E4 gate running in
report mode — not a number asserted in prose. The two named in §1.8a
(`equipmentInspection.ts:205`, `askData.ts:415`) are confirmed by reading; the rest are a count, and
the plan should not have implied otherwise.

### G5 — `MCTEST` is excluded by accident, not by principle

`tractor_status='A'`, `service_status='A'`, no `purchase_date`, no `model_year` — so P4's is-a-truck
clause drops it. But it is **the only one of the 54 no-purchase rows with an empty
`serial_number`** (53 of 54 carry one). Make that explicit rather than relying on a side effect:

```sql
AND NULLIF(LTRIM(RTRIM(t.serial_number)), '') IS NOT NULL   -- a real VIN; excludes MCTEST by rule
```

A test record must be excluded because it is not a vehicle, not because it happens to lack a
purchase date.

### G6 — migration numbering will collide with the parallel session ⛔ coordination

Highest is **`0352_audit_row_change_ignores_telemetry.sql`** — the other session's
`DATA-LIFECYCLE-PLAN` L2 work. Its `TELEMETRY-SEPARATION-PLAN` will want **0353**, and so does E1.
`lint:migrations` requires the next number and refuses a gap or a duplicate. See §7.

### G7 — the in-service count moves 235 → 193, and that is visible

Any surface dividing by a vehicle count changes by ~18%. `docs/plans/...` records that finance is a
**fleet** report with per-truck retired ([[finance-is-a-fleet-report]]), so the blast radius is
probably small — **but it is unverified**, and E3 must enumerate count-consumers alongside
status-consumers. The owner should be told the number will move *before* it moves.

### G8 — nothing in the repo schedules the roster sync, and the owner's requirement is freshness ⛔

The owner's rule is *"when something changes in McLeod it should update"*. The agent
(`tools/mcleod-agent/agent.mjs`) reads LoadMaster on the carrier's private network and **POSTs
outbound** to our ingest endpoint — the right architecture, since Railway cannot reach `10.0.1.171`.
But its only entry points are **`pnpm` scripts run by hand**: there is no scheduler entry, no
GitHub workflow, and no Railway service that invokes it.

All 272 vehicle rows carry `updated_at` of today, so it **did** run today — but *what* runs it and
*how often* is **not knowable from this repository**, and the last `roster.vehicles_created` audit
row is 2026-09-01 while the 53 reserved rows were created 2026-09-08→14. **Fixing the predicate
without establishing the cadence leaves the roster correct only on days somebody remembers.** New
question **Q-6**, new item **E6**.

### G9 — `(org_id, unit_number)` is unconditionally unique, so F4 cannot rename in place

Found while writing E1's migration (2026-09-22). `vehicles` carries **two** unique indexes on the
same pair:

```
vehicles_org_id_unit_number_key    UNIQUE (org_id, unit_number)                      -- no predicate
uq_vehicles_org_unit_active        UNIQUE (org_id, unit_number) WHERE status='active'
```

⚠ **The first draft of this note claimed the partial index left `maintenance` and `ordered` rows
unprotected. That was wrong** — it was written after reading only the second index, which is a strict
subset of the first and therefore redundant. Unit numbers are unique per org **regardless of
status**, so F3 and F5 create no uniqueness hole and **no index migration is needed**.

What it does constrain is **F4**. Today unit 732 is two rows — `732` (retired, samsara-sourced) and
`G6AA-5HS-XTC` (active, McLeod-linked). Renaming the second to `732` **violates
`vehicles_org_id_unit_number_key`** while the first exists. So F4 is ordered, not atomic: rename or
remove the retired twin **first**, then rename the survivor. A single `update … set unit_number` will
fail with 23505, and that failure is the constraint doing its job rather than an obstacle to route
around.

### G10 — one status consumer lives in SQL, where E4's gate cannot see it

`platform_org_overview` counts `vehicles` per org with **no status filter at all**, so the internal
platform console will include `ordered` trucks once F5 runs. Checked at the same time and worth
recording as a shape: **E4's gate scans TypeScript**, so a comparison written in PL/pgSQL is
invisible to it. E3's enumeration must query `pg_proc`, not only grep the repo.

Verified alongside it, and the reason no other SQL change ships with E1: **no database function
branches on a vehicle status value.** The three functions whose source contains "retired"
(`record_part_movement`, `move_asset`, `guard_fleetpal_unit_match`) mention it only in comments, and
`move_asset`'s status column belongs to `inventory_assets`. No CHECK constraint exists on
`vehicles.status` — the enum is the constraint. No RLS policy compares it.

### Assumptions still standing, stated rather than buried

| # | assumption | status |
|---|---|---|
| A1 | `tractor_status` `V`=available, `S`=shop | Owner's reading, corroborated by behaviour (§1.3). Not cited from `labelfile`. Q-2, non-blocking under D-FC9. |
| A2 | A reserved row gains `purchase_date` on delivery | Every delivered block 764–810 did (§1.1). Self-healing if wrong — the row simply stays `ordered`. |
| A3 | McLeod's `service_status` is actively maintained | Strong: 471 of 472 deactivated rows also carry an `outservice_date` (§1.4). |
| A4 | The sync runs often enough to matter | **UNVERIFIED — G8.** |

## §5 — Explicitly NOT in this plan

- The `liveMapBoard` retired filter (D-FC3).
- Any new telematics collector. The feed is healthy (§1.9) and coverage of gateway-fitted trucks is
  100%.
- `DATA-LIFECYCLE-PLAN.md` L4 / `hos_duty_segments`. The duty overlay is exonerated (§1.10).
- Renaming trailers, or any `D-MR11` unit-number rewrite beyond F4's single audited merge.
- Any `vehicle_status` value beyond `ordered` (D-FC10). `maintenance` already exists and is used as-is.
- A general-purpose vehicle **delete** path. §1.8a — 13 CASCADE edges; retirement and `ordered` cover
  every lifecycle state the carrier has.
- The trailer half beyond E5's predicate fix (§1.8b). No trailer status vocabulary changes here.

---

## §7 — Parallel-session protocol (this plan runs alongside `DATA-LIFECYCLE` / `TELEMETRY-SEPARATION`)

Another session is working `DATA-LIFECYCLE-PLAN` and `TELEMETRY-SEPARATION-PLAN` in the **same
checkout**. State at audit time: branch `main`, **no open PRs**, highest migration
`0352_audit_row_change_ignores_telemetry.sql`.

**Overlap surface — where the two plans can collide:**

| surface | this plan | the other plan | rule |
|---|---|---|---|
| `supabase/migrations/` | E1 wants the next number | `TELEMETRY-SEPARATION` wants it too | **Claim the number in a pushed branch before writing the file.** `lint:migrations` refuses a gap or a duplicate, and a rebase renumber is a silent conflict. |
| **`vehicles` table** | `status`, roster columns | telemetry/satellite columns (`0262`, `trg_vehicle_learned_satellites`) | **Different columns, no shared writer.** Safe *only* if neither touches the other's — E0 must not go near the telemetry columns, and the satellite work must not touch `status`. |
| `scripts/table-modules.json` | E0 must keep the writer count at 60 | telemetry separation moves writers | **Both edit this file.** Coordinate or expect a conflict; it is small and hand-mergeable, but re-run `lint:table-modules` after any merge. |
| `package.json` + `.github/workflows/ci.yml` | E4 adds `lint:vehicle-status` to both | L-series may add its own gate | Both append to the `gates` job. Conflict is textual and easy, **but a botched resolve silently drops a gate** — verify with `gh run view` that the new gate name appears. |
| `packages/shared/src/constants.ts` | E2 edits `VEHICLE_STATUSES` | unlikely | Low risk. |

**Branch and PR discipline** — from [[parallel-chats-share-one-working-tree]], which records three
real incidents in this checkout:

1. **Branch explicitly from the remote, never ambient HEAD:**
   `git fetch origin && git checkout -b claude/<topic> origin/main`
2. **Re-check `git branch --show-current` immediately before every commit.** The checkout can move
   under you mid-task; a commit then lands on the other session's branch and the push reports success
   while pushing nothing.
3. **Before opening a PR:** `git log --oneline origin/main..HEAD` must list only your commits, and
   `git diff --stat origin/main...origin/<branch>` is authoritative — `gh pr view --json changedFiles`
   is cached from creation time and goes stale.
4. **One merge from §3's table = one PR.** No stacking: a stacked PR lands in its parent if the base
   is deleted ([[stacked-pr-merge-trap]], [[deleting-a-base-branch-closes-its-stacked-pr]]). Merge to
   `main`, then branch the next one fresh from `origin/main`.
5. **Never `git stash pop`** in this checkout — it can take another session's stash
   ([[git-stash-pop-takes-another-sessions-stash]]).

**Branch names reserved by this plan**, so the other session can avoid them:
`claude/idle-weather-cache-parse` (merge 1) · `claude/vehicle-status-ordered-enum` (2) ·
`claude/vehicle-status-derived` (3) · `claude/mcleod-census-predicate` (4) ·
`claude/roster-census-reconcile` (5).

## Progress log

- **2026-09-22** — Opened, then rewritten twice. (1) The first pass's "56 trucks have no telematics"
  was **wrong**: coverage is 100%, and the 56 are 53 reserved unit numbers plus 3 purchased trucks in
  the gateway queue (§0.2, §1.1, §1.2). (2) Owner stated the mastery model (D-FC0) and ruled Q-2 and
  Q-4: `S` = shop, `V` = available, and **nothing McLeod still carries gets retired by us**. The
  census moved from P2 to **P4** — membership from `service_status` alone, `outservice_date` no longer
  read at all (D-FC2), and `tractor_status` demoted from gatekeeper to sub-status (D-FC9), where `S`
  lands on the `maintenance` value `liveMapBoard.ts` has been waiting for since 0001. Delta measured:
  12 trucks return, 54 rows leave, 12 become `maintenance`, 0 creates (§1.8). Q-1 answered without
  owner input: unit 732 is a duplicate carrying a Samsara gateway serial as its unit number, the only
  such row (§1.7). `weather_cache` found never to have been read successfully (§1.11). Nothing
  implemented.
- **2026-09-22 (later)** — **Q-3 RESOLVED by research, and the research found a defect in this
  plan.** Deletion rejected on the FK graph: 33 keys reference `vehicles.id`, **13 of them CASCADE**,
  so a delete path is a standing hazard regardless of these 53 clean rows. Chose
  `status = 'ordered'` (D-FC10), mirroring the live `drivers.status='applicant'` /
  `EMPLOYED_DRIVER_STATUSES` pattern, with the 0077/0210/0266/0279 enum convention and its ONE-WAY-DOOR
  caveat. ⚠ The real finding was elsewhere: **17 sites hand-write a vehicle status comparison, and
  `equipmentInspection.ts:205` would have dropped 12 shop trucks out of the §396.17 annual-inspection
  roster the moment F3 created the first `maintenance` row** — a compliance regression authored by
  this plan, not by the code. D-FC11 makes the predicate derived; E3 lands **before** F3; E4 gates the
  next copy. Trailers carry the same shape at 9 rows (§1.8b, E5). Sequencing rewritten to five
  ordered merges.
- **2026-09-22 (pre-implementation audit)** — §4a. Eight gaps, **three of which would have broken the
  build-out**: the ingest has **no path to write `status` on an existing row** (G1 — F3 was a silent
  no-op; new item E0), the retire path only retires rows that are literally `active` so a
  `maintenance` truck would become **unretirable** (G2), and `neq("status","retired")` — 11 sites
  including four idle composables — would have **gained 53 phantom trucks** the day `ordered` landed
  (G3), recreating the exact inflated denominator this plan exists to remove. Also: the "17 sites"
  figure was imprecise and is now E3's first deliverable rather than a prose claim (G4); `MCTEST` is
  excluded by accident and gets a principled clause (G5); migration numbering will collide with the
  parallel session (G6, §7); the in-service count moves 235 → 193 and count-consumers are unenumerated
  (G7). **G8 is the one the owner should see first: nothing in this repository schedules the roster
  agent**, so "when McLeod changes, our list updates" is currently unverified — Q-6 and E6. Four
  standing assumptions listed explicitly rather than left implicit. §7 adds the parallel-session
  protocol and reserves five branch names. Still nothing implemented.

- **2026-09-22 (merge 3 — E2 + E3 + E4)** — The vocabulary is now derived everywhere.
  `IN_SERVICE_VEHICLE_STATUSES` and `isInServiceVehicleStatus` added beside `VEHICLE_STATUSES`,
  mirroring `EMPLOYED_DRIVER_STATUSES` three lines below them. **E3's authoritative enumeration is
  8 `.from("vehicles")` chains** (not the 17 §1.8a guessed — G4 said the number would be produced,
  not asserted, and it was): `fuelIdleVerdict.ts`, `idleLearnedEnvelopeSync.ts`, `askData.ts`,
  `equipmentInspection.ts`, and the four web idle composables — plus `rosterRetire.ts` (G2) which is
  TS logic rather than a query. All converted; `equipmentInspection`'s **trailer** branch converted
  with it, since a trailer in a shop had the same bug.
  ⚠ **An existing test caught the change and that is the point**: `equipmentInspection.test.ts`
  asserted `val: "active"` on the default listing. It was pinning a spelling the intent had outgrown,
  and it is now updated to the in-service set with the reason recorded in place.
  ⚠ **`useIdleCapabilities.ts:58` was missing from §1.8a's list entirely** — the first enumeration
  script ended a chain at any line not starting with `.`, which a multi-line `.select()` argument
  does. That is why **E4 parses the AST instead of matching text**: a second regex walker, written to
  fix the first, then swallowed sibling queries inside a `Promise.all([...])` and attributed one
  row's filter to the query above it. A gate whose failure mode is a false negative certifies an
  absence it cannot see. `lint:vehicle-status` is proved against three planted violations —
  `.eq` literal, `.neq` literal, and one inside a `.vue` script block — exits 1 on each and 0 clean.
  Registered in `package.json` with its `//lint:vehicle-status` key **and** by name in `ci.yml`'s
  `gates` job.
  Verification: typecheck 0 · lint 0 · 15 named gates each 0 · shared 3068 · api **4205** · web
  **2109**. Mutation-proved: reverting `rosterRetire` to `=== "active"` fails exactly *"retires a
  truck that is in the SHOP"*; reverting `equipmentInspection` to `.eq("status","active")` fails two
  inspection tests by name.
  ⚠ Carried forward, not fixed here: `trailers` shares `vehicle_status` and the **trailer form now
  offers `ordered`**, a value no trailer will hold until E5 — cosmetic, named in `constants.ts`
  rather than discovered later. And a cancelled reservation leaves an `ordered` row with nothing to
  clear it, since the retire sweep only reaches in-service rows; that is F5/E6 territory and is 53
  rows at most.

- **2026-09-22 (merge 4 — E0 + F1 + F2 + F3 + F6)** — The census predicate is McLeod's own active
  flag, and the sweep can finally act on what it reads. Re-measured against the live LoadMaster
  immediately before the PR, through the agent's real `fetchRoster`, not by hand:
  **P4 selects 193** (was 228 — 53 reserved unit numbers out, 18 running trucks in), **12 of them
  carry `tractor_status = 'S'`** and land on `maintenance`, **0 rows have neither a purchase date nor
  a model year**, the retirement payload is **459** (was 478), and the two sweeps **overlap on
  nothing**. Units 552, 555 and 569 are no longer nominated for retirement.
  · **E0/F3** — `vehiclePatch` writes `status`, derived by `deriveVehicleStatus` in
  `packages/shared/src/tms.ts` (no purchase date and no model year → `ordered`; shop → `maintenance`;
  else `active`), applied through the existing `applyOutcome` UPDATE, so no new `.from("vehicles")`
  writer and no `lint:table-modules` entry. It is the ONE field `vehiclePatch` writes
  unconditionally, because it is derived rather than supplied — there is no "McLeod did not fill it
  in" case to protect. Un-retiring is the intended direction (D-FC0), and office-owned rows never
  reach the patch at all.
  · **The vendor letter does not cross the wire.** `tractor_status` is selected in `queries.mjs` and
  mapped to a neutral `in_shop` boolean in `roster.mjs`; `tms.ts` never learns a McLeod spelling.
  Verified on the live payload: `tractor_status` is not a key on any of the 193 rows.
  · **F6** ships on BOTH retirement paths, and the reconcile path needed it more: absence is a weaker
  claim than a nomination, and a truck drops out of a reconciliation for any reason the ACTIVE
  predicate is narrow — which is what F1 just changed. `heldMoving` is reported and lands in the
  `mcleod.roster_reconciled` audit row, which is now written even when the guard held everything,
  because a sweep that changed nothing for that reason is what a wrong predicate looks like from the
  inside. Read through `readVehiclePositions` (samsara's own interface — `vehicle_positions` is
  `layer=raw`), so `check-feature-boundaries.mjs` gains `mcleod -> samsara` with its reason.
  ⚠ **Found while shipping F2, and fixed in the same merge: `/roster/vehicles/retire` had never been
  able to retire a truck.** `tmsRetireInputSchema` carries `inactive | terminated` — the vocabulary
  of a person leaving — and `vehicles.status` is the `vehicle_status` enum, so every equipment
  retirement failed with 22P02 and `if (!upErr) out.retired++` discarded the error. The endpoint
  answered `retired: 0` with no failure, which is indistinguishable from a sweep with nothing to do.
  The payload's word is now mapped to the row's (`retired`), failures are REPORTED in `failed[]`, and
  the bad-fetch cap counts `IN_SERVICE_VEHICLE_STATUSES` rather than the literal `"active"` E3 left
  at line 97 — which would have put the 12 shop trucks outside its own denominator.
  Verification: 12 mutations, 12 killed, each named in the PR. First run of that battery reported 7
  of 7 SURVIVED and was itself the bug — `pnpm vitest | tail` returns `tail`'s status, the exact trap
  the merge-3 working rules record. api 4223 · shared 3080 · agent 6 new.
  ⚠ **Q-7, new and unanswered (see §4).** `status` is deliberately NOT in 0241's claim-trigger
  column list, so the parity test carries its first named carve-out: the claim is whole-row, and a
  hand-edited status would stop McLeod refreshing that truck's VIN, plate, registration and
  inspection date for good — the defect 0286 had to unpick, in a wider form. The consequence is that
  `VehicleForm.vue` still offers a status field the next sweep may revert within the hour.

- **2026-09-22 (merge 5 — F5 only; F4 DEFERRED)** — Migration `0355`, data only, no schema change.
  **F4 was implemented, then withdrawn before it merged, because its premise was wrong.** I read two
  `samsara_vehicle_id`s and a `- OLD` name suffix as two physical trucks and rewrote §1.7 to say so.
  The owner corrected it: `- OLD` is how this fleet renames a Samsara record when a GATEWAY is
  REPLACED. The vendor data had said the same thing all along in a field I had already fetched and
  not read — `732 - OLD` carries `gateway: {serial: "", model: "none"}`. §1.7a records the wrong turn
  in full, because it is the SECOND time this plan has mistaken a vendor's name for a measurement
  (§0.2 was the first). F4 is a merge, not a rename, and it now waits on **Q-9**.
  · **F5 shipped alone** and is unchanged in substance: McLeod's own 53 ids, pinned, with three
  same-table guards. The reasoning that matters is still that the obvious predicate over our own
  columns selects **60** rows — units 804–809 and 811 ride along on a stale `purchased_at` — and that
  unit 811 defeats the "no gateway, no fills" guard too, because a purchased truck waiting for its
  gateway IS a truck (D-FC4).
  · **The owner's actual question is answered in §1.7b, and it was bigger than unit 732.** One
  `mcleod.roster_reconciled` event on 2026-09-14 retired **33 vehicles, 11 of them still fuelling**.
  Two causes: five had the stale-`outservice_date` problem F1/F2 fixed, and **six were retired for
  having no McLeod link at all** — `reconcileAbsentFromTms` reads a NULL link as absence. That defect
  is untouched by merge 4 and will fire again on the next reconcile. New item **F14**, which also
  carries the F6 lesson: **the guard reads telematics and 732's device was out while its card was
  still buying diesel**, so it must read fuel too.
  · ⚠ Migration number collision, exactly as §7 predicted: the parallel session merged
  `0354_efs_processing_run_attempt_ceiling.sql` while this work was in flight, so this file is
  **0355**. The branch was rebuilt on the new `origin/main` rather than renumbered in place.
  Verification: matrix `supabase/tests/reserved-units-ordered.test.mjs` applies every migration up to
  0355, seeds the six production shapes and applies it — 12 assertions, all green, including
  *"unit 811 — a purchased truck still waiting for its gateway — is NOT marked"*, which is the one
  the destructive version fails.
  · A question the withdrawn F4 raised and the correct reading dissolves: the 11 fills that have
  landed on the retired row since the swap are **not** misattributed to another truck. They are unit
  732's own fills on one of unit 732's two rows, and where they end up is decided by Q-9's merge
  rather than by a re-attribution decision of their own.

- **2026-09-22 (E5 — the trailer census)** — **§1.8b's premise was wrong, and E5 as written would have
  been a no-op at best.** Measured against the live McLeod before any code: the nine `'A'` trailers
  with no purchase date are **eight test fixtures and one 2014 Utility reefer** (534115) carrying a
  VIN, a model year and a link. Trailers have **no reservation shape**, so the purchase-date clause is
  deliberately NOT carried over; it could only ever drop a real trailer. The part of E5 that mattered
  was the other half, `outservice_date`, and it is D-FC2 again. Three `'A'` trailers carry one: a fixture,
  **532167** (dated 2020-05-04; **17 settled movements in the 60 days** before the measurement,
  retired here as `R532167`), and **536132** (dated 2026-06-25; McLeod still `'A'`, last movement
  2026-07-23, `trailer_status = 'I'`).
  · **G1 had a trailer twin.** `trailerPatch` never wrote `status`, so fixing the predicate alone
  would have linked R532167 on the next identity sweep and left it retired. It now writes `active`,
  with the same claim-trigger carve-out as the vehicles' (`rosterFields.claimParity.test.ts`).
  · **`trailer_status` is not the tractor's letter.** `S` is on **39 of 223** trailers and **all 39
  moved** in the 30 days measured (16.4 movements each against 13.5 for `A`). Mapping it to
  `maintenance` by analogy with D-FC9 would have parked 17% of the trailer fleet. It is not read.
  · Predicates: active = `is_active = 'A'` + a serial number (G5) + the fixture-name fence;
  retirement = `is_active <> 'A'` alone (all 172 deactivated rows carry an `outservice_date` anyway).
  **Live dry run through the new queries: 223 active (link = identity), 172 retiring, 0 overlap**, was
  221 / 175. The plan's "231 → 222 with the 9 named" was never going to be the number.
  · Delta on the next identity sweep: **two trailers reactivate**, R532167 and 536132, both
  samsara-sourced and unlinked, so both claimable. 536132 is the one to watch: McLeod calls it
  active and it has not moved since July. We follow McLeod (D-FC0), and if that is wrong it is
  McLeod's flag to change.
  · Mutation-proved: dropping the status write fails *"un-retires a trailer McLeod still carries,
  matched across the R prefix (E5)"* and the carve-out test; putting either `outservice_date` clause
  back fails *"the trailer census does not read outservice_date in either direction"*.
  · Like everything since merge 4, **inert until the agent runs** (Q-6).

- **2026-09-22 (Q-7 decided and built — the office no longer edits a status McLeod writes)** — The owner
  delegated Q-6/Q-7/Q-9 to analysis. Q-7 went to **(a)**, as recommended: nothing in the carrier's
  data asks for a local override McLeod cannot express — `tractor_status` already carries the shop,
  and a wind-down truck is McLeod's to deactivate (Q-4). (b) remains available later with nothing
  to undo.
  · **One rule, derived.** `isStatusFromTms` (`packages/shared/src/tms.ts`) is true exactly when the
  sweep writes the row: a TMS link AND a claimable provenance. The claimable set moved out of
  `rosterIngest.ts` into `TMS_CLAIMABLE_SOURCES` beside it, so the ingest and the web read ONE list —
  a copy in the web would have been the second definition this plan's register forbids.
  · **Three office writers of status found, not one.** `VehicleForm`/`TrailerForm` (now disabled
  with *"Set in McLeod. Change it there."*), the per-row **Retire** action on both pages (hidden for
  McLeod-linked rows), and the trailers page's **bulk Retire** (leaves McLeod-linked rows out and
  says how many in the toast). The vehicles' bulk update only ever touched idle equipment.
  · **Not enforced in the database, deliberately.** A PostgREST write that goes round the form is
  reverted by the next sweep, which is the same outcome the rule describes; a trigger would be a
  second place to maintain `TMS_CLAIMABLE_SOURCES` in SQL. Stated rather than implied.
  · Mutation-proved: dropping the link test from the predicate fails *"stays the office's on a row
  McLeod has never linked"*; un-disabling either select fails its form's *"shows a McLeod-linked
  … status read-only, and says where it is set"*.
- **2026-09-22 (the identity sweep ran — merges 4, 5 and E5 are now real)** — Run by hand from the
  owner's machine at the owner's instruction, `ROSTER_MODE=identity --full`, after production had
  been confirmed serving #970. Result, read back from production rather than from the agent's log:
  **181 active + 12 `maintenance` + 53 `ordered` + 26 retired** trucks (the prediction was 181 + 12),
  552 / 555 / 563 / 569 re-linked and active, **trailers 223 active** with R532167 and 536132 back.
  ⚠ **568 did not return, and the reason is the owner's vocabulary, not a defect.** McLeod's
  link sits on `568 - OLD`, 97 fills on a retired `568`, and Samsara carries BOTH `568 - OLD` and
  `568 - SOLD` for one VIN. Owner-stated: *`- OLD` = the device was changed; `- SOLD` = the truck
  was sold and is out of the fleet.* So 568 is a sold truck McLeod still reports as active — the
  same position as Q-4's wind-down units (eight trucks carry a `- SOLD` Samsara record while McLeod
  keeps them `'A'`; three of them fuelled in the past week). Not merged, deliberately: the fix is
  McLeod's flag, after which the retirement sweep retires it (D-FC0).

- **2026-09-22 (Q-9 decided, and the merge found a tax-filing defect first)** — (a) as recommended:
  the history row survives. Researching the move found what the plan had not measured:
  · **IFTA would have lost three weeks of one truck.** `samsara_ifta_jurisdiction_miles` was unique
  on (vehicle, month, jurisdiction) and `monthsToSync` re-fetches the last three closed months. After
  a merge, re-fetching August would upsert the new gateway's eight days over the old gateway's
  twenty-four. **0357** adds a key naming the device (index only — the deploy window); **0358** drops
  the vehicle-only key in the same merge as the writer that upserts on the wide one. Every reader
  sums, so no total moves.
  · **The move is ~650 rows, not 59**, across ten tables — the plan counted only the two day
  rollups. None is evidence; the 102 fills, 347 financial entries and the card never move.
  · **0359** merges through every foreign key into `vehicles` generically, resolves the measured
  collisions (spend-days dropped and rebuilt — derived; swap-day engine and idle seconds summed with
  coverage capped; the later odometer reading kept; the live device's position kept; both devices'
  IFTA kept) and FAILS, rolling back, if anything still references the retired row. The retired row
  becomes `732-merged-698c08f1`: no link, device or VIN. Not deleted (§1.8a).
  · Checked before writing: 0241 exempts a write with no JWT role, so the survivor is not claimed for
  the office; McLeod is roster master, so the Samsara sync is link-only and will never recreate
  `732 - OLD` (it carries no VIN, so it cannot match by VIN either).
  · `supabase/tests/merge-unit-732.test.mjs`, 30 assertions over production's shapes. Mutations:
  un-capping coverage, keeping the earlier odometer reading, dropping `identity_source = 'mcleod'`,
  not dropping the spend-days, keeping the pulled device — each fails the assertion named for it.
  · **Owed after deploy:** `POST /api/fuel/spend-rollup` for 2026-08-24 onward, so the history row's
  spend-days pick up the moved telemetry; the nightly rollup only reaches back 14 days.
