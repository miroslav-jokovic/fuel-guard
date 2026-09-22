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
| **F4** | Merge 732's duplicate: one row, `unit_number = '732'`, McLeod-linked. Audited act, human-reviewed, not a sync side effect (D-FC5). | No `vehicles` row has a gateway-serial unit number; 732 renders as `732`. |
| **E0** | **Give the ingest a status-reconcile path** (G1). Status becomes part of the update patch, derived from McLeod by one pure function in `packages/shared` — `ordered` \| `maintenance` \| `active`. Routed through the existing `applyOutcome` update, never a new `.from("vehicles")` write site. | A unit test drives all three transitions; mutating the derivation to a constant fails it. `lint:table-modules` still reports 60 grandfathered sites, not 61. |
| **E1** | Migration, **value only, nothing else in the file**: `alter type vehicle_status add value if not exists 'ordered';` — per the 0077/0210/0266/0279 convention, with their ONE-WAY-DOOR header. | `pg_enum` carries the value in production; no code references it yet. |
| **E2** | `VEHICLE_STATUSES` gains `ordered`; add `IN_SERVICE_VEHICLE_STATUSES` (D-FC11). Zod schemas in `fleet.ts:37,258` follow the constant, so they need no edit. | `pnpm typecheck` forces every exhaustive `switch` on `VehicleStatus` to be revisited — that is the audit doing its job, not a failure. |
| **E3** | Enumerate every vehicle status comparison with E4 in report mode (G4), then convert. Covers **both** directions: `= "active"` sites that would lose shop trucks (`equipmentInspection.ts:205`, `askData.ts:415`) **and** `<> "retired"` sites that would gain 53 `ordered` trucks (`useIdleBreakdown.ts:181`, `useIdleDrivers.ts:84`, `useIdleConfidence.ts:72`, `useIdleCapabilities.ts:62`, +7 API) — G3. **Includes `rosterRetire.ts:191`** so a `maintenance` truck stays retirable (G2). Enumerate count-consumers at the same time (G7). | The §396.17 roster returns 193, not 181; the idle denominator does **not** move when 53 `ordered` rows appear; a mutation flipping either filter back fails a test by name. |
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
