# Fuel savings report + our own idling engine

Opened 2026-10-01. Decision IDs `D-FSV*` (fuel savings report), `D-IE*` (idle engine), `D-FL*` (fleet
list). Open questions `Q-FSV*` / `Q-IE*`. Progress is a dated log at the END (§7), never edits to table rows.

**Why this plan exists.** The owner's review of the Fuel Spend page on 2026-10-01: the wording is
unreadable to a fleet manager, the numbers do not all hold up, Reconcile is unusable, and the page does
not answer the one question it exists for — *where can we save money on fuel*. Measured that day, the
answer is overwhelmingly **idling** (§1), so the report and the idle engine are one programme.

Supersedes for the spend page: `FUEL-SECTION-CONSOLIDATION-PLAN.md` C5's three-tab layout (D-FUI4).
Supersedes for idling: the verdict layer audited in `DATA-PRECISION-AUDIT-2026-09-20.md` §3
(D-IDLE1..6, D-IDLE-A..F) and `docs/plans/IDLE-AVOIDABLE-HOS.md`. Builds on, does not reopen:
D-MPG1..6 (`FLEET-MPG-CONSOLIDATION-PLAN.md`), D-FC0 (`roster/FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md`).

---

## 1. Measured facts (production, read-only, org `86d6b3ea`, 2026-10-01)

### 1.1 What is right

- **Spend and gallons are exact.** September tractor spend is **$1,312,207** in `fuel_spend_days`,
  `fuel_spend_lines()` and raw canonical `fuel_transactions` — to the dollar; every complete week to
  the cent.
- **Station resolution is 98%** (1,887 of 1,926 September tractor fills carry a station → brand, state,
  site). That is enough to filter by state, location and network.
- **Engine-state coverage is real:** 187 trucks, ~24 h/day of On/Idle/Off from Samsara's
  `engineStates` history, already folded into `vehicle_engine_days`.
- **Trailers match McLeod 1:1** — 223 active trailers, every one linked by `mcleod_trailer_id`, zero VIN
  mismatches. The only McLeod-active trailers we do not carry are 8 test units (`TEST*`, `TSTROMAN`).

### 1.2 What is wrong

| # | Defect | Measured |
|---|---|---|
| W1 | **Samsara idle events stored twice.** Every event arrives under two `eventUuid` encodings (a UUID and the hex of its uppercase ASCII); `idleSync.ts` de-dupes on that id alone. | Sep 1–28: 70,244 rows = **35,122 pairs, exactly 2 each**. 52,281 h stored vs 25,850 h of engine-state idle. De-duplicated events ≥ 10 min: 24,600 h — agrees with engine state. Readers: `useIdleScores`, `useLongIdles`, `useDriverPerformance`, `driverPerformanceSnapshot`, `askData`. **Driver idle figures are doubled.** |
| W2 | **Spend-page miles are not driven miles.** `spendPeriodTotals.ts:306` prints `gallons × MPG`, where MPG comes from fill-to-fill odometer intervals spread over days. | August: **1,769,895** vs Samsara IFTA **1,632,627** (+8.4%). MPG 7.53 shown vs 6.94 IFTA-based. July agreed (−0.15%). |
| W3 | "Fills" counts tractor **and reefer**, beside tractor-only gallons/spend. | 429 vs 405 tractor fills (week of 08-24). |
| W4 | Headline tiles describe the last *complete* period, not the picked range. | 90-day pick → tiles show one week ~10 days old. |
| W5 | Reconcile results live in a component `ref` and vanish on close; `useReconRunsQuery()` has no caller. | 3 runs ever (last 2026-09-14), **0 statements ever saved**. |
| W6 | Avoidability is granted only by admin equipment flags that were never filled in. | `has_apu` null on most of the fleet → 30–35 trucks scored of ~187. |
| W7 | Two idle mechanisms never produced an answer. | learned envelope: **0 evidenced**; optimized envelope: **0 evidenced**; `optimized_cycling`: **0 sessions**. |
| W8 | Truck list: our `active`+`maintenance` = 195 vs McLeod census (P4) 190. | `568 - OLD` is active and linked to McLeod 568 while McLeod's real 568 is retired here; 632–635 retired here but active in McLeod; 51 `ordered` rows 804–864 not yet in the frozen sandbox; make/model spelled 6 ways (`FRHT`/`FREIGHTLINER`, `LT625`/`LT 625`/`lt625`/`LT-625`); 784–788 have NO model in McLeod; ours came from Samsara's vehicle record (`samsaraVehicleSync.ts:142`) — `CASCADIA` ×4 and `LT625` for 787, whose VIN `3AKJHHDR…` is a Freightliner with the same body code as every Cascadia here. |

