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
- **Q-IE5..7 — decided in IE1, owner delegated ("analyze and provide best solution", 2026-10-02):**
  - **Q-IE5 — 719–722 are not declared from behaviour.** D-IE7 forbids behaviour setting `has_apu`, and
    two of the four cannot be judged: long parks since 08/15 — 719 84 parks, 7% idling / 69% off (behaves
    like battery APU); 722 53 parks, 55% / 40% (like no APU); 720 and 721 one park each. They keep what
    is entered; the "behaves like…" check raises the review Q-IE1 asked for, for as long as the two disagree.
  - **Q-IE6 — 814–864 (on order, no model year) stay undeclared.** R7 is "MY 2027" and a reservation's
    unit number is not a model year. 804–813 have MY 2027 and are declared. The rest are declared when
    McLeod records the year (FL2 reports it; one batch edit).
  - **Q-IE7 — a purchase batch = make + model + model year + purchase MONTH, derived, never stored.** Our
    rows carry McLeod's purchase DAY (39 groups in service), and one order arrives over days (2020-12-10 →
    12-24 is one run of 27 Cascadias). No ruling splits a month. A stored key would go stale on the next
    McLeod date correction, so `packages/shared` derives it from the row.
- **Q-IE8..10 — decided in IE2 (migration 0404), same delegation:**
  - **Q-IE8 — the hour rows are a PLAIN table with a 60-day retention delete, not pg_partman.** Measured
    2026-10-02: 0360's job is healthy (`lifecycle_maintenance_health()` = ok) but `partman.part_config` is
    empty and `pg_inherits` holds only Supabase's `realtime` partitions, so this would be the FIRST
    partitioned table. DATA-LIFECYCLE-PLAN D-LIFE10 requires the premake alarm to ship with that table, and
    the alarm needs a platform alert channel that does not exist (its Q9, the stated blocker of L7). PGlite
    has no pg_partman either, so the matrices would test a different table from production's. At ~4,440
    rows a day (≈ 270k over 60 days) a daily delete is inside `dataRetention.ts`'s bounded slices. If L7
    ever lands, converting this table is the D-LIFE3 two-merge dance on a small table.
  - **Q-IE9 — `brief_stop` is decided per STOP, not per engine run.** A park shorter than
    `min_idle_minutes` is brief, and all its running time is `brief_stop`. Read per run instead, a
    battery-APU truck cycling on for three minutes at a time through a ten-hour rest would book every cycle
    as traffic, which is exactly the running time D-IE4 rule 3 measures.
  - **Q-IE10 — a stop already in progress when our data begins** (the first run, or after an outage longer
    than the window) is stored from the first instant seen, with `start_observed = false`, so its duration
    reads as a lower bound. A stop in progress that IS stored is continued from its row: the collector
    re-fetches the engine and counter history from its `started_at`, both sparse while parked.
- **Q-FSV9..11 — decided in FS3 (migration 0406), same delegation:**
  - **Q-FSV9 — a saved check keeps its LINES in a new evidence table, `fuel_recon_run_rows`.** Measured
    2026-10-02: `fuel_recon_runs` stores `summary` only; the 3 production runs (08/24, 08/31, 09/07 weeks)
    have no line anywhere. Rejected: reading `fuel_exceptions` (mutable working state, no clean rows, and
    its `run_id` is re-pointed by the latest run over the same weeks, 0253/0320); re-running the matcher
    on open (our fills move after a run, so it would be a new finding wearing the old date). One jsonb row
    per run: 611 bytes per row, ~0.28 MB per statement, measured on the seven real PDFs. Append-only,
    undeletable, `RETENTION_FORBIDDEN`, composite FK so lines and run share one org. The 3 old runs open
    with their totals and "lines weren't kept for this check".
  - **Q-FSV10 — a re-check of the same invoice REPLACES the earlier one in the list.** Nothing ever set
    `superseded_by` although the list hid superseded runs, so a re-upload listed one bill twice. Weekly:
    same invoice number. Export: only the same bytes (sha), since two exports over overlapping months are
    different evidence.
  - **Q-FSV11 — `/api/fueling/recon-runs` gets the 25 MB body parser `/statements` already had.** The seven
    statements decode to 0.92–1.01 MB of words; the general cap is 1 MB, so the largest week was 4% under
    a bare 413, and any monthly export over it.