### 1.3 Where the money is (September)

| Lever | Size | Notes |
|---|---|---|
| Idle (engine on, stopped) | 25,850 h × ~0.72 gal/h × $5.75 ≈ **$107k/month** | The only lever that is large. |
| Billed above Pilot contract quote | **$2,192** | Recoverable claim. |
| Out of network | 30 fills, $12.7k spend, ~**$700** premium | ONE9 15, Love's 8, others 7. |
| Pilot vs Flying J | 6.3 ¢/gal × 84k gal ≈ $5k | May be state mix; the state filter will tell. |

### 1.4 Idle burn rate — research and our own data

- **Argonne National Laboratory**, "Analysis of Technology Options to Reduce the Fuel Consumption of
  Idling Trucks" (ANL/ESD-43, 2000): **~1.0 gal/h** at 1,000 rpm with HVAC load (TMC 1995).
  https://publications.anl.gov/anlpubs/2000/08/36930.pdf
- **Argonne Idling Reduction Savings Calculator**, no accessory load: tractor-semitrailer 80,000 lb
  **0.64 gal/h**. https://www.anl.gov/sites/www/files/2018-02/idling_worksheet.pdf
- **Gaines, Vyas & Anderson** (Argonne), national estimate assumes **0.8 gal/h**.
- **EPA420-R-02-025**: 1,000 rpm burns nearly 2× the fuel of 600–750 rpm.
- **Our fleet, Samsara-reported idle fuel per event** (de-duplicated, events ≥ 10 min, Sep 1–28,
  24,600 h): **0.743 gal/h at 50–75 °F, 0.705 at 75–90 °F, 0.706 at 90 °F+**, 0.806 at 32–50 °F.
  Inside Argonne's 0.64–1.0 band and below today's configured **0.80**.

### 1.5 Temperature rules

Samsara's "unproductive idling" temperature rule is a **dashboard setting**; our call to
`GET /idling/events` (`samsara.ts:361`) passes no `minAirTemperatureMillicelsius` /
`maxAirTemperatureMillicelsius`, so whatever is set there **never reaches us**. Our own
`idle_settings` holds `comfort_low_f 20`, `comfort_high_f 85` (suggested 30/70) and
`min_idle_minutes 5`. Samsara's docs: the event's temperature is the average of up to its first five
readings. https://kb.samsara.com/hc/en-us/articles/7777755254669-Idling-Report ·
https://developers.samsara.com/reference/getidlingevents

### 1.6 Equipment, by McLeod purchase batch (sandbox `lme_analytics`, restored 2026-09-10)

**McLeod records no APU or idle equipment.** `tractor` has no such column, `comments` is empty on all
251 active rows, `planning_comment` says only "Highlander"/"FOR SALE". What McLeod DOES give is the
purchase batch (make, model, model year, purchase date). Behaviour column = share of parks ≥ 4 h
(2026-08-15 → 09-28) spent > 80% idling / < 20% idling.

| Batch (bought) | Units | Long parks: idling / engine off | Ruling |
|---|---|---|---|
| FRHT CA 2020–2021 (2020) | 506–610, 727 | 14–80% / 18–53% | **No APU, no OI** (owner, D-IE7) |
| INTL LT625 2022/23 (2022-07-05) | 632–635 | — (retired here) | No APU, no OI (owner); census Q-FL1 |
| FRHT CA 2023 (2022-08 → 2023-01) | 637–652 | 32–50% / 31–45% | **ask** — behaves like no-APU |
| FRHT CA 2024 (2023-03) | 654–663 | 52% / 27% | **ask** — behaves like no-APU |
| FRHT CA126SLP 2024 (2023-06) | 664–671 | 63% / 25% | **ask** — behaves like no-APU |
| FRHT CA126 2024 (2023-08) | 672–678 | 58% / 30% | **ask** — behaves like no-APU |
| FRHT CA 2024 (2023-10) | 679–685 | 35% / 44% | **ask** |
| FRHT CA 2025 (2024-02 → 2024-10) | 686–711 | 39–60% / 26–50% | **ask** — behaves like no-APU |
| INTL LT625 2025 (2024-10-25) | 712–717 | 51% / 33% | entered none → keep |
| FRHT CA 2020 bought used (2025) | 718, 754 | 76% / 18%; 35% / 62% | 754 entered battery; **ask 718** |
| INTL LT625 2025 (2025-02-21) | 719–722 | 27% / 55% | **ask** — mixed |
| INTL LT625 2025 (2025-03-06) | 723–726 | **0% / 86%** | **ask** — behaves like battery APU |
| INTL LT625 2026 (2025-05-01) | 728–753 | **8% / 79%** | **ask** — behaves like battery APU (6 entered battery, 4 none) |
| FRHT CA 2026 (2025-09-18) | 762–763 | 4% / 60% | entered battery → keep |
| FRHT PJ126 2027 (2026-04-14) | 764–768 | 4% / 86% | **Battery APU** (owner, D-IE7) |
| INTL LT625 2026 (2026-06) | 769–783 | 41–58% / 34–49% | **ask** — behaves like no-APU (several entered "OI only") |
| FRHT 2027 (2026-06-19) | 784–788 | 3% / 78% | **Battery APU** (owner) |
| INTL LT625 2027 (2026-08 → 09) | 789–803, 810 | 0–7% / 71–88% | **Battery APU** (owner) |
| On order (ours `ordered`) | 804–809, 811–864 | — | Battery APU if MY 2027 (owner) |

---

## 2. Owner rulings, 2026-10-01

- **R1** One page, no tabs: daily EFS transactions, gallons, MPG, trend cards; filters = date range,
  trucks (multi), state, location, network. Purpose: find savings.
- **R2** Same architecture as every feature: collectors at the bottom, harness (engine + SQL + API) on top.
- **R3** Do NOT use Samsara's native idling numbers — build our own idle engine.
- **R4** Four engine buckets per truck per day (total running, stopped-running, moving-running, stopped-off).
- **R5** Battery APU makes short stopped-running acceptable; continuous running is avoidable.
- **R6** Store temporarily, keep totals; hourly grain is acceptable.
- **R7** Units **500–635: no APU, no Optimized Idle.** **All MY 2027: battery APU.** **No diesel APUs in the fleet.**
- **R8** Burn rate: research official figures AND build a learning engine; compare.
- **R9** Temperature limits: Samsara has them — check (done, §1.5).
- **R10** **On duty > 1 h with the engine running: idle past the first hour is avoidable.**
- **R11** Out of network = **anything not Pilot / Flying J**; ONE9 is out (discounts are Pilot/FJ only).
- **R12** Clean all truck data; the truck AND trailer list must be 100% precise.

---

## 3. Decisions

### Fuel savings report