- **Q-FSV12..13 — decided in FS2, same delegation:**
  - **Q-FSV12 — Buy discipline becomes its own page, `/fuel-buy-discipline`, opened from Fuel Costs (not in the
    sidebar; surface `fuel.spend.buy-discipline`, parent `fuel.spend`, the same `manage("fuel")`).** Read from
    the call sites: the tab reads a different source (`fuel_buy_fills`, the fill sequence with a 14-day lookback),
    grades a policy rather than reporting a cost, and renders two tables, so folding it into the report would
    break R1's one page and the one-table rule. Moved whole, its tests with it. The old Spend tab's
    "Billed against contract" drill-down (the per-fill list a claim is made from, `DiscountCaptureTab`) moved
    there too, renamed "Paid vs Pilot quote" (§5): the report keeps the net figure as a card. Its right home is
    the Findings inbox as `contract_variance` findings — `contractFindings` exists in `exceptions.ts` and has
    never been wired — which is a separate step, not done here. Deleted with the tabs (no other reader):
    `SpendTrendTab`, `OperatingBridgeCard`, `SpendBridgeCard`, `IdleCostCard` (IE3's savings strip replaces it),
    `SpendOverviewTab`, `AncillaryCard`, `StatementsCard`, `useStatements`, `useSpendPeriods`. Production has
    never held a saved statement, so the Statements tab had never shown a row. The PDF export stays.
  - **Q-FSV13 — DECIDED (owner, 2026-10-02: "proceed as recommended") and corrected on reading the code.** The
    Findings inbox stores NO headline: `findingFromException` renders it from `kind` through
    `FUEL_EXCEPTION_KIND_LABELS` on every read, so option (b) was already the architecture and FS3's note
    ("stored summaries") was wrong. The fix is the label map: the four reconciliation kinds now READ
    `RECON_STATUS_LABELS` (the invoice check's own words) rather than restating them, contract_variance is
    "Paid above Pilot's quote" and off_network_premium "Out of network" (§5). Every existing row, the findings
    CSV and the dispute packet change at once; no data is touched.

- **Q-IE11..13 — decided in IE3, same delegation (owner, 2026-10-02: "proceed as recommended"):**
  - **Q-IE11 — rule 1's PTO clause is not applied: nothing we collect says when a PTO was engaged.** Samsara
    exposes PTO only through a wired auxiliary input, which this fleet's gateways are not known to carry. A
    reefer or liftgate truck whose engine runs a PTO while parked would be judged as idling. Open: if the owner
    names trucks that run a PTO, the cheapest honest answer is to exclude those units by declaration (IE1-style),
    not to guess from behaviour.
  - **Q-IE12 — the parts of rule 5 the ruling did not name.** Yard move and personal conveyance are ALLOWED (the
    truck is in use, not parked; the old verdict layer excluded them too). Running with NO usable duty status
    (no segment, or two drivers' logs disagreeing on the truck) is AVOIDABLE as rule 5 reads, but counted apart
    as `avoidableNoLogSec`, so the reader sees how much of the figure rests on a missing log. A rest on a truck
    whose equipment is undeclared or "other" is UNJUDGED, not guessed. An unknown temperature exempts nothing.
  - **Q-IE13 — a park belongs to the local day it STARTED on, whole.** Cutting an overnight park at midnight
    would halve its Q-IE3 allowance on each side, because the allowance is a share of the park's own duration.
  - **Q-IE14 — how the owner accepts the learned burn rate (D-IE5), OPEN, not blocking.** IE4 learns per declared
    equipment × ambient band and SHOWS it beside the configured `idle_gal_per_hour` (Idling page, under "How idle is
    scored"); the engine's `/engine/avoidable` carries both prices (`money` and `money.learned`). Nothing on a page is
    priced at the learned rate yet, because the engine's figures are not on a page until IE5. Candidates:
    (a) at IE5, a stored choice `idle_settings.idle_burn_source` = `configured` | `learned` (default `configured`), an
    admin "Use measured rates" control on the panel, and the engine's money reads it; (b) the owner copies one fleet
    figure into `idle_gal_per_hour` by hand — loses the per-cohort, per-temperature rates D-IE5 asked for, and is a copy
    of a derived value. **Recommendation: (a), built with IE5** — a column with no visible effect before then would be
    a switch that changes nothing on screen. Measured 10/02: fleet ≈ 0.78 gal/h against the configured 0.80, so the
    switch moves idle dollars by about 3%, not by a factor.
  - **Q-IE15 — running past the duty logs' horizon is NOT MEASURED, not "unknown" (decided 2026-10-02, evidence in
    §7).** The logbook sync (`sync_hos`, driver-score tier) runs every `SAMSARA_DRIVER_SCORE_SYNC_HOURS` = 6 h from
    the process's boot; the idle engine runs hourly. So the newest hours of every park had no log yet, were stored
    as `unknown`, and D-IE4 rule 5 booked them avoidable ("no log"). Now a park with running time past the latest
    stored log (the sync closes in-progress segments at its own instant, so that IS the last sync) is written with
    the split null — the reader counts it as unmeasured — and the nightly re-write measures it once the logs are in
    (`IDLE_ENGINE_VERSION` `ie3-v2`). A day is fully measured by its second nightly, as D-IE8 already said ("final
    at 72 h"). Not chosen: running `sync_hos` hourly (six times the HOS fetches, for figures nobody reads before the
    nightly) or measuring the split only in the nightly (an open park would have none all day).
  - **Q-IE16 — how D-IE9 is judged, and IE5 split in two (decided 2026-10-03).** D-IE9 gave the tolerances and the bar;
    these are the parts it did not name. (a) **Final** = a day the collector will not rewrite: on or before the local
    day the latest FINISHED nightly started on (its `stats.from`), read from the jobs ledger, not a fixed lag. (b)
    **Whole** days only: all 24 of our hour rows. (c) **Running** (driving + stopped running + brief) is judged against
    the ECU delta only when the counter has a delta in all 24 hours, and **stopped running** (stopped running + brief,
    since Samsara's idle includes short stops) against `vehicle_engine_days.idle_sec` when Samsara has the day. (d)
    Either check is judged only when EITHER side shows ≥ 1 h — the ECU counter steps in 180 s, so ±3% of less than an
    hour is inside one step — and a zero on the reference side fails. (e) A truck-day judged on neither is not
    counted. **IE5 is IE5a** (the gate, its route and the Idling panel; switches nothing) **and IE5b** (the switch:
    the Idling page and driver scores read the engine, plus Q-IE14's burn-rate choice), built once IE5a says `pass`.
    With the 10/03 nightly rewriting 10/01 and 10/02 whole, 14 final days are 10/01–10/14, final after the 10/16
    nightly: IE5b is ~10/16 at the earliest.
  - **Q-IE17 — the stopped-running check fails by direction, not by noise (OPEN, owner, 2026-10-03).** First final
    day (10/01, §7): running vs the ECU passed 121 of 125 judged truck-days; stopped running vs Samsara's
    `idle_sec` passed 25 of 128, and on 127 of the 128 ours is the HIGHER figure (median +20%, quartiles +6% /
    +58%; fleet 846 h vs 761 h, +11%). Both sides see the same engine: Samsara drive + idle = 1,908 h, ours
    driving + stopped = 1,883 h, ECU 1,885 h. Samsara books ~110 h of it as driving that our motion call (D-IE1,
    3 mph, 60 s debounce) books as stopped. The excess is only weakly tied to the number of stops (r = 0.28,
    ~8 min per stop on average), so it is not simply an onset delay on Samsara's side; its cause is not yet
    measured. As ruled, the gate cannot pass (it needs 95%); a 14-day wait will not change a one-way gap.
    Candidates: (a) **keep ±5% per truck-day** and find out which side is right first — sample a few of the worst
    trucks' parks hour by hour against the gateway's speed, then either fix our motion call or rule; (b) **judge
    only running vs the ECU** (the one check with ground truth) and show the stopped gap as information, since
    D-IE1 already chose our motion call over Samsara's; (c) widen or re-shape the stopped check (truck's 14-day
    total, or a bound on the fleet bias). Recommendation: **(a) then (b)** — the gap is money (+11% avoidable
    idle against today's figures, and in driver scores at IE5b), so name the side that is wrong before the gate
    stops looking at it. Nothing is built on this until the owner rules; IE5b waits on it as well as on 14 days.

  - **Q-FSV14 — "Export report" is a different document from the screen it sits on (DECIDED (a), owner, 2026-10-03: "proceed as suggested"; NOT BUILT — step FS-PDF).**
    Found by the 2026-10-03 design audit (`DESIGN-IS-2026-10-03/`, E6) and confirmed at the call site: the
    button asks `GET /api/fueling/spend-report.pdf` for `from`, `to`, `grain=week` and `vehicles` only
    (`FuelCostsPage.vue`, `routes/spend.ts`). State, location and network never reach it, and it renders the
    legacy `fuel_spend_days` weekly report, comparing the last two complete buckets, while the screen compares
    the whole selected window with the equal-length window before it. A filtered view therefore exports a wider
    report under the same button. Not a one-line fix: the rollup carries no station dimension, so the honest
    repair is a renderer over the SAME `fuelReport` the screen reads. Candidates: (a) **render the PDF from
    `fuelReport.ts`** with every filter and the screen's comparison (new document layout; the legacy report is
    retired or kept for the weekly email); (b) **disable the button while a state, location or network filter is
    active** and say why — cheap, but it removes the export exactly when it is wanted; (c) leave it and label it
    "weekly report, ignores filters". Recommendation: **(a)** — (b) and (c) ship a known mismatch and are
    workarounds in the CLAUDE.md sense. Nothing is built on this until the owner rules.
  - **Q-FSV15 — four decisions the 2026-10-03 verdict needs before the UX track can finish (OPEN, owner).**
    (1) **Who owns the savings strip** that §3 promises for FS2 and `FuelCostsPage.vue` still does not render,
    and what it may sum: the verdict says buying difference, quote variance, coaching and equipment
    opportunity must stay separate and unsummed. (2) **Lower spend is painted green** (`fuelCostView.ts`),
    including when the fleet simply drove less; candidates are neutral for spend, or green only beside flat
    gallons. (3) **Where the idle-engine rollout checks live** — `IdleEngineParityPanel` shows 14-day
    thresholds to office staff who can act on none of them; candidates are an administrator-only view, or
    hidden until IE5b. (4) **What "review" means for a finding** — the verdict wants each opportunity to
    continue into an existing workflow (`contract_variance` findings are still unwired, handoff 62); the
    owner, status and evidence model has to be chosen first. Also owed: five ordinary-user task sessions
    (verdict §"Release acceptance"), with pass criteria set after the first round.

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

IE5b is blocked on the owner: §4 Q-IE17 (the stopped-running check) and Q-IE14 (the burn rate).

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
- **2026-10-01** — I0 built (code half, after 0398). `idleEventKey` (packages/shared) is the one
  definition of an event's identity. `syncIdleEvents` de-duplicates each fetch by it (real-UUID spelling
  kept) and, once nothing stored is unkeyed, writes `event_key` and points an incoming spelling at the
  stored row, so Samsara sending only the other spelling updates rather than inserts. New job kind
  **`idle_event_twins`** runs ahead of `sync_idle` every driver-score tier cycle: keys rows written before
  0398, deletes the second spelling of each event through `resolve_idle_event_twins` (a pair is never
  split across calls), writes one `idle.event_twins_removed` audit row, rebuilds `idle_rollup_days` back
  to the earliest twinned day, and re-freezes only the driver weeks frozen AFTER the first twin was
  written whose window reaches a twinned event (so 08/10, frozen 08/21, is untouched). Once nothing is
  unkeyed it is one indexed read. Readers re-checked — `useIdleScores`, `useLongIdles`,
  `useIdleConfidence`, `useDriverPerformance`, `driverPerformanceSnapshot`, `askData`,
  `idleRollupInputs` all read rows, so they are correct once the twins are gone; none needed a change.
  ⚠ If the rollup or re-freeze throws AFTER the deletion, the next pass finds nothing unkeyed and does
  not retry them: the job's failure in the ledger is the signal, and the fix is a manual re-run.
  Production verification (twin count 0, September idle hours ≈ engine-state 25,850 h) follows the
  deploy.
- **2026-10-01** — **I0 DONE.** #1185 merged (8901bc0) and served by both Railway services at 18:54 UTC;
  the first driver-score tier cycle on the new code ran `idle_event_twins` 18:56:03 → 19:05:08 UTC,
  status `done`. Measured in production, read-only, org `86d6b3ea`:
  - audit row `idle.event_twins_removed` at 18:58:38: 259,155 unkeyed at the start, **58,143 deleted** —
    exactly the measured pair count — 201,012 keyed; twins span events 08/15 → 10/01 01:42, first twin
    written 09/14 14:13.
  - `idle_events`: 0 unkeyed rows, 0 `event_key` groups of more than one, and 0 duplicate
    (vehicle, started_at, duration) groups — the old key finds nothing either.
  - September 1–28: **26,140 h over 35,122 events** (was 52,281 h over 70,244); `vehicle_engine_days`
    idle for the same days is 25,694 h today (25,850 h when measured this morning — the engine days
    have been re-written since), so Samsara-native idle now reads +1.7% over engine state instead of 2×.
    35,122 is exactly the pair-group count measured before the build.
  - `idle_rollup_days` rebuilt over 49 days (`rollupDays`); rows from 08/12 to 10/01 re-written.
  - `driver_performance_weeks`: 08/17, 08/24, 08/31, 09/07, 09/14 re-frozen (`settled_at` 19:02:16,
    ~150 drivers each); 08/03 (frozen 08/14) and 08/10 (frozen 08/21) untouched — as ruled.
  - The `sync_idle` run started 18:35 by the PREVIOUS deployment was cut off by the deploy and closed
    `failed` when its lease was reclaimed at 19:05; the next `sync_idle` started 19:05:08 on the new code.
    That is the deploy, not I0. The no-retry gap above did not arise: rollup and re-freeze both ran.
- **2026-10-01** — FL1 stopped before building: Samsara contradicts Q-FL2's premise. Read-only
  `GET /fleet/vehicles` (208 records) today: the record linked to our `568` row (281475006145500) is now
  named **`568 - SOLD`**, and BOTH 568 records have no gateway (`serial ""`, `model none`). Neither of
  our rows has engine data after 09/05 (`568`) / 08/30 (`568 - OLD`). So there is no "current gateway"
  to merge onto. The merge itself still holds — `568` (retired, 759ef27a) carries the evidence: 97
  fills, 327 financial entries, 91 anomalies, the fuel card, a trailer; `568 - OLD` (active, 990128aa)
  carries the McLeod link, VIN `…9642` and 08/02–08/31 telemetry — and is the 0359 shape. Samsara also
  names **22 trucks `- SOLD`**; nine of them are ACTIVE and McLeod-linked here, with the roster sweep
  live (last 10/01 19:08): **506, 550, 557, 563, 568, 572, 592, 594, 607** (last engine day 09/05–09/21).
  632–635 (Q-FL1, "for sale, parked") are now `- SOLD` in Samsara too. Samsara's `563 - SOLD` carries
  804's VIN (`…844651`) while our 563 holds `…MS9649` — a Samsara-side record mix-up. And a VIN trap for
  the merge: both 568 Samsara records carry VIN `…9642`, so after a merge that frees the dead record's
  id (as 0359 did) the vehicle sync would match it by VIN onto the survivor and the two records would
  take turns owning it. Questions to the owner:
  - **Q-FL4 — Are the nine sold?** D-FC0 says McLeod decides membership, so as built they stay active
    until McLeod retires them, and FL2 reports the disagreement. Recommendation: the owner (or whoever
    maintains McLeod) confirms and retires them in McLeod; the sweep follows. Nothing here edits status.
  - **Q-FL5 — 568 survivor status and device.** Recommendation: merge as 0359 did (history row `568`
    survives, takes McLeod link + VIN + McLeod's status), but the retired row KEEPS the dead record's
    Samsara id so the VIN match cannot reach the survivor. Alternative: retire both if 568 is sold.
- **2026-10-01** — Owner answered Q-FL4 and Q-FL5. **Q-FL4: leave them as McLeod has them** — when a
  truck is removed or deactivated in McLeod, the sweep removes it here (D-FC0 unchanged; FL2 lists the
  Samsara-`SOLD` / McLeod-active units as a known state, like 632–635). **Q-FL5: proceed as recommended.**
- **2026-10-01** — FL1 split in two, because the 568 half met a fact the recommendation did not have.
  **FL1a = migration 0399** (flagged before merge): `vehicle_make_model_catalog` (D-FL1's one table —
  VIN body code, VIN manufacturer code, reported spelling) and a BEFORE trigger on `vehicles` that
  derives `make`/`model` on every write, keeping what the writer sent in `make_reported` /
  `model_reported`. No TypeScript reads the new columns, so it is one merge. It fires after
  `trg_claim_vehicle_identity`, so office edits claim exactly as before. Dry run on production: 265 rows
  derive to two pairs (Freightliner Cascadia 129, International LT625 136), including 784–788 (Cascadia,
  787's `LT625` corrected) and the 51 ordered units 814–864 (International LT625, from the VIN alone).
  Matrix `vehicle-make-model-derived.test.mjs`, 27 checks; eight mutants of 0399, all killed after two
  survivors (trigger order, punctuation stripping) got their own test rows.
  **FL1b (568 merge) — Q-FL5's recommendation does not hold; re-asked as Q-FL6.** The daily IFTA tier
  re-fetches the last THREE months (`monthsToSync`, back = 3) and maps device → vehicle through
  `vehicles.samsara_vehicle_id`, keyed `(org, vehicle_id, device, year, month, jurisdiction)`. If the
  retired row keeps device 281474977689800 (`568 - OLD`), the next IFTA run writes that device's
  July/August miles onto the retired row again, beside the copies the merge moved to the survivor.
  This is already happening: production holds that device's June (17) and July (5) rows on BOTH 568
  rows today, identical values, re-fetched 09/30 onto the row that took the device over.
  - **Q-FL6 — how the merged row lets go of its device.** (a) As 0359 did: the retired row gives up
    its device id, and the Samsara vehicle sync gets one rule first, in its own merge before the
    migration: a VIN match never re-links a row that already holds a different device Samsara still
    lists. Without that rule both 568 records (same VIN) would re-link the survivor in turn every
    identity cycle. The dead device is then reported as unlinked and its existing IFTA rows stay on the
    survivor. (b) Keep Q-FL5 as ruled and leave ALL of that device's IFTA rows on the retired row; the
    truck's IFTA view then misses them. (c) Key IFTA rows by device rather than by vehicle so a
    re-fetch follows the device (0357/0358 territory; larger). **Recommendation: (a)** — it is the
    732 precedent plus one sync rule, and it also covers the next gateway swap whose old record
    keeps the VIN.
- **2026-10-01** — Owner approved 0399 and chose **Q-FL6 (a)**. **FL1a DONE**: #1187 merged (4d671dd),
  0399 applied 20:00:07 UTC; production reads exactly the dry run — Freightliner Cascadia 129 (116 live),
  International LT625 136 (79 live), 7 empty retired Samsara rows; 787 Cascadia, 814 International
  LT625, reported spellings kept; one `roster.vehicle_make_model_derived` audit row (265). The McLeod
  sweep at 20:02:48 left every make derived.
  **FL1b part 1 (code, no migration):** `samsaraVehicleSync` — a VIN or name fallback match never
  re-links a row that already carries a different device Samsara still lists; it is reported in the new
  `heldByOtherDevice` and logged, never re-linked and never inserted. A row whose device Samsara no
  longer lists is still re-linked by VIN (that is the swap the fallback follows). Must be DEPLOYED
  before the 568 merge migration (FL1b part 2) is merged.
- **2026-10-01** — FL1b part 1 merged (#1189, 417e74e). **FL1b part 2 = migration 0400** (flagged before
  merge; merge only once 417e74e is deployed on the api service): the 0359 pattern for unit 568. The
  history row `568` (759ef27a — fills, financial entries, anomalies, fuel card, tank 240, idle learning
  19 sessions) survives and takes McLeod's link, VIN, plate, inspection and status (active, Q-FL4); it
  keeps its own device …145500 (data to 09/05). `568 - OLD` (990128aa) is retired as
  `568-merged-990128aa` with no link, device or VIN (Q-FL6 (a)). Collisions measured 2026-10-01: 7
  spend-days dropped (rebuild with `POST /api/fuel/spend-rollup` from 2026-08-02), 1 rollup day summed,
  22 duplicated IFTA rows of device …689800 kept once (the later fetch). Matrix
  `merge-unit-568.test.mjs` 30 checks; seven mutants all killed (one after the renamed-row guard got
  its own case). After apply: check the audit row, zero references to 990128aa, and that the next
  vehicle sync reports `568 - OLD` under `heldByOtherDevice` rather than re-linking 568.
- **2026-10-01** — **FL1 DONE** apart from one rebuild. Migration 0400 merged (#1190, a9877b2) and
  applied by `migrate.yml` at 23:02 UTC; the api serves a9877b2 with schema `0400` current. Checked
  read-only on production: one `roster.vehicle_merged` audit row (migration 0400) — moved 378 idle
  events, 286 odometer readings, 135 park sessions, 46 IFTA rows, 29 idle-rollup days and 12 engine
  days; summed 1 idle-rollup day; dropped 9 spend-days and the 22 duplicated IFTA rows; released device
  …689800. `759ef27a` is `568`, active, `mcleod`, tractor 568, VIN …9642, device 281475006145500, and
  a sync wrote it again at 23:14 without changing any of that. `990128aa` is `568-merged-990128aa`,
  retired, with no link, VIN or device. Device …689800 has 0 duplicate (year, month, jurisdiction)
  rows and 0 IFTA rows are left on the retired row. **Still owed:** `POST /api/fuel/spend-rollup`
  `{from: 2026-08-02, to: 2026-10-01}`, so 568's spend-days pick up the moved telemetry (the nightly
  rollup only reaches back 14 days). Auto mode refused to run it from a script, so it needs a
  signed-in run.
- **2026-10-01** — **FL1 DONE**, both follow-ups closed. (1) Spend rebuild 2026-08-02 → 2026-10-01 run at
  23:30 UTC by a one-off script calling `buildFuelSpendRollup` with the service key (owner-approved; the
  0359 precedent): one `fuel.spend_rollup_rebuilt` audit row, actor null, reason migration 0400 — 8,589
  written, 1,554 stale rows swept, 56 rejected intervals, 0 unattributed fills. September tractor spend
  still reads **$1,312,207**, to the dollar, so the sweep took no spend with it. `568` (759ef27a) now has
  27 spend-days in the window (19 fills, $10,658.33, 15,609 mi); `990128aa` has none. (2) The sync holds
  `568 - OLD`: the first identity sync after 0400 (23:06–23:10 UTC) updated 205 of 208 records against 206
  in each run since #1189, and 759ef27a still holds device …145500 — a VIN re-link would have given it
  …689800. The `[vehicle-sync]` log line itself could not be found: Railway returns no lines at all for
  23:10:30–23:11:30, a minute in which `efs-soap` logs every 60 s, so the log's silence proves nothing either
  way and the database is the evidence. Seen in the api log alongside, outside this plan: `sync_ifta`
  fails with "Samsara IFTA API 400 for September 2026", and `data_retention` with "scoring_attempts
  delete: Bad Request". Next: FL2.
- **2026-10-01** — FL2 met two gaps before building, both put to the owner and **ruled as recommended**
  the same evening:
  - **Q-FL7 — the API never sees McLeod's full list.** The agent reads every active tractor and trailer
    each sweep but POSTs only rows that changed since its last run (`diffAgainstState`), and the
    checkpoint carries three counts. So "missing on either side" and "our row drifted after a merge or
    an office edit" cannot be seen here. **Ruled:** the checkpoint also carries the full key list per
    tractor and trailer (id, unit, VIN, make, model, year, purchase date, status) — fields the agent
    already reads, so Alex's reviewed SQL file does not change. The API compares after each checkpoint
    (make/model on both sides through 0399's catalogue) and notifies fleet managers through
    `usersWhoManage` → `notify`, one dedupe key per disagreement. An older agent that sends counts only
    gets no check, and the API says so.
  - **Q-FL8 — nothing stored says "sold, awaiting pickup".** The only signal is Samsara's `- SOLD` name,
    which the vehicle sync reads every identity cycle and discards; a unit list in code would be a copy
    of it. **Ruled (a):** store Samsara's vehicle name. Migration **0401** adds `vehicles.samsara_name`
    (reported label, not identity: not in 0241's claim list, audited on rename); the sync writes it in
    the next merge, and FL2 derives the known state from it.
  Also seen: the laptop roster sweep (launchd, `identity`) has failed every cycle tonight with
  "Failed to connect to 10.0.1.171:1433" — off the office network — and it runs from the shared main
  checkout, so an agent change reaches it only when that checkout is updated.
- **2026-10-02** — FL2, second of three merges. **0401** merged (#1192, bd0fa65). This merge is the
  first writer of `vehicles.samsara_name` and **migration 0402**. (1) `samsaraVehicleSync` writes the
  Samsara record's name in both modes, link-only and full; null when Samsara gave no name, and nothing
  at all for a held record (`568 - OLD` keeps its hold). (2) **0402** moves 0399's make/model rule,
  unchanged, into `vehicle_make_model_for(vin, make, model)` plus a batch form
  `vehicle_make_model_derive(jsonb)`, both service role only, so the parity check compares McLeod's
  `FRHT`/`CA` with our `Freightliner`/`Cascadia` through the catalogue rather than a TypeScript copy of
  it; the trigger now calls the function and is `security definer`. That also FIXES a 0399 defect: the
  trigger ran as `authenticated`, the catalogue is deny-all under RLS, so a browser edit was never
  derived. Production has 0 `manual` vehicles, so nothing was mis-derived. Matrix
  `vehicle-make-model-for.test.mjs` (10); 0399's matrix runs unedited and green. Next: the parity check.
- **2026-10-02** — **FL2 DONE** (code), the third of three merges. #1193 (4fa1c69) is in main, and
  0402 is checked on production: `vehicle_make_model_for` and `vehicle_make_model_derive` exist,
  executable by the service role only, and the trigger is `security definer`. This merge is the check
  itself. Shared `fleetParity.ts` has `compareFleetParity`, `isSoldAwaitingPickup`, the keys and the
  plain-word lines. The roster checkpoint schema gains optional `tractors`/`trailers` (Q-FL7), and the
  agent's `sendRosterCheckpoint` sends them. `runFleetParity` runs on POST /api/tms/roster/checkpoint
  and never fails the checkpoint; its summary goes to `org_integrations.config.parity` through
  `stampRosterRead`. One notification goes out per CHANGE of the finding set (sha256 dedupe) to
  `usersWhoManage("equipment")`. Not findings: `ordered` units, and retired rows absent from McLeod's
  list (P4 excludes reserved units). A `- SOLD` truck that McLeod still lists counts as `known` and is
  never alarmed. The boundaries allow-list gains mcleod→messaging and mcleod→org. Mutation testing:
  fleetParity 7/7 killed; the notifier 4/5, where the survivor swaps the fuel section for equipment,
  whose roles are identical today, so it behaves the same. Still owed: the first LIVE parity run. It
  needs the laptop McLeod agent on the office network, running from an updated main checkout, and its
  findings go to the owner before anything is read as noise.
- **2026-10-02** — FL2 is fully merged (#1194, 23804d1). The main checkout is updated and the McLeod
  agent restarted on the new code; it still cannot reach 10.0.1.171 off the office network, so the first
  live parity run is owed. **IE1, first of two merges: migration 0403**, owner pre-approved ("migrate
  when CI is green"). It adds `vehicles.equipment_source`, where a trigger stamps any equipment edit that
  names no source as `manual`. It writes R7 + Q-IE1 once as `owner_ruling_2026-10-01`. Dry run on
  production: battery APU 65 trucks (54 change), no APU 132 (101 change), 11 entered values kept as
  `manual`, 64 untouched. It adds `vehicle_long_park_behaviour` (a measurement; service role only).
  Q-IE5..7 are decided in §4. The matrix found that `audit_vehicles` records only the NAMES of changed
  columns, never their old values, so the summary audit row now carries every replaced value per unit.
  Matrix `vehicle-equipment-declared.test.mjs` (27); 13/13 mutants killed. Next merge: the shared batch
  key, the "behaves like…" verdict, and their place on the Vehicles page.
- **2026-10-02** — **0403 verified on production** (#1195, 1ed3981): its summary audit row says battery
  APU 65, no APU 132, kept as `manual` 11, with 155 replaced values recorded, the dry run to the unit.
  **IE1, second merge (no migration): the "behaves like…" check.** Shared `idleEquipmentDeclared.ts` has
  `LONG_PARK`, `behavesLike`, `declaredEquipment`, `needsEquipmentReview`, `purchaseBatchKey`/`Label`
  (Q-IE7) and the row contract. The api `GET /api/idle/equipment` (`safety: view`) reads 0403's
  function. The Idling page's "Truck capability" tab now reads it instead of comparing the 0043 learned
  capability in the browser, and adds columns for the batch ("Bought as") and for long parks mostly
  running / mostly off, a "Check this truck" filter, and the declared source in the hover.
  **Thresholds calibrated on production** against the just-declared trucks (45 days, parks ≥ 4 h):
  battery APU idling p50 0% / p90 23%, off p50 90%; no APU idling p50 48%, off p50 35%. "Behaves like
  battery APU" is ≤ 10% idling and ≥ 60% off; "like no APU" is ≥ 30% idling; between them is `mixed`,
  never a review. **The review list this gives: 17 trucks.** Declared battery but idling like no APU:
  728, 729, 730, 731, 754, 807. Declared no APU but shutting down like a battery APU: 568, 576, 644, 680,
  690, 698, 700, 719, 727, 779. Plus 722, with nothing declared. Several engine-off ones are likely
  parked rather than equipped (568 is `- SOLD`), which is why the check only raises a review.
  **Found, not changed:** `suggestIdleEquipment` (shared `idleEquipment.ts`, used by the Vehicles form)
  still offers "Optimized idle" as a one-click hint for every modern Cascadia, against R7/Q-IE1 (every
  ruled Cascadia is no APU, no Optimized Idle). It was put to the owner. Batch entry of equipment
  (D-IE7's per-batch form) is not built; per-unit edits go through the Vehicles form and are stamped
  `manual`. Mutation testing: 16/17 killed. The survivor was a redundant web clause, now deleted, because
  the server already reviews a definite behaviour on an undeclared truck. Next: IE2a.
- **2026-10-02** — **IE2a spike: POSITIVE (D-IE6).** Read-only `GET /fleet/vehicles/stats` and `/stats/history`
  on the production token. Of 185 active Samsara vehicles (not `- OLD`/`- SOLD`):
  - **`fuelConsumedMilliliters`** — the engine's total-fuel-used counter (J1939). All **185** report it, 155
    within 48 h. Steps are 500 mL (0.13 gal), sampled every ~6–12 min. Over four 2–2.6 h Samsara idle events
    (763, 661, 650, 691 on 10/01–10/02), the counter's delta was **2.510 / 1.585 / 1.849 gal, equal to the
    event's `fuel_gal` to the millilitre**, and 2.113 vs 2.078 (1.7%) on the fourth. So Samsara's per-event
    idle fuel is this counter, and our engine can read it directly for ANY window, not only Samsara's events.
  - **`obdEngineSeconds`** — ECU engine hours. All **185** report it, sampled every ~3 min; values step in
    0.05 h (180 s), so a park's running time is good to ±3 min, and D-IE9's ±3% engine-hours gate is
    measurable on any park ≥ 100 min.
  - **No idle-fuel counter** (J1939 total idle fuel) on this token: `engineIdleFuelConsumedMilliliters`,
    `idleFuelConsumedMilliliters`, `engineTotalIdleFuelMilliliters`, `obdFuelConsumedMilliliters` and
    `engineTotalFuelUsedMilliliters` are all "Invalid stat type". `engineTotalIdleTimeMinutes` and
    `syntheticEngineSeconds` are accepted but EMPTY for every vehicle. So idle fuel = the total-fuel delta
    across a park where the truck is stopped with the engine on (D-IE1). That is the same thing, because a
    stopped truck burns fuel only by idling (PTO excepted, D-IE4 rule 1).
  - `ambientAirTemperatureMilliC`: 183 of 185 (154 fresh), the engine's own sensor, usable for D-IE4 rule 1
    and D-IE5's temperature bands without the weather cache.
  - **D-FSV5 can have true daily MPG.** One calendar day (10/01 CDT) on six trucks, counter gallons vs
    `obdOdometerMeters` miles: 669 6.87, 665 7.61, 650 6.12, 763 7.45, 661 6.94, 691 7.24 mpg.
  **Consequences for IE2/IE4:** IE2's hourly collector fetches `engineStates` + GPS + `fuelConsumedMilliliters` +
  `obdEngineSeconds` (+ ambient). Each stop row carries counter idle gallons, and each hour row carries gallons.
  IE4's learner reads gallons per running hour per cohort × band from those rows, which needs no Samsara idling
  events at all. That also brings IE6 (retire `/idling/events`, 131 MB) within reach once D-IE9 passes.
  Probe scripts were scratch only; nothing is written. Next: IE2.
- **2026-10-02** — **IE2, first of three merges: migration 0404**, owner pre-approved ("migrate when CI is
  green"). It adds `idle_engine_hours` (per truck per UTC hour: the five D-IE2 buckets, which a CHECK holds to
  3,600 s, plus the fuel-counter and engine-seconds deltas, engine starts and ambient), `idle_engine_stops`
  (one per park of at least `min_idle_minutes`: running, off and no-data seconds, starts, longest run, fuel,
  place, state, ambient, `start_observed`) and `idle_engine_days` (derived in SQL from the hours on the org's
  local day). One writer, `idle_engine_write`, replaces a window: the hours in it and every stop overlapping
  it become the payload, then the touched days are re-derived, so the hourly and nightly runs are the same
  operation. It refuses rows outside its window or trucks and other organisations' trucks. Q-IE8..10 are decided
  in §4 (plain table, not pg_partman; brief per stop; unobserved stop starts). Measured before writing it:
  Samsara's `stats/history` does NOT return the state holding at a window's start (662's 18:00Z window opens
  on a flip at 18:51), so the collector needs a lookback. That costs 18 pages / 15 s for 75 h of fleet
  `engineStates`, and an hour of fleet GPS is 40k points / 7 pages / 20 s. Matrix `idle-engine-tables.test.mjs`
  (26); 10/10 mutants killed. The 60-day retention rule lands with the collector; until then the lifecycle
  block says `null`, which is true. Next: the shared classifier, then the collector and its two jobs.
- **2026-10-02** — 0404 merged (#1198, 49fcf16). **IE2, second merge (no migration): the pure classifier**,
  `packages/shared/src/idleEngine/`. One truck's engine flips, GPS fixes and counters go in; hour rows and stop
  rows in 0404's shape come out. Engine running means `On` or `Idle` (Samsara's split between them is its own
  motion call, which R3 retires). Motion is ours (D-IE1): at or above 3 mph is moving, and a change counts only
  after 60 s, dated from where it began. A fix describes the truck for at most 10 minutes. An engine that is OFF
  means a stopped truck even when the gateway goes quiet, so a quiet park is not a gap. Two stopped stretches
  on either side of a GPS gap are one park when the truck is within 400 m of where it was. Counters are
  interpolated along RUNNING time, not the clock, so a night with the engine off books its burn to the minutes
  it ran, and an engine off since the last reading reads 0, not null. A counter that goes backwards is null.
  Buckets are rounded by largest remainder to 3,600 exactly. Tests: `classify.test.ts` (33). Mutation: 19 of 20
  killed. The 20th was a GPS filter that the motion rebuild already did, so it is deleted. Two fixtures were
  added after mutation showed gaps: an unknown→running flip is not a start, and four half-second bucket edges
  must still round to 3,600. Next: the collector and its hourly and nightly jobs, with the 60-day retention rule.
- **2026-10-02** — 0404 verified on production: the three tables, `idle_engine_write`, highest migration 0404.
  The classifier merged (#1199, f798286). **IE2, third merge (no migration): the collector.**
  `modules/idle/idleEngineSync.ts`, kind `idle_engine`, is its own Samsara tier (`IDLE_ENGINE_SYNC_MINUTES`,
  default 60; first tick after the deploy window). Each run replaces the trailing three hours. When the org's
  local hour is 02–05 and no nightly run has finished in 20 h, the same run recomputes the previous two days
  instead. Choosing it inside one kind means a deploy cannot keep resetting a 24-hour timer, and one (org, kind)
  slot keeps the two windows from racing on the same keys. Engine and counters are fetched from 24 h before the
  window, or from the start of a stored park in progress (that truck then fetches alone). GPS is fetched from
  15 minutes before. A truck with no flip in its fetch is seeded from Samsara's latest flip when that is older.
  A batch cut off by the page cap is not written. Only in-service trucks are read (`IN_SERVICE_VEHICLE_STATUSES`; `lint:vehicle-status` refused the first draft's `!= retired`, which would have admitted trucks on order). The 60-day `timeSlice` retention
  rule on `idle_engine_hours` lands here, and its lifecycle block now says 60. A generic
  `samsaraStatsHistory.ts` fetcher takes the stat types as an argument, instead of a fifth copy of the paging
  loop. Classifier change found by the live probe: **a span with the engine known off throughout is a counter
  delta of 0, with or without readings.** A truck shut down at 01:46, 36 s after its last reading, had left
  every later hour of the night null.
  **Live probe, read-only, 10/01 CDT, all 185 trucks, nothing written (D-IE9 preview):** running time against
  the ECU `obdEngineSeconds` delta on the 72 truck-days with at least 1 h of running and a delta in all 24 hours:
  **72 of 72 within ±3%, median 0.007%, worst 1.4%** (777, −1.4%). 105 trucks had a counter delta for every
  hour. Every running truck that did not was missing the hour of its last shutdown: no reading brackets it until
  the truck restarts, and the nightly recompute fills it, so D-IE9 should be judged on final days. Buckets
  fleet-wide that day: 1,037 h driving, 858 h stopped-running, 12 h brief, 2,359 h off, 175 h no data. 804 stops.
  Four trucks were entirely `no_data`. 664 (last state `On` 09/30 19:09) and 663/769 (`Idle`) have gateways
  silent for 1.8–9.8 days, so their state is stale and no_data is right. **Engine-off holds through GPS
  silence because measured parked gateways sleep:** of 91 trucks off at 08:00Z, 44 had sent no GPS in over
  2 h and 25 in over 3 days. Collector tests `idleEngineSync.test.ts` (10). Mutation: 14 of 14 killed. Next:
  14 days of parallel running, then IE3's avoidable rules on these stops, and D-IE9 (IE5).
- **2026-10-02** — **IE2 DONE, verified live.** #1200 merged (817aaf3); Railway served it from 14:52:29Z. The first
  `idle_engine` job ran at 15:07:32Z, `done` in 39 s: `mode: hourly`, window 12:00–15:00Z, 190 in-service trucks
  in 10 batches, 67 Samsara pages, **0 incomplete batches**. It wrote 570 hour rows, 250 stops and 190 day rows.
  Stored totals: 167.8 h driving, 92.4 h stopped-running, 2.1 h brief, 292.7 h off, 15.0 h no data (5 trucks
  with no engine state at all, the silent gateways seen in the probe). 510 of 570 hours have a fuel delta and
  531 an engine-seconds delta. 124 stops are open. 46 are `start_observed = false`, as Q-IE10 expects on a first
  run with nothing stored yet. Later runs carry those rows forward. Still to check on 10/03: the first
  `mode: nightly` row (local 02–05). The 14-day parallel run for D-IE9 (IE5) starts here, so it can be judged from
  ~10/16 on final days. Next in the queue: FS1.
- **2026-10-02** — **FS1, first of two merges: migration 0405** (function first, then its reader, per
  sql-returns-measurement). Order changed from §6 with a reason: FS1 → FS3 → FS2 go first while IE2 collects
  data for IE3/IE5. The 10/03 nightly `idle_engine` check is still first on 10/03; it can't be run before the
  02–05 local window. `fuel_report_days(p_from, p_to, p_in_network_brands, p_vehicles, p_states, p_sites,
  p_network, p_org)` sums per day × network (`in` / `out` / `unknown` station) × tank: fills, gallons, spend, and
  the same three restricted to fills with a posted price (+ retail) and with a Pilot quote (+ contract). Built
  on `fuel_spend_lines` instead of a copy of its business date, quote join and org scope.
  `fuel_spend_lines` gains `station_id` as its LAST column (dropped and recreated in one transaction). D-FSV2's
  brand list is a REQUIRED argument with no default: the API passes the carrier's
  `route_fuel_settings.preferred_brands` (`{pilot, flying_j}` on production), the list the planner already uses.
  Decided here: a third copy of R11 in SQL or in a constant would drift the day that setting changes. `fuel_report_sites`
  gives the state/location menus, distinct in SQL (1,000-row cap). Unresolved fills come back as one row per
  state. Shared spec `fuelSpend/reportDays.ts` (`fuelNetworkOf`, `filterFuelReportLines`,
  `foldFuelReportDays`). Matrix `fuel-report-days.test.mjs` (49) checks SQL against it over ten filter shapes.
  Mutation: 14 SQL + 4 spec mutants, all killed. Measured, production, read-only: September tractor
  in 1,853 fills $1,285,793.43 · out 29 $12,675.92 · unknown 20 $13,737.52 = $1,312,206.87 (`fuel_spend_days`:
  $1,312,207); `fuel_spend_lines` 07/04–10/01 grouped per day takes 838 ms (5,816 fills).
- **2026-10-02** — **FS1 DONE (code), second of two merges: `GET /api/fueling/report`.** It sits on the
  `/api/fueling` router with every other fuel-spend route, so the plan's "/api/fuel/report" was loose
  wording. Query `from`, `to` (≤ 366 days), `vehicles`, `states`, `sites`, `networks`. It returns the picked range and
  the previous range of equal length (D-FSV3, `previousFuelReportRange`: 09/01–09/30 → 08/02–08/31), each as
  `fuel_report_days` rows plus `fuelReportTotals`: tractor, reefer beside it, and tractor by `in`/`out`/`unknown`.
  Each has avg price/gal, discount over the posted-price fills only, paid vs Pilot quote over the quoted fills
  only, and the coverage of each. Ratios are null, never 0, when nothing was quoted. Also returned: the
  in-network brands it used (the carrier's `preferred_brands`) and the places fuelled. A filter value
  that isn't recognised gets a 400 rather than an unfiltered answer. **Miles, cost per mile and MPG (D-FSV4,
  D-FSV5) are NOT in FS1:** they're `readFleetDistance`/`getFleetMpg` reads that FS2 composes beside this
  answer, since the handoff puts miles with FS2. Tests: `reportDays.test.ts` (10), `routes/report.test.ts`
  (15). Mutation: 10 route/reader + 8 verdict mutants, all killed after two survivors. The test was at fault
  both times. A lower-case state made the route answer 400, so the filter test's loop ran over zero calls.
  The fixture had equal posted-price and contract-quoted gallons, so the two coverages couldn't be told apart.
  **0405 verified live** (#1202 merged dac3638; `migrate.yml` applied it 15:43Z). Read-only on production,
  September, `{pilot, flying_j}`: tractor in 1,853 fills $1,285,793.43 · out 29 $12,675.92 · unknown 20
  $13,737.52; reefer in 53 $6,331.16. Paid vs Pilot quote, tractor: **+$2,192.47** over 1,784 quoted fills,
  which matches §1.3's $2,192 independently. `fuel_report_sites`: 561 places, 3 unresolved-state rows, 1,955 fills
  (= every fill above). New functions keep their SET; `fuel_business_date` still has none.
- **2026-10-02** — FS1 served live: Railway 9ded697, schema 0405, `/api/fueling/report` 401 unauthenticated.
  IE2's first NIGHTLY `idle_engine` check is due after 10/03 05:00 local and is not yet run; it goes in the
  next FS3 commit.
- **2026-10-02** — **FS3 merge 1 of 2 (migration 0406 + API).** `fuel_recon_run_rows` (Q-FSV9) written by
  `runFuelReconciliation` beside each run, card numbers cut to six digits on both sides before writing;
  a re-check supersedes the earlier run (Q-FSV10); `GET /api/fueling/recon-runs` paged (`limit` ≤ 100,
  default 25) with `total`, newest period first; `GET /api/fueling/recon-runs/:id` reads one check back as
  written, superseded or not (`lines: null` = not kept, never `[]`); recon-runs body cap 25 MB (Q-FSV11).
  Tests: `fuel-recon-run-rows.test.mjs` (17), `fuelReconRun.test.ts` (+6), `routes/reconRuns.test.ts` (7).
  Mutation: 8 SQL + 21 API mutants, all killed after one survivor (an already-superseded run was never
  in the fixture). Real-PDF probe, local and read-only: all seven statements tie out; today's ingest
  writes db139445F.pdf (invoice 800157197) whole into PGlite, so production's 0 saved statements were
  not the parser or the schema; the first real upload (merge 2) is the measurement.
- **2026-10-02** — **FS3 merge 2 of 2 (the page).** "Pilot invoices" at `/fuel-invoices` (catalogue `fuel.invoices`,
  `section("fuel")` like Findings and IFTA, so a controller reads it; "Check an invoice" needs `manage`, as the
  POST routes do), and one saved check at `/fuel-invoices/:id` (`fuel.invoices.detail`). Decided from call sites:
  a NEW route rather than reusing `/fuel-reconciliation`, which keeps redirecting to `/fuel-spend` because its
  links carry the spend page's `?tab=`. The list is the server's pages (25, `total`); a row opens the check read
  back from the API; an upload lands on the check it recorded, and the upload drawer renders no result of its
  own (W5). Reconcile left `/fuel-spend`; its Statements empty state links here (through `useOpens`).
  `RECON_STATUS_LABELS` carry §5's words, so every surface reading them changed at once; the Findings inbox's
  stored summaries ("Billed, never recorded") are row text written by `reconFindings` and still say the old words.
  Looked at in a browser (build + preview, stubbed API with a statement parsed from db139445F.pdf): the
  bucket tiles were AppButtons that the button's pill shape squeezed into one overlapping row — inherited from
  the drawer and invisible to every test — now `StatCard` toggles; the list and line table were wider than a
  1440-px screen until the invoice number moved under its week, the bill's line count into "Matched lines", the
  card under the unit, and Detail alone wraps. Tests: `InvoiceUpload` (6), `ReconResultView` (7),
  `FuelInvoicesPage` (6), `FuelInvoiceCheckPage` (4), `FuelReconciliationPage` (rewritten 2). Mutation: 28 web
  mutants killed after three survivors, each a test that could not tell the difference (money card read from
  the whole page, drawer never opened before checking it closed, every URL the same id).
- **2026-10-02** — **FS2 merge 1 of 2 (the API composition).** `GET /api/fueling/report` now carries, per range,
  `efficiency = { mpg, costPerMile }` (`mpg` is the whole `getFleetMpg` answer, refusal and coverage included) and
  `trailingMpg`: one trailing-7-day MPG per day of the range (D-FSV5). One new reader, `getFleetMpgPeriods`
  (`fleetMpg.ts`): any list of periods, overlapping allowed, the odometer staging and the gallons each read ONCE;
  `getFleetMpg` is now that function with one period. Cost per mile = `fuelCostPerMile(price/gal, MPG)` in
  `fleetEfficiency.ts`, NOT `spend ÷ miles`: the miles are the measured trucks', the spend is every tractor fill,
  so the literal D-FSV4 division reads dear by the unmeasured share; price ÷ MPG is `spend ÷ (gallons × MPG)`,
  the old trend's figure minus reefer and DEF. A day whose trailing week the roll-up hasn't reached the end of is
  withheld with a sentence (a clamped week would print an earlier week against that day). Decided: under a
  state, location or network filter, MILES and COST PER MILE go with MPG (D-FSV5 named only MPG; both are built
  on it) — `efficiency` and `trailingMpg` are null and the page shows `FUEL_REPORT_TRUCK_FIGURES_NOTE`; no
  odometer is read. The wire types moved to `@silvicom/shared` (`reportDays.ts`) for the page. Measured, in
  memory, 200 trucks: a full year (368 periods, 160k readings, 80k truck-days) 1.08 s, 90 days 0.29 s. Tests:
  `fleetMpg.test.ts` (+6), `routes/report.test.ts` (+7), `fleetEfficiency.test.ts` (+2). Mutation: 14 mutants,
  all killed after three fixture fixes (both ranges priced alike, every period starting on the earliest day,
  no fuel on the day a trailing eight would wrongly include).
- **2026-10-02** — **FS2 merge 1 MERGED** (#1206, 49eb47b). **FS2 merge 2 of 2 (the page).** `/fuel-spend` is "Fuel
  Costs" (§5), one report with no tabs (R1, D-FSV1): filters date range (`DateRangeFilter`), trucks, state,
  location and network (all multi; state and location menus come from `fuel_report_sites`, so a choice always
  selects something, and a selected value the range no longer holds stays in its menu); eight trend cards, each
  naming the previous range ("+14.1% vs 08/02–08/31", D-FSV3), tractor fuel only with reefer on its own line
  (D-FSV4); the network split as one sentence; ONE table, every day of the range newest first with its
  trailing-7-day MPG (D-FSV5), paged at 20, CSV. Under a state, location or network filter, miles, MPG and cost
  per mile leave and the API's sentence takes their place. Every figure is the API's, so the page does no fuel
  arithmetic. Buy discipline and the paid-vs-quote fills moved to `/fuel-buy-discipline` (Q-FSV12). Old
  `?tab=`/`?grain=` links still open the page. Looked at in a browser (build + preview, the API stubbed with
  September's REAL `fuel_report_days`/`fuel_report_sites` sums read from production, SELECT only; tractor spend
  $1,312,206.87 = FS1's figure). Two defects found by looking: a day's paid-vs-quote netting to −$0.30 printed
  "-$0" (fixed: `wholeUsd`, on the card too), and the PDF export's scope line printed raw ISO dates (fixed:
  MM/DD/YYYY). Tests: `fuelCostView.test.ts` (15), `FuelCostsPage.test.ts` (13, rewritten),
  `FuelCostDaysTable.test.ts` (3), `FuelBuyDisciplinePage.test.ts` (3, the old tab's assertions moved). Mutation:
  23 web mutants, all killed after adding three tests (Clear filters under a station filter alone, a selected
  state/location kept in its menu, paging reset).
- **2026-10-02** — **FS2 DONE in code and served.** #1207 merged (271e46d); Railway serves 271e46d since 18:30Z,
  schema 0406, `verify:live` ✓; `/fuel-buy-discipline` answers 200. Not yet looked at signed in on production
  (the browser check used real September sums through a stub). Still owed before FS3 closes: the owner opens
  `/fuel-invoices`, and the first real upload of db139445F.pdf (needs the owner's OK). Q-FSV13 awaits the owner.
- **2026-10-02** — **Q-FSV13 done + `suggestIdleEquipment` removed** (owner: "proceed as recommended"). Finding headlines
  take §5's words from `RECON_STATUS_LABELS` (§4 Q-FSV13; nothing stored changes). The Vehicle form's one-click
  "Suggested: Optimized idle" for every Cascadia from 2017 contradicted R7/Q-IE1 and is gone with its shared
  function, which had no other rule or caller; a truck's equipment comes from the IE1 declaration. Tests:
  `exceptions.test.ts` (+2), `VehicleForm.test.ts` (+1, fails on the old form). Mutation: 4 label mutants killed.
- **2026-10-02** — **Q-FSV13 + Optimized Idle merged** (#1209, ca564c5). **IE3 merge 1 of 2 = migration 0407.**
  `idle_engine_stops` gains `running_rest_sec`, `running_on_duty_sec`, `running_excluded_sec`, `running_unknown_sec`:
  a park's running seconds split by the driver's duty status, measured by the collector (merge 2), summing to
  `running_sec` (CHECK), all-or-none, null = not measured (every ie2-v1 park). Verdicts stay out of SQL: D-IE4 is
  evaluated on read so the Q-IE3 50% can move. Measured first (production, SELECT): 348 running parks in the last
  30 h, 747,917 running seconds; duty segments naming the truck cover ~37%, the driver↔vehicle assignment path
  (`idleDutyEvidenceSync`, 2026-08-11) covers all 348 (running-weighted ≈ 99.96%), so merge 2 reuses that path.
  Matrix `idle-engine-stop-duty` (7); `idle-engine-tables` (26) unchanged and green. Mutation: 5 SQL mutants
  killed (each CHECK, the insert column list, the grant).

- **2026-10-02** — **0407 MERGED + APPLIED** (#1210, 22ba94f; `migrate.yml` 19:17Z ✓; production has the four columns,
  the three CHECKs, and `idle_engine_write` reading the split, still closed to `authenticated`). **IE3 merge 2 of 2
  (the code).** (a) The duty logs are read in one place: `vehicleDutyTimelines.ts`, moved out of
  `idleDutyEvidenceSync.ts` (logbook + driver↔vehicle assignment attribution), which both collectors now use.
  (b) `classifyIdleEngine` takes the truck's duty timeline and splits each park's RUNNING time into rest / on duty
  (on duty, or driving logged while stopped) / excluded / unknown (conflicting logs → unknown);
  `IDLE_ENGINE_VERSION` = `ie3-v1`. (c) The collector reads the timelines once per run from the earliest truck's
  reach and writes the split. (d) `idleStopVerdict` + `idleAvoidableTotals` (shared, pure) apply D-IE4 on read,
  with Q-IE11..13 (§4). Every park's parts add up to its running time. (e) `GET /api/idle/engine/avoidable?from&to`
  (safety: view) returns totals, money on the Idling page's own cost basis, and per-truck rows; nothing is shown
  in the UI until IE5 (D-IE9). Parks written before this deploy stay unmeasured until the nightly re-write
  reaches them (2 days back). Tests: `avoidable.test.ts` (10), `classify.test.ts` (+4), `idleEngineSync.test.ts`
  (+3), `idleEngineAvoidable.test.ts` (4), `routes/idle.test.ts` (+6). Mutation: 23 mutants, all killed after one
  survivor (the comfort band's edge: integer milli-°C never lands on 20 or 85 °F exactly, so the edge test
  now uses a band edged at 59 °F = 15 °C).
- **2026-10-02** — **IE4 merge 1 of 2 = migration 0409** (owner pre-approved, "migrate when CI is green").
  `idle_engine_burn_inputs(org, from, to, band_edges)`: per truck and ambient band, parks, running seconds and
  engine-counter millilitres over the parks that have both (IE2a: the counter IS idle fuel on a parked truck). Band
  edges are a parameter with no default; the bands (§1.4's: <32 · 32–50 · 50–75 · 75–90 · ≥90 °F), the cohort (the
  DECLARED equipment, IE1) and the 50-hour bar live in shared `idleEngine/burnRate.ts` (`learnIdleBurnRates`,
  `idleBurnRateFor`, prior 0.72), which ships in this merge with no caller. Learner window 60 days. Measured first
  (production, SELECT, 447 ie2-v1 parks): battery APU 0.767–0.830 gal/h, no APU 0.746–0.796 across 50–90 °F+;
  no APU 50–75 °F (56.9 h) and 75–90 °F (81.9 h) already pass 50 h; configured `idle_gal_per_hour` is 0.80.
  Matrix `idle-engine-burn-inputs` (21; bands asserted against the IMPORTED `idleBurnBand` on and ±1 of every
  edge); `burnRate.test.ts` (11). Mutation: SQL 10/10 killed; TS 15 + 3, two killed after a fix (the prior is now
  checked against §1.4's measured 0.705–0.743, not against itself), two equivalent and removed (an unlearned
  cell's rate already IS the prior, so `idleBurnRateFor`'s learned/unbanded guards could not change an output).
  Next: merge 2 — the reader, `GET /api/idle/engine/burn-rates`, learned money beside configured money on
  `/engine/avoidable`, and the Idling page's side-by-side.
- **2026-10-02** — **IE4 merge 2 of 2 (the reader; no migration).** `idleBurnRates.ts` reads 0409 over the last 60
  days, files each truck's rows under its DECLARED equipment (retired trucks included) and folds them with
  `learnIdleBurnRates`; `GET /api/idle/engine/burn-rates` (safety: view) returns the table beside the configured rate
  (`resolveIdleCostBasis`) and the 0.72 prior. `/engine/avoidable` gains `money.learned`: the same avoidable and
  equipment-opportunity seconds priced park by park at the truck's cohort × the park's band (`idleBurnRateFor`),
  same price. The Idling page shows the table under "How idle is scored" (`IdleBurnRatesPanel`), saying which
  rate the page's dollars use. Nothing on a page is re-priced: how the owner accepts the switch is §4 Q-IE14.
  Tests: `idleBurnRates.test.ts` (4), `idleEngineAvoidable.test.ts` (+1), `routes/idle.test.ts` (+2),
  `IdleBurnRatesPanel.test.ts` (4). Mutation: API 14/14, web 9/9 killed.
- **2026-10-02** — **IE4 DONE and served.** #1217 merged (850f426); Railway serves it from 20:17:20Z with schema
  0409 current (`verify:live` ✓); `/api/idle/engine/burn-rates` answers 401 unauthenticated (mounted).
- **2026-10-02** — **The IE3 "unknown" share is the logbook sync's lag, not the attribution (Q-IE15).** Measured at
  00:27Z 10/03 (production, SELECT): 399 `ie3-v1` parks, 291.6 running hours, **138.4 h (47%) unknown**. By
  measure time: parks whose logs were complete when the collector measured them (ended before the last `sync_hos`
  at 20:50:54Z, measured after it) — 129 parks, 75.2 h, **6% unknown**; measured before that sync — 5%; parks
  running past it — 229 parks, 195.0 h, **68% unknown**. 0 of 5,046 recent `hos_duty_segments` rows are open; the
  latest end is the last sync to the second. The driver-score tier last ran 20:19–20:56Z: its 6-hour timer
  restarted with the 20:17Z deploy, so nothing had stalled. Q-IE3's battery-APU distribution therefore waits for
  the nightlies: only 3 long battery-APU parks had complete logs tonight. Fix: `ie3-v2` (Q-IE15). Tests:
  `classify.test.ts` (+4), `idleEngineSync.test.ts` (+2). Mutation: 7/7 killed, one after a second fixture
  segment (the horizon is the LATEST log, not the earliest). **For the 10/03 nightly check:** expect
  `ie3-v2` rows; a null split is now right for a park still running past the last log sync, and "unknown" should
  be a small share (≈ 5–6%) of the measured parks' running time.
- **2026-10-03** — **IE5a: the D-IE9 gate (no migration).** Shared `idleEngine/parity.ts` (`judgeIdleParityDay`,
  `idleParityReport`, `idleParityFinalThrough`; thresholds `IDLE_PARITY`), rules per §4 Q-IE16.
  `idleEngineParity.ts` reads `idle_engine_days` through the final day, `vehicle_engine_days` for the same days and
  the latest finished nightly; `GET /api/idle/engine/parity` (safety: view). The Idling page shows it under "How
  idle is scored" (`IdleEngineParityPanel`): still checking / not agreeing yet / ready to switch, days finished,
  the share (floored, so 94.97% never reads 95%), and every truck that disagreed with its worst signed misses.
  Nothing switches. Tests: `parity.test.ts` (14), `idleEngineParity.test.ts` (6), `routes/idle.test.ts` (+2),
  `IdleEngineParityPanel.test.ts` (7). Mutation: gate 20/20, reader 9/10 (the survivor drops `Number()` on a
  bigint that JavaScript arithmetic coerces anyway — no output can change), panel 7/7; three killed only after a
  fixture was added (the ECU-side hour, an org east of UTC, a share of 94.97%).
- **2026-10-03** — **Nightly check, the engine's first (production, SELECT, read ~13:00Z).** (a) IE2: the nightly
  ran 07:05Z, `done`, `from` 2026-10-01T05:00Z, 0 incomplete batches; every hourly since 10/02 12:00Z `done` (the
  one `failed` row, 10/02 19:19Z, is a lease reclaimed across the IE3 deploy); no truck has two open parks.
  (b) IE3: all 1,501 parks are `ie3-v2`; 1,380 measured, unknown 84.8 h of 1,476.1 h measured running = **5.7%**.
  The 121 parks with a null split (515.3 h running) all ran past the 02:07Z `sync_hos` and were measured before
  the next one at 08:34Z (earliest ended 02:11Z) — exactly the Q-IE15 rule; tonight's nightly measures them.
  (c) IE5a: final through **10/01** (the nightly's `from` day; 10/02 becomes final with the 10/04 nightly — the
  handoff's "10/01 and 10/02 final" was wrong, the rule was right). 10/01 and 10/02 both hold all 24 hour rows
  for 192 trucks (the nightly rewrote them whole); 10/03 has 7. Gate: 1 day of 14, **134 truck-days judged, 31
  pass (23%)**, not `pass`. Running vs ECU **121 / 125**; the four misses are all ours LOW (808 −17%, 774 −19%,
  786 −5.3%, 805 −3.5%). Stopped running vs Samsara **25 / 128** (43 within 10%, 62 within 20%), ours higher on
  127 — the gate cannot pass as ruled; the evidence and the choice are §4 **Q-IE17**, open for the owner.
  Worst stopped misses: 767 +1160%, 680 +173%, 701 +93%, 748 +86%, 736 +62%.
- **2026-10-03** — **Design-audit fixes, part 1 (branch `claude/fuel-ux-honest-scope`, not yet merged).** From
  `DESIGN-IS-2026-10-03/03-verdict.md`, each confirmed at the call site before it was changed and each pinned by
  a test that fails when the fix is removed: Buy discipline's Trucks filter now reaches the fill sequence (it
  reached only the brand cards); Fuel Costs opens Buy discipline on the same days and trucks, and says when a
  state, location or network filter cannot travel; the findings table returns to page 1 when its rows shrink;
  Buy discipline says "couldn't load / loading" instead of "no tractor fuel", "no target set" and "no fill
  matched a quote" while the feed or the settings are pending or failed; the "none is on file" statement about
  vendor statements is gone (quotes have come from the kept daily Pilot reports since 0245); the Last 7/30/90
  presets are 7/30/90 dates, matching `windowDays`. Still open: the live "867 fills beside no tractor fuel"
  contradiction (cause unestablished — the new states will name it on the next signed-in view); the PDF
  (Q-FSV14); the word changes; and Q-FSV15.
- **2026-10-03** — **Q-FSV14 decided (a); FS-PDF is its own step, not started.** The owner took the recommendation:
  the PDF is rendered from `fuelReport.ts` with every screen filter and the screen's whole-window comparison.
  Sized from the code: the current document is `fuelSpendReport*.ts` (about seven files — charts, table, policy,
  sections, flow, theme, draw) built on the legacy weekly `SpendPeriod` model, so this is a new layout over the
  report's cards, daily table, reefer line and coverage notes, not a parameter added to the endpoint. Acceptance
  when it is built: the PDF's figures equal the screen's for the same filters (a test that renders both from one
  fixture), state/location/network appear in its scope line, and it is rasterised and LOOKED at with a long
  fixture before merge (a text collision is invisible to a unit test). Until then the button exports the legacy
  report and Q-FSV14 stays a known mismatch. Word changes shipped in the part-2 PR (plain words).