- **D-FSV1 — One page, filters not tabs.** `/fuel-spend` becomes one report. Statements and Reconcile
  leave it (D-FSV8). Filters: date range (`DateRangeFilter`, calendar days in the carrier's zone), trucks
  (multi), state (multi), location (station, multi, searchable), network (`in` Pilot/FJ · `out` ·
  `unknown station`).
- **D-FSV2 — Network is derived, never stored.** `in_network = brand in ('pilot','flying_j')`, read from
  ONE constant in `packages/shared` (the contract brands), which `route_fuel_settings` already models.
  Unresolved station = its own bucket, never folded into either side.
- **D-FSV3 — Trend cards compare the picked range to the PREVIOUS range of equal length**, both stated
  on the card ("09/01–09/30 vs 08/02–08/31"). Retires W4's "last complete period".
- **D-FSV4 — Miles are measured, not implied.** Miles = Samsara odometer distance (`readFleetDistance`,
  bounding readings), the D-MPG1 definition. `gallons × MPG` is deleted from display. Cost per mile =
  tractor spend ÷ measured miles; reefer and DEF are reported beside it, not inside it.
- **D-FSV5 — MPG per day is a rolling 7-day MPG.** D-MPG6 stands: a single day's purchased gallons do
  not measure that day's burn. Each day shows its trailing-7-day MPG. True daily MPG is D-IE6's
  ECU-fuel spike, not a guess. **MPG is fleet/truck only**: under a state, location or network filter
  the card says "MPG is a truck figure and doesn't apply to a station filter" rather than inventing one.
- **D-FSV6 — One SQL function returns measurements, TypeScript owns verdicts** (Q8 of the precision
  audit). `fuel_report_days(p_from, p_to, p_org, p_vehicles, p_states, p_sites, p_network)` →
  per-day fills, gallons, spend, retail, contract, by network. Server pages; no browser
  `.from()` reads, no 1,000-row cap.
- **D-FSV7 — Plain words, MM/DD/YYYY.** Labels per §5. No "rollup", "truck-days", "tie-out",
  "leg", "resolved to a station" on screen.
- **D-FSV8 — Reconcile becomes "Pilot invoices"**, its own page under Fuel: list of saved checks
  (`GET /api/fueling/recon-runs`, already built), click → the recorded result, upload from the list.
  Results never live only in component state.

### Idle engine

- **D-IE1 — Inputs: ECU engine state + our own motion decision.** Engine on/off from Samsara
  `engineStates` (ECU — trusted). Moving/stopped from GPS speed with a 3 mph threshold and a
  **60-second debounce** (the truck must stay below/above for 60 s to change state) — ours, not
  Samsara's `Idle` label. `idleSessions.ts:208`'s warning stands: the GPS sample at an engine flip is
  stale, so motion is judged on the GPS stream, never on the engine event's decoration.
- **D-IE2 — Five buckets, not four.** Per truck per hour: `driving` (on + moving), `stopped_running`
  (on + stopped), `engine_off`, `no_data`, plus **`brief_stop`** = stopped-running segments under
  `min_idle_minutes` (5) — traffic, scales, fuel lanes. `no_data` is never counted as off.
  Total running = driving + stopped_running + brief_stop.
- **D-IE3 — Two grains are stored, because hours cannot see continuity.** (a) **hour rows** per truck
  (the five buckets in seconds); (b) **stop rows** — one per park, from stop to move: idle seconds,
  off seconds, engine starts, **longest continuous run**, location, state, ambient temperature, HOS
  duty overlap. A six-hour idle spans six hour rows; only the stop knows it was one run.
- **D-IE4 — Avoidable rules** (ordered; first match wins), applied per stop:
  1. `brief_stop`, PTO active, or ambient outside the comfort band (§1.5, Q-IE2) → **not avoidable**.
  2. **On duty (HOS on-duty-not-driving) and running > 60 min** → everything past the first 60 min is
     **avoidable** (R10), any equipment.
  3. **Battery APU truck**, off duty or sleeper: running up to **50% of the park's duration** is not
     avoidable (Q-IE3, owner: 45–55%); every running second above that share is **avoidable**.
  4. **No APU, no OI**, off duty or sleeper → **not driver-avoidable**; booked as
     **`equipment_opportunity`** (what an APU would save on this truck), reported separately.
  5. Any other stopped-running ≥ 5 min outside a rest → **avoidable**.
- **D-IE5 — Burn rate: a prior, then learned.** Prior **0.72 gal/h** (our measured 0.705–0.743,
  inside Argonne's 0.64–1.0). The learner computes gal/h per **equipment cohort × temperature band**
  from engine-reported idle fuel, takes it once a cohort has ≥ 50 h in a band, and shows prior and
  learned side by side until the owner accepts the switch. `idle_settings.idle_gal_per_hour` stays
  the manual override. Battery-APU running is not charged twice — no diesel APU exists (R7), so the
  ~0.2 gal/h APU term in the 2026-09-20 audit is moot.
- **D-IE6 — Spike before build: which engine fuel counters our token can read.** J1939 carries total
  engine fuel used and total idle fuel used; whether Samsara's stats API exposes them on our token is
  unverified. If yes, the learner reads idle fuel straight from the engine (and D-FSV5 gets true daily
  MPG); if no, it reads Samsara's per-event idle fuel, which is engine-sourced, de-duplicated.
- **D-IE7 — Equipment is DECLARED, behaviour is EVIDENCE, and they never overwrite each other.**
  Owner rulings (R7) are written as declared equipment with `source = 'owner_ruling_2026-10-01'`.
  Behaviour-based inference is shown beside it as "behaves like…" and raises a review flag when it
  disagrees; it never sets `has_apu`. Equipment entry moves to the **purchase batch** (§1.6) with
  per-unit override, because trucks are bought in identical batches.
- **D-IE8 — Storage: Samsara is the buffer.** Samsara keeps full history and we can re-fetch any
  window, so no raw table is kept. **Hourly job**: fetch the trailing 3 h of `engineStates` + GPS,
  derive in memory, upsert hour rows and open/close stops. **Nightly job**: recompute the previous
  2 days (late-uploading gateways); a day is final at 72 h. Hour rows: **60 days**, pg_partman daily
  partitions (installed, migration 0360) ≈ 270k rows / 40 MB. Daily totals + stops: kept (≈ 12 MB/yr
  + park-session volume). Each table declares its `lifecycle` block (`lint:table-lifecycle`).
- **D-IE9 — Prove before switching.** Run in parallel ≥ 14 days. Gate: per truck-day, our running
  hours within **±3%** of the ECU engine-hours delta, and stopped-running within ±5% of
  `vehicle_engine_days.idle_sec`, on ≥ 95% of truck-days. Disagreements listed by truck.
- **D-IE10 — Retire what never answered.** Learned envelope, optimized envelope, `optimized_cycling`
  mode and — after D-IE9 passes — Samsara `/idling/events` ingestion (`idle_events`, 131 MB).

### Fleet list

- **D-FL1 — McLeod is membership (D-FC0 stands); our row must agree with McLeod on unit, VIN, make,
  model, model year, purchase date.** Make and model are normalised from ONE table keyed by VIN
  manufacturer code + McLeod spelling (`3AK` → Freightliner, `3HS` → International); McLeod's raw
  spelling is kept beside it, never overwritten.
- **D-FL2 — A fleet-parity check runs after every roster sweep** and reports, by unit: missing either
  side, VIN / year / make / model disagreement, duplicate links (`568 - OLD` ↔ 568). Silence is the
  pass; a disagreement is a notification to fleet managers.

---

## 4. Questions — ANSWERED by the owner 2026-10-01

- **Q-FL1 — Units 632–635: LEAVE AS THEY ARE.** Active in McLeod and parked = meant to be sold,
  waiting. No change in McLeod and none here; FL2's parity check must list them as a KNOWN state
  ("for sale, parked"), not as a disagreement to alarm on every sweep.
- **Q-FL2 — Samsara name suffixes.** `- OLD` = the truck's gateway was REPLACED (the record belongs to
  the retired gateway, same truck — see `samsara-old-suffix-is-a-device-swap`); `- SOLD` = the truck
  was sold. So for 568 the rows are BACKWARDS today: `568 - OLD` (active, VIN `…9642`, McLeod link
  568) carries the identity, and `568` (retired, no VIN, `identity_source samsara`) is the new
  gateway's record. FL1 merges them through the existing audited vehicle-merge path (the
  `732-merged-…` precedent): one truck `568`, active, McLeod-linked, current gateway. Every other
  `- OLD` / `- SOLD` row is checked against the same rule.
- **Q-FL3 — 784–788: fill model from the VIN.** Body code `JHHDR` (VIN positions 4–8) is identical to
  every McLeod `CA` truck here, so all five are Cascadias; 787's `LT625` is a Samsara typo. ⚠ The
  roster sync skips empty McLeod fields (`rosterFields.ts` `vehiclePatch`) so a VIN fill is not
  blanked by the next sweep — but Samsara's vehicle sync WOULD re-write 787 back to `LT625`. FL1
  therefore makes the normalised make/model DERIVED (D-FL1) rather than a hand edit, and the McLeod
  record should still get its `model` filled by whoever maintains McLeod.
- **Q-IE1 — Equipment: as recommended.** Battery APU: 723–726, 728–753, all MY 2027 (764–768,
  784–803, 810, and 804+ on order). No APU / no OI: 500–635, 637–711, 718, 727, 769–783. 719–722:
  per unit from behaviour, flagged for review. Optimized Idle stays only where already entered
  `true` on a battery-APU truck; elsewhere `false`.
- **Q-IE2 — Comfort band: keep 20–85 °F** (`idle_settings`, confirmed correct).
- **Q-IE3 — Battery-APU allowance: the engine may run 45–55% of the PARKED time** (owner's
  experience). D-IE4 rule 3 becomes a SHARE, not a per-run minute cap: on a battery-APU truck, a
  park's running seconds up to **50%** of its duration are not avoidable; everything above is.
  The engine measures the real distribution on the battery-APU cohort and the owner revisits 50%
  with it.
- **Q-IE4 — 727: no APU** (same as its batch).

## 5. Words (D-FSV7)

| Now | On screen |
|---|---|
| Fuel Spend | **Fuel Costs** |
| Spend & trend / Buy discipline / Statements tabs | *(gone — one page)* |
| Reconcile a file | **Pilot invoices** → "Check an invoice" |
| Paid per gallon | **Avg price / gal** |
| Billed against contract | **Paid vs Pilot quote** |
| Billed, never recorded / Recorded, never billed | **On Pilot's bill, not in our records** / **In our records, not on Pilot's bill** |
| Off-network | **Out of network** (not Pilot / Flying J) |
| Avoidable / Reducible idle | **Avoidable idling** · **Needs an APU** (equipment opportunity) |
| truck-days, rollup, tie-out, leg, resolved to a station | removed; in a hover where a reader needs it |

---

## 6. Queue (in order; one step per PR; migrations flagged before merge)

| Step | What | Depends | Migration |
|---|---|---|---|
| **I0** | Stop the double count: canonical event key = (vehicle, started_at, duration); delete the twin of each pair through an audited job, not raw SQL; unique index after. Every `idle_events` reader re-checked. | — | yes (index, after the job) |
| **FL1** | Fleet cleanup: derived make/model (D-FL1), 784–788 from VIN (Q-FL3), merge `568 - OLD` into 568 and audit every `- OLD`/`- SOLD` row (Q-FL2); 632–635 untouched (Q-FL1). | — | maybe |
| **FL2** | Fleet-parity check after each roster sweep (D-FL2). | FL1 | no |
| **IE1** | Equipment by purchase batch: batch key from McLeod purchase date + model; write R7 + Q-IE1 rulings as declared equipment with source; "behaves like" flag (D-IE7). | FL1 | yes (batch + source columns) |
| **IE2a** | Spike: which engine fuel / engine-hour counters our token returns (D-IE6). No PR if negative; written into §7. | — | no |
| **IE2** | Idle engine v2, collector + pure classifier + hour/stop tables, running in PARALLEL (D-IE1..3, D-IE8). | I0, IE2a | yes (new tables, partitioned) |
| **IE3** | Avoidable rules + equipment opportunity (D-IE4); HOS overlap from `hos_duty_segments`. | IE1, IE2 | no |
| **IE4** | Burn-rate learner + prior/learned display (D-IE5). | IE2 | maybe |
| **IE5** | 14-day parity gate (D-IE9), then switch Idling page + driver scores to v2. | IE2 + 14 d | no |
| **FS1** | `fuel_report_days()` + `GET /api/fuel/report` (D-FSV2, 4, 6) — function in its own merge before its reader. | — | yes |
| **FS2** | One-page Fuel Costs report (D-FSV1, 3, 5, 7), savings strip reads IE3 when live. | FS1 | no |
| **FS3** | Pilot invoices page (D-FSV8); first real statement through it (`db139445F.pdf`). | — | no |
| **IE6** | Retire Samsara idling-events ingestion + dead envelope machinery (D-IE10). | IE5 | yes (drops) |

All questions are answered; nothing in the queue is blocked on the owner.

---

## 7. Progress log

- **2026-10-01** — Plan opened from the owner's review. Facts in §1 measured against production
  (read-only) and the McLeod sandbox `lme_analytics` (restore dated 2026-09-10; live `lme` reads were
  refused by the session's permission classifier, so units bought after 09-10 — 804+ — are not in the
  batch table). Owner rulings R1–R12 recorded; Q-FL1–3 and Q-IE1–4 open.
- **2026-10-01** — Owner answered Q-FL1–3 and Q-IE1–4 (§4). Two corrections from checking the
  answers: 784–788's models came from Samsara's vehicle record, not from us; and the 568 pair is
  backwards (the `- OLD` row holds the identity). Battery-APU allowance is a 50% share of the park,
  not a minute cap.
- **2026-10-01** — I0 started. Measured before building: the hex spelling is NOT the whole UUID, it is
  the hex of the uppercase ASCII of the UUID's first SIXTEEN hex digits, so it cannot be turned back
  into the real id. Both spellings share that prefix, and grouping all 258,824 rows by it gives
  142,538 singles and **58,143 pairs, never a triple** (= exactly the 58,143 hex-spelled rows), with
  twins back to events of 08/15. The plan's key (vehicle, started_at, duration) misses 5 pairs from
  08/24 whose hex twin has a NULL vehicle — **owner ruled the 16-digit prefix is the key**. Owner also
  ruled that the driver-performance weeks frozen from twinned data (08/17–09/14, frozen 10/01 15:39)
  are re-frozen after the clean-up. Migration **0398** (column `event_key`, unique index, clean-up
  RPC `resolve_idle_event_twins`) ships alone; its writer and the audited clean-up job follow.
