# The Fuel section — consolidation, and the case model underneath it

**Opened 2026-09-01 against `main` @ c80fc1c.** Sibling to the four fuel plans at `docs/plans/`
(`FUEL-SPEND-RECONCILIATION-PLAN.md` built the spend feature, `FUEL-SPEND-RELIABILITY-PLAN.md` made it
precise, `FUEL-PRICE-DATA-PLAN.md` and `SMART-FUELING-PLAN.md` own the price layer and the planner).
Those plans each built a thing and each built it well. **This one is about what happened to the section
when eight of them landed next to each other**, and it deliberately builds almost no new capability.

The owner's framing, 2026-09-01, is the thesis and is not paraphrased away: *"we have a lot of things
that are unnecessary and extra and making our UI/UX literally complicated and overwhelming… so this
Fuel section is presentable, easy to read and useful to us and not just some pages we have and we don't
have a clue what for."*

---

## 0. Ground truth (measured 2026-09-01 against the tree; nothing recalled)

### 0.1 What is in the section

Eight nav entries under **Fuel** (`apps/web/src/lib/nav.ts`), ~16 distinct views behind them.

| Nav item | Route | Reads | Job it does | Lines |
|---|---|---|---|---|
| Fuel Log | `/fuel-log` | `fuel_transactions` where `is_canonical` | The product's own fill record: deduped, attributed to vehicle/driver/trailer, computed MPG, miles-since-last, tank type, `case_level`/`case_score`/`case_signals`/`case_gates`. Also the only fuel **write** surface (`Log fill-up` drawer). | 362 |
| Transactions | `/transactions` | `efs_transactions` | The raw vendor mirror — every line of an EFS Transaction report exactly as received, including the DEF/fee/scale lines the log discards. | 168 |
| Rejections | `/rejections` | `declined_transactions` | Declined swipes with their own suspicion scoring (`clear`/`review`/`alert`), error code, policy, plus a read-only card→truck assignment drawer. | 352 |
| Cards | `/fuel-cards`, `/fuel-cards/:id` | EFS card mirror | Card inventory as the vendor reports it, control actions, sync-job ledger, unit-mileage drawer. | 412 + 328 |
| Import | `/import` | — | Tab `efs`: drag XLSX/CSV → analyze → commit, plus a **Repair fuel data** button (`POST /api/transactions/sync-from-efs`). Tab `prices`: `PriceUploadCard` + `StationDataCard`. | 333 |
| Fuel Spend | `/fuel-spend` | `fuel_spend_lines`, `fuel_buy_fills`, statements | **Eight tabs**: Spend & trend · avoided-brand · avoided-state · Off-network · Buy discipline · Discount capture · Reconcile a file · Statements. | 353 |
| Exceptions | `/fuel-spend/exceptions` | `fuel_exceptions` | The recovery ledger: identified / claimed / recovered / still open, six-status lifecycle, CSV, server-rendered dispute packet. | 190 |
| IFTA | `/ifta` | `ifta_period_*` RPCs | Quarterly jurisdiction ledger behind an MPG-plausibility and tie-out health gate. | 211 |

**Fuel surfaces that are not in the Fuel nav group.** This is half the problem and it is invisible from
inside the group:

- **Fuel Planning** and **Truck Stops** are under *Dispatch* (`canManageSection(role,"dispatch")` and
  `canViewSection(role,"dispatch")` respectively).
- **Alerts** (`/anomalies`) is under *Safety*, gated `canViewSection(role,"safety")`. It is the
  fuel-card theft/misuse queue.
- **Anomaly Thresholds**, **Planned Fueling**, **EFS Integration**, **Data & Sync** and **Card control**
  are five Settings pages.
- The **Dashboard** is, in practice, already a fuel dashboard — `useFuelRangeTotals` drives fill-ups,
  gallons, miles, spend and fleet MPG, and the cost-composition chart splits moving / idle / reefer.

### 0.2 Measured facts, each verified

1. **`FuelEventsPage.vue` is dead.** 119 lines, **zero references** in the tree; `/fuel-events`
   redirects to `/fuel-log`. It has been dead since the merge that wrote the redirect.
2. **Fuel Log and Transactions are not the same data.** `useFuelLog` reads `fuel_transactions` with
   `.eq("is_canonical", true)`; `useEfsData` reads `efs_transactions`. One is the derived, deduped,
   scored domain object; the other is the faithful receipt. The owner's instinct that one is redundant
   is right about the *nav*, and backwards about *which one is the product*.
3. **Four unconnected "something is wrong" surfaces.** Alerts (`anomalies`), Rejections
   (`declined_transactions.suspicion_level`), Fuel Spend's three policy tabs (`analyzePolicyExceptions`,
   computed per page load), and Exceptions (`fuel_exceptions`).
4. **The two case models are not merely two vocabularies — they have a different NUMBER OF AXES, and
   this is the single most important measured fact in this document.**
   - `anomalies` is **two-axis**: `ANOMALY_STATUSES` = `open · investigating · resolved · dismissed ·
     superseded` (mirrors the `anomaly_status` Postgres enum), **plus** `ANOMALY_DISPOSITIONS` =
     `confirmed · false_positive · benign_explained · inconclusive`. Its own comment states the split:
     *"status is 'where is this in the queue', disposition is 'was the flag right'"*, and the
     disposition axis is *"the label the whole accuracy program is built on"* — `inconclusive` is
     explicitly excluded from precision.
   - `fuel_exceptions` is **one-axis**: `open · investigating · disputed · credited · dismissed ·
     resolved_by_reingest`, where the close carries money (`credited_amount`) rather than a verdict on
     the detector.
   A single flattened status vocabulary across both would silently destroy the disposition axis and
   with it the detection-accuracy program. See D-FUI7, rewritten around this.
5. **The policy tabs find money and file nothing.** `off_network_premium`, `avoided_state_premium` and
   `avoided_brand_premium` have been in `FUEL_EXCEPTION_KINDS` since 0250 with **no producer**. The
   recorded reason is `policyFindingsNote`: *"201 off-network fills in a 90-day window is not 201
   actions. F6b decides the threshold or the grouping."* **F6b shipped on 2026-08-26 as the surface and
   never answered it.** The question is orphaned — this plan adopts it (Q-FUI3).
6. **The manual Pilot price upload is not redundant with the automated fetch.**
   `postedPriceFetch.ts` scrapes Pilot's public table for **posted retail** into the global
   `fuel_prices_posted` layer. `pilotPriceIngest.ts` parses the emailed **Better-Of Pricing Report**,
   which is the only source of this org's **contracted net price**. Deleting the upload would delete the
   contract price layer.
7. **The manual EFS upload is now a backfill path, not the primary one.** `startEfsSoapPoller`,
   `startEfsIngestScheduler` and `startEfsProcessingScheduler` run per-org in the worker
   (`apps/api/src/schedulers.ts`). Nothing about the Import page says this.
8. **Filter state dies on refresh on four of the eight pages.** Fuel Spend (`useSpendFilters`) and IFTA
   put their window in the URL and say in their own headers why. Fuel Log, Transactions, Rejections and
   Cards hold filters in a local `ref` and are unshareable. Alerts reads `?vehicle=` once as a seed and
   never writes back.
9. **Fuel Spend's `barCount` already carries the fix for a defect this plan generalises.** X8's comment
   records that one unfiltered count sat beside six different tab bodies. The same class of defect —
   one page-level control describing a different tab's data — is what a naive tab merge reintroduces.

### 0.3 Measured IN PRODUCTION, 2026-09-01 (`supabase db query --linked`, read-only)

The tree audit above says how the code behaves. These say what the data is, and three of them reorder
this entire plan.

| Measured | Value | What it means |
|---|---|---|
| Canonical fills | **14,796** (2026-01-01 → 2026-09-01) | Real volume. Nothing here is a toy-data artefact. |
| Fills whose station-local date ≠ their UTC date | ~~2,278 — 15.4%~~ → **1,833 — 12.4%** (re-measured 2026-09-01, T1) | Rows whose displayed date and filter date disagree (A1). |
| Fills a month-boundary filter puts in the wrong month | ~~76, worth $38,473~~ → **57, worth $28,430.70** (re-measured 2026-09-01, T1) | Every month, fills land in the neighbouring month's total (A1). |
| `fuel_statements` rows | **0** | No statement has **ever** been uploaded. |
| `fuel_recon_runs` rows | **0** | The reconciler has **never** run. |
| `fuel_exceptions` rows | **0** | The ledger has never held a single finding. |
| `anomalies` rows | **218**, all `rule_id = 'theft_case'` | One detector is the entire Alerts page. |
| Anomaly dispositions | **3 confirmed · 95 false_positive · 7 benign_explained · 113 unreviewed** | Measured precision **3 of 105 reviewed ≈ 2.9%**. |
| `fuel_spend_days` rows / build dates | **29,114** rows, `updated_at` between **2026-08-25 and 2026-08-31** | Everything outside the trailing 14 days was derived once, on the day F9 shipped, and never re-derived through any fix since (A6). |
| Fills resolved to a station | **14,291 / 14,796 — 96.6%** | The station backfill is in good shape. |
| Distinct EFS units / not matching a vehicle | **186 / 4** | The unit-facet gap is real and small. |
| `duty_equipment_segments` rows | **0** | **There is no historical trailer pairing anywhere in the product.** |

**Three of these change what this plan is.**

1. **The Exceptions page is empty and always has been.** It is not conceptually confusing — it renders
   nothing, because its only producers (`reconFindings`, `contractFindings`) require an uploaded
   statement and none exists. C6 is therefore not an enhancement; it is **the only way the page ever
   acquires a row from the fuel data this carrier actually has.**
2. **The Alerts queue has a measured precision of ~2.9%.** 95 of 105 reviewed cases were marked
   `false_positive` by a human. A queue wrong 19 times out of 20 cannot be shown to a company owner,
   and it certainly cannot be merged into the money ledger — C7 would join a 3%-precision feed to the
   figure meant to prove the product's worth. This is Q-FUI6 and it **gates C7 ahead of Q-FUI1.**
3. **Historical trailer pairing does not exist.** `trailers.assigned_vehicle_id` is current-state only
   and `duty_equipment_segments` — the one time-ranged equipment table in the schema — is empty. The
   Fuel Log's Trailer column cannot be made correct; it can only be removed or relabelled (D-FUI14).

### 0.3a Why the alerts are wrong — measured 2026-09-01, after the owner's 2026-09-01 ruling

The owner ruled that the false positives are input-quality, not logic: *"some anomalies are incorrect
because data for truck fuel tank capacity is wrong… some because data we are getting for fuel tank level
at the moment of fueling is not correct."* That is confirmed, and the measurement makes it sharper —
there are **three** root causes, not two, and the one the owner named second is not costing precision.

**Signals behind the 218 cases** (`case_signals` joined to `anomalies.disposition`):

| Rule | Fires | `false_positive` | `confirmed` | Depends on |
|---|---|---|---|---|
| `cumulative_overfuel` | **89** | **55** | **0** | entered tank capacity **and** `robustWindowMiles` |
| `card_multi_vehicle` | **50** | **25** | 0 | card→truck assignment |
| `odometer_mismatch` | 27 | 5 | 1 | odometer quality |
| `expected_odometer_band` | 21 | 13 | 0 | odometer quality |
| `odometer_daily_cap` | 17 | 11 | 0 | odometer quality |
| `tank_space_exceeded` | 10 | 0 | 0 | tank sensor (gated) |
| `odometer_regression` | 9 | 5 | 0 | odometer quality |
| `tank_fill_short` | 9 | 0 | 0 | tank sensor (gated) |
| `impossible_travel` · `implausible_topoff` · `fuel_while_driver_home` · `odometer_stale` · `mpg_deviation` · `mpg_sustained_decline` | ≤4 each | ≤1 each | 0 | — |

**Fleet input quality:**

| Measured | Value |
|---|---|
| Non-retired vehicles | **195** |
| `tank_sensor_reliable` | **12 (6.2%)** |
| Vehicles with a sensor-**learned** capacity (`sensor_capacity_gal`) | **145** |
| …whose **entered** capacity disagrees with the learned one by >15% | **101** |
| Vehicles with no usable capacity (null or 0) | **9** |
| Tractor fills carrying **both** `samsara_fuel_pct_before` and `_after` | **2,413 / 13,696 — 17.6%** |

**And the link, proved rather than asserted.** Of the 89 `cumulative_overfuel` fires:
**48 (54%)** are on trucks whose entered capacity disagrees with the sensor-learned capacity by >15%;
**85 (96%)** are on trucks the learner has already judged sensor-**unreliable**; and **0** are on trucks
with no capacity at all — so the no-capacity guard works and the wrong-capacity case has no guard.

**The three root causes, and what each one implies.**

1. **Capacity (owner's item 1) — confirmed, and there is already a better fix than typing.** The product
   *learns* capacity from the sensor and stores it in `vehicles.sensor_capacity_gal` for 145 trucks. 101
   of those contradict the entered value. Hand-correcting 195 rows is not the shortest path; **reading
   the 101 disagreements off the learner and confirming them is** (`scripts/export-equipment-worksheet.mjs`
   already exists to produce that kind of sheet).
2. **The missing gate — this is the actual defect.** `case_gates` suppresses the sensor-dependent rules
   when `tankSensor !== 'reliable'`, which is why `tank_space_exceeded` and `tank_fill_short` produce
   **zero** false positives. But `cumulative_overfuel` reads **entered capacity**, not the sensor, so the
   gate does not cover it — and 96% of its fires are on trucks where nothing about the tank is trusted.
   **There is no gate for "the entered capacity contradicts the learned capacity."** Adding one is a
   pure-function change in `anomalyRules`, needs no new data, and addresses the largest single source of
   false positives in the section.
3. **Odometer quality (not named by the owner) is the second cluster.** `odometer_mismatch` +
   `expected_odometer_band` + `odometer_daily_cap` + `odometer_regression` = **74 fires, 34 false
   positives, 1 confirmed** — and `cumulative_overfuel` depends on odometer too, through
   `robustWindowMiles`. **`card_multi_vehicle` is a third, independent cause** (50 fires, 25 false
   positives, 0 confirmed) that touches neither capacity nor tank level — it is card→truck attribution
   (WP3/WP3B).

**The owner's item 2 — tank level at the moment of fueling — is costing COVERAGE, not precision.** Only
17.6% of tractor fills carry both readings and only 12 sensors are trusted, so the gates correctly hold
those rules silent: `tank_space_exceeded` and `tank_fill_short` have fired 19 times between them with
**zero** false positives. Fixing the level feed would *switch checks on* that are currently off. It would
not remove a single alert now on the screen. Both are worth doing; they are not the same job, and only
the capacity/odometer/card work moves the 2.9%.

### 0.4 Capability parity across the section (tree audit, 2026-09-01)

| Page | Multi-select | Export | URL state | Totals |
|---|---|---|---|---|
| Fuel Log | ✗ | ✗ | ✗ | 5 tiles |
| Transactions | ✗ | ✗ | ✗ | **none** |
| Rejections | ✗ | ✗ | ✗ | **none** |
| Cards | ✗ | ✗ | ✗ | ✗ |
| Fuel Spend | trucks | 6 CSV + 1 PDF | ✓ | ✓ |
| Exceptions | status, kind | 1 CSV + 1 PDF | window only | 4 tiles |
| IFTA | ✗ | ✗ | ✓ | ✓ |
| Truck Stops | ✗ | ✗ | ✗ | ✗ |
| Alerts | ✗ | ✗ | seeds `?vehicle=`, never writes | ✗ |

**Every export in the section lives on two pages.** `FilterSelect` has supported `multiple` since the
design-system work and is used **three times in the whole app**. "Truck 654's fuel for August, as a
file" is not answerable anywhere in the product.

### 0.5 Accuracy findings (A-series), each verified against the tree

- **A1 · One date range means four different things.** `fuel_transactions.fueled_at` is a UTC instant
  rendered station-local by `stationDateTime()` but filtered as a bare string Postgres reads as UTC;
  `efs_transactions.tran_date` is a station-local calendar date; `declined_transactions.declined_at` is
  an instant displayed in `EFS_REJECT_TZ` (`America/Chicago`, because EFS documents reject times as
  Central regardless of station); `fuel_spend_lines` returns a business date. Quantified in §0.3.
- **A2 · Two roles that exist to review numbers are locked out of them.** `accountant` and `auditor`
  hold `fuel: "view"`, but `/api/fueling/spend-report.pdf`, `/exceptions` and `/statements` hardcode
  `requireRole("admin","fleet_manager","dispatcher")`. Across the fuel API: **~26 hardcoded role lists
  against 4 uses of the derived matrix** (`ifta/routes/index.ts` is the correct one). Visible effect:
  the nav shows Exceptions to an accountant, the route is `requiresAuth` so the page loads, and the API
  returns 403. This is `CLAUDE.md`'s named anti-pattern — a hand-written role list beside a derived
  matrix — and **already recorded**: `check-section-policies.mjs`' header names this exact surface as a
  2026-08-27 audit finding (D-SEP10). It survived because the gate that was built checks migration RLS
  policies above 0260, and `routeGates.test.ts` checks that a gate *exists* rather than which roles it
  names. The finding fell between them.
- **A3 · The ledger accepts a truck scope, preserves it, and ignores it.** `useSpendFilters` is shared
  with the Exceptions page and carries `?trucks=`; `ExceptionQuery` has no vehicle field, `qs()` never
  sends one, and `/api/fueling/exceptions` has no vehicle filter.
- **A4 · The fleet's headline numbers are aggregated in the browser, on a boundary.**
  `useFuelRangeTotals` — which drives the Fuel Log tiles **and** the Dashboard strip — pages the whole
  filtered set into the browser and sums client-side. Its `PAGE = 1000` equals `supabase/config.toml`'s
  `max_rows = 1000`, and the loop exits on `batch.length < PAGE`. **Correctness depends on two
  constants in different places being equal**; drop the hosted API row limit below 1,000 and every tile
  silently under-reports with no error. F9 already moved spend aggregation server-side (0252) for this
  reason; the log never got it.
- **A5 · The Trailer column shows today's pairing beside a historical fill.** Admitted in its own
  comment. §0.3 proves it cannot be fixed, only removed or relabelled.
- **A6 · The spend rollup goes stale past 14 days and nothing says so.** `REBUILD_DAYS = 14`;
  everything older was built once (§0.3) and the spend-report PDF reads it. `fuel_spend_days.updated_at`
  exists, so the honest line is cheap.
- **A7 · Coverage and freshness are stated on two pages only** — Fuel Spend's coverage line and IFTA's
  health gate. Both are the right pattern and both argue for themselves in their own headers.

### 0.6 The one-line thesis

**The capabilities are built and mostly good; the section is organised by where data came from rather
than by what somebody is trying to do — and underneath that, three of its surfaces are not carrying
data anybody can act on.** Transactions and Import are not jobs, they are provenance. Alerts and
Exceptions are the same job under two roofs, except one of them is empty and the other is wrong 19
times out of 20. Everything in §5 either makes a number trustworthy enough to show an owner (the
T-series), gives a page the scope and export an owner asks for (the P-series), or moves a provenance
surface behind the thing it explains (the C-series) — **and the T-series comes first, because
consolidating pages on top of an off-by-a-day filter only makes the wrong number easier to find.**

---

## 1. The architecture this must end in

Five theses. A step that serves none of them does not belong in §5.

### 1.1 Raw source data is evidence, and evidence lives behind the row it explains

`efs_transactions` earned its place: D-FX2's whole argument is that the vendor's account and ours must
be separately inspectable. What it did not earn is a sidebar entry. A controller does not go to a page
called Transactions; they are looking at a fill and asking *what did EFS actually send*. That is a
drawer, and the pattern is already in the tree (`ExceptionSlideOver`, `UnitMileageDrawer`, the
Rejections card drawer).

### 1.2 One inbox, two case tables — the surface unifies, the schema does not

D-FX2 ruled that `fuel_exceptions` cannot be `anomalies`, and the reason still holds:
`anomalies.transaction_id` is `not null`, and the single most valuable finding the reconciler produces —
a line the vendor billed that we have **no** `fuel_transactions` row for — has no transaction by
definition. **This plan does not overturn D-FX2 and does not merge the tables.** It unifies the
*surface*: one Findings inbox reading both producers through a shared read contract, with **one queue
axis** presented to the reader and each source's own close semantics preserved behind it (D-FUI7, and
§0.2 fact 4 for why that qualification is load-bearing rather than fussy). A merged table would be a
workaround with a delay fuse; a merged screen is the actual product requirement.

### 1.3 A detector that does not file a finding is a report, and reports do not get worked

The three policy tabs are the clearest case: they price real money on every page load and leave no trace
that anybody looked. Every detector in the section files into the ledger, or it is honestly labelled as
an analytic view and stops pretending to be a queue.

### 1.4 One period control per page, and it is in the URL

`useSpendFilters` exists because two period controls on one page is how two figures for one week get
quoted at each other. Every page in the section adopts it, and every page becomes sendable.

### 1.5 A figure an owner will act on carries its own trust, or it is not shown

The two best surfaces in the section already do this and both argue for it in their own headers: Fuel
Spend prints what share of the window it can speak about, and IFTA puts the MPG verdict ABOVE the money
and dims the table behind it. That is the standard. A number with no denominator beside it reads as a
claim about everything, and §0.3 is what that costs — $38,473 a year in the wrong month, from a filter
nobody knew had a timezone in it.

### 1.6 A detector's output is only worth surfacing at the precision it has earned

Measured 2.9%. A queue at that precision is not a work queue, it is a source of distrust that spreads
to the figures beside it. The choice is to fix the detector, to raise its threshold until what remains
is worth a person's time, or to stop showing it — not to reorganise the page it sits on.

### 1.7 Nothing in this plan invents a capability to justify a screen

Every merge below removes a surface or moves one. The two genuinely new things — the policy-finding
producer (C6) and the findings inbox (C7) — are both completions of work that shipped deliberately
half-done, with the reason recorded in the source at the time.

---

## 2. Decisions

- **D-FUI1 — Transactions and Rejections become tabs of Fuel Log, and Fuel Log keeps the name.** The
  page becomes `Fills | Declines | Source records`, one window, one truck filter, all three in the URL.
  Fuel Log is the enriched record and the write surface; it is the one that survives.
- **D-FUI2 — the raw EFS line moves into the fill's row drawer.** `Source records` remains as a tab for
  the reconciliation case (a line with no fill has no row to hang off), but the *normal* path to raw
  data is the drawer on the fill it explains.
- **D-FUI3 — `/import` is retired as a page.** EFS upload becomes a drawer on Fuel Log labelled as the
  backfill path it now is; the Pilot price and locations uploads become one Upload drawer on Truck
  Stops; **Repair fuel data** moves to Settings → Data & Sync, which is where the other repair actions
  already are. No capability is lost and no upload is deleted (§0.2 fact 6).
- **D-FUI4 — Fuel Spend keeps three tabs.** `Spend & trend | Buy discipline | Statements`. Reconcile a
  file becomes an upload drawer on the Statements tab (it is an upload, and every other upload in this
  plan is a drawer). Discount capture folds into Spend & trend as a KPI with drill-down. The three
  policy tabs become finding kinds — see D-FUI5.
- **D-FUI5 — the policy tabs stop being tabs and start being producers.** Grouped, not per-fill: the
  unit of work is *this truck, off-network, this month, $N* — not 201 rows. This answers the orphaned
  `policyFindingsNote` question; the grouping key is fixed in Q-FUI3 before C6 is built.
- **D-FUI6 — Exceptions is renamed Findings and becomes the section's single inbox.** Not because
  "exception" is wrong, but because it must now hold anomaly cases too, and those are not billing
  exceptions.
- **D-FUI7 — one WORKFLOW axis is presented; each source keeps its own CLOSE axis.** Measured fact 4
  forbids the obvious design. What the two models genuinely share is the queue axis —
  `open → investigating → (working) → closed` — and that is what the inbox presents, filters and ages
  on. What they do not share is what closing MEANS: an anomaly closes with a **disposition** (was the
  flag right — the accuracy program's ground truth), a fuel exception closes with **money** (credited,
  or a decision not to pursue). The inbox therefore renders one status column and a per-kind close
  affordance, and the shared module maps only the queue axis. **`resolved → credited` and
  `resolved → dismissed` are both wrong and are named here so nobody writes them:** an anomaly resolved
  as `confirmed` is a true finding that recovered nothing, and mapping it onto either would corrupt both
  the recovery figure and the precision figure. `superseded` maps to `resolved_by_reingest` — the same
  idea in both vocabularies, and the only clean correspondence in the set.
- **D-FUI8 — every page in the section adopts `useSpendFilters`' URL-window pattern.** Shipped as its
  own step (C3) rather than smuggled into a merge, because it touches four pages and one regression
  there is invisible in review.
- **D-FUI9 — no new Fuel overview page.** The Dashboard already computes exactly those figures from
  `useFuelRangeTotals`. A second one would be a second source of truth for the same five numbers.
  C9 improves the Dashboard's fuel strip instead.
- **D-FUI10 — targets ship with the policy, not with the report.** An exception count without a target
  is not a management number. `route_fuel_settings` already holds `avoid_states` / `avoid_brands`; the
  target thresholds go beside them, not into a new table.

- **D-FUI11 — one date contract, named on screen.** Every fuel surface filters and displays on the
  **station-local business date**, because that is the day the fill happened where it happened, it is
  what the EFS report prints, and it is what a controller means by "August". `fueled_at` keeps its
  instant for ordering and for time-of-day display; the *filter* moves to a business date. Each date
  control states which day it means.
- **D-FUI12 — every fuel route derives its gate from `SECTION_ACCESS`.** `rolesThatCanView("fuel")` /
  `rolesThatManage("fuel")`, as `ifta/routes/index.ts` already does. A hardcoded role list in this
  section is a defect from the day this lands, not a style preference.
- **D-FUI13 — aggregates are computed where the rows are.** F9's ruling (0252), applied to the fuel log.
  No browser-side sum of a set the browser had to page through, and no correctness that depends on two
  constants in two repositories being equal.
- **D-FUI14 — a column shows the fact as of the row's instant, or it does not show.** The Trailer
  column on Fuel Log is **removed**, not relabelled: §0.3 proves there is no historical pairing to show,
  and a live fact beside a historical row is a wrong answer presented confidently. Current pairing stays
  where it is already correct and already labelled — the vehicle and reefer-coverage surfaces.
- **D-FUI15 — every list page gets multi-select and a scoped export, built to the `spend-report.pdf`
  standard.** That route is the reference implementation in this repo: server-rendered from the same
  pure functions the screen uses so the two cannot disagree, filters honoured, UUIDs validated before
  reaching a service-role query, an audit row per export, and `ReportExportButton` printing the scope
  the document will carry. Copy it; do not invent a second export shape.
- **D-FUI16 — facet options derive from the data they filter.** The Transactions unit list is built from
  `vehicles.unit_number`, so the 4 EFS units with no vehicle row (§0.3) are unfilterable while their
  rows still appear. `useEfsFacets` already exists and gains a units facet. Deriving beats restating.
- **D-FUI17 — the ledger is filterable and exportable by truck.** A3 closed at both ends: the field in
  `ExceptionQuery`, the parameter in `/api/fueling/exceptions`, the control on the page.
- **D-FUI18 — a derived table states when it was derived.** `fuel_spend_days.updated_at` already exists;
  the spend page and the PDF both print the oldest build date in the window. A6 is a labelling fix, not
  a rebuild policy change — though T5 also raises `REBUILD_DAYS` behaviour to Q-FUI9.

---

## 3. Facts the design is bound by (verified 2026-09-01)

- **The business-date machinery already exists in both layers and must be reused, not rewritten.**
  TS: `businessDate(fueledAt, state)` in `packages/shared/src/fuelSpend/rollupDerive.ts`. SQL:
  `fuel_business_date(timestamptz, text)` over `fuel_station_tz(text)`, applied in migration **0247**.
  0247 also already solved the filtering shape: *"the instant window is widened a day each side and the
  business date is filtered afterwards."*
- ⚠ **Both SQL helpers are declared `set search_path = public`, which blocks SQL inlining.** That is the
  ~128×-per-row scalar penalty recorded against this repo — the one that took the spend page down
  silently. `fuel_business_date` may be applied to a **bounded** set (0247's widened window), never to an
  unbounded per-row scan. And it is `stable`, not `immutable`, deliberately (the tz database can move on
  a server upgrade), so it **cannot** back a generated column or an index expression. A written,
  backfilled column is therefore the only indexable route — which makes T1 two merges, not one.
- `anomalies` carries **two axes** (§0.2 fact 4) and `fuel_exceptions` carries one. Any shared read
  contract is a discriminated union on the close, not a widened enum.
- `SECTION_ACCESS` (`packages/shared/src/auth.ts`) gives `accountant` and `dispatcher`
  `fuel: "view"`, `safety: "none"`. **A Findings inbox in the Fuel section that contains anomaly cases
  hands fuel-card theft alerts to the bookkeeper and the dispatcher.** This is Q-FUI1 and it blocks C7b,
  not C7a.
- `safety_manager` has `fuel: "view"`, `safety: "manage"` — so the same inbox must let a safety manager
  *act* on the anomaly half while only reading the spend half. Per-kind write gating, not per-page.
- The Exceptions route is `requiresAuth` only, deliberately: its own comment records that a controller
  checking recoveries must not need permission to upload a statement. A merge that inherits Fuel Spend's
  `requiresManage: "fuel"` silently narrows access.
- `router/routeTable.test.ts` holds **two committed snapshots** (path-sorted, and order-sensitive
  resolution). Every route change in this plan updates them, and the diff is how the change is
  acknowledged.
- `apps/web/src/lib/nav.test.ts` requires a **unique glyph per nav item**. Removing items is free;
  any new one needs an icon added to `packages/ui/src/icons.ts` first, per that barrel's instructions.
- The old paths are kept forever, not for a deprecation window — `fuel.ts`' own comment. Every route
  retired here gains a `redirect` that preserves the query string.
- 500-line file budget, warn at 450 (`lint:filesize`). `FuelCardsPage.vue` is at 412 and
  `FuelLogPage.vue` at 362; C2 adds two tabs to the latter and **must** extract, not append.
- `lint:ui-adoption` refuses raw `<input>`; `lint:comment-claims` requires a quoted real test title;
  `pnpm lint` scans `.claude/worktrees` — filter the path before believing a failure count.
- No migration in this plan may ship in the same merge as its first reader
  (`lint:migration-ordering`, `docs/MIGRATION-DISCIPLINE.md` §the-deploy-window).

---

## 4. Execution protocol

### 4.0 Verification status of this plan (2026-09-01)

Every step below was checked against the tree and, where the answer lived in data, against production.
This table is the audit trail — a step marked **assumption** has not been proven and must be proven
before it is built, not during.

| Step | Status | What was checked |
|---|---|---|
| T1 | **verified** | `fuel_business_date`/`fuel_station_tz` exist (0247); both are `set search_path` (inlining trap) and `stable` (no generated column / index expression); 11 writers incl. the browser → trigger is the only safe maintenance point; `state` non-null on 14,796/14,796. |
| T2 | **verified** | 26 hardcoded lists counted; `ifta/routes/index.ts` is the working pattern; both existing gates read and shown unable to catch it. |
| T3a | **verified** | 0252 is the shape; the five sums are pure addition. |
| T3b | **spike — deliberately unresolved** | D-AG1 read; `robustWindowMiles` and the MPG band shown to be judgement, not addition. Whether the seam can be drawn without copying a constant is **not known** and is the spike. |
| T4 | **verified** | `duty_equipment_segments` = 0 rows; no other time-ranged pairing in the schema. |
| T5 | **verified** | `fuel_spend_days.updated_at` present; build dates measured; `posted_last_polled_at`/`rejected_last_polled_at` present. |
| P1 | **verified** | `FilterSelect` supports `multiple`; `useEfsFacets` exists; 4 EFS units with no vehicle row. |
| P2 | **partly assumption** | The `spend-report.pdf` pattern is verified as the standard. **What the report should SAY is not decided** — Q-FUI10. Row-level CSV is the fallback and is safe. |
| P3 | **verified** | `ExceptionQuery`/`qs()`/the route all lack a vehicle field; `assignedTo` exists server-side and is unsent. |
| C1 | **verified** | `FuelEventsPage.vue` has zero references. |
| C2 | **BUILT 2026-09-02** | The filter/column checklist below was enumerated in the step, as this row said to: `FuelLogTabs.test.ts` writes out all three column lists. The shape row missed one thing worth recording — **the merge crosses a permission boundary** (`/fuel-log` is `always`, the two absorbed pages were `section("fuel")`), which C3–C5 do not. |
| C3–C5 | **verified as shape, unbuilt** | Routes, nav gate, snapshots and file budgets all read. C3 now starts from a page whose window, truck and tab are already in the URL; what remains is the per-tab facets and the other two pages. |
| C6 | **blocked** | Q-FUI3. §0.3 shows the ledger has 0 rows, which raises its priority. Q-FUI7 is now answered, so the `recon_*` half has a reachable producer as soon as one statement is uploaded. |
| C7 | **blocked ×2** | Q-FUI11 (the fix order for the 2.9%; Q-FUI6's cause is now measured) then Q-FUI1 (capability matrix). |
| C8 | **verified as shape** | `route_fuel_settings` holds the policy today. Target values themselves need Q-FUI10's audience answer to be meaningful. |
| C9 | **verified** | Dashboard tiles all point at `/fuel-log`; the ledger figures exist to point at once C6 fires. |

**Known unknowns, stated rather than buried:** the T3b seam; what the owner-facing report should say
(Q-FUI10); the fix order for the three alert root causes and whether the missing capacity gate ships
ahead of the data correction (Q-FUI11); and whether the 113 unreviewed anomalies would move the 2.9%
figure materially if somebody worked them.

**Closed since the first draft:** Q-FUI6 (cause measured — input quality, three root causes, §0.3a) and
Q-FUI7 (the weekly PDF is a Pilot invoice, five are on disk, only the upload is missing).

**Resume ritual (a fresh chat starts here):**

1. Read this document top to bottom, then `FUEL-SPEND-RELIABILITY-PLAN.md` §2 and §6 (the decisions and
   the open questions this plan inherits), then `apps/web/CLAUDE.md` and
   `docs/DESIGN-SYSTEM-CONTRACT.md`.
2. Establish reality: `git log --oneline -15`, `pnpm verify:live`, `git branch --show-current`.
3. Find the first §5 step not marked **DONE**. Check its prerequisites against §6. A missing
   prerequisite means take the fallback written beside it — never guess.
4. One step per branch (`claude/<topic>`), branched from `origin/main` **explicitly** (parallel chats
   share this working tree), PR to `main`, merge after CI.
5. When a step ships, mark it **— DONE \<date\>** in place with "What shipped" and "Verified by:"
   naming the gates. When a §6 question is answered, strike it through in place with the answer and the
   date. **This document is the memory between sessions.**

**Gates before any PR:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, plus each step's named extras.
Every step that touches routes additionally runs the route-table and nav snapshots; every step that
touches a page runs `lint:ui-adoption`, `lint:filesize` and `lint:funcsize`.

---

## 5. Steps

Three phases. **T (trust) comes before P (parity) comes before C (consolidation)**, and the ordering is
the argument: a scoped export of a wrong number is worse than no export, and a merged page built on an
off-by-a-day filter only makes the wrong number easier to find. Every step is independently shippable
and independently revertible. C1 is the exception to the ordering — it deletes dead code and depends on
nothing, so it goes first to make everything after it smaller.

**Dependency order:** `C1 → T1 → T2 ∥ T3 ∥ T4 ∥ T5 → P1 ∥ P2 ∥ P3 → C2 → C3 → C4 → C5 → C6* → C7a → C7b* → C8 → C9`
(`*` = gated on a §6 ruling; `∥` = independent of each other and parallelisable.)

---

## Phase T — trust

### T1 · One date contract, and it is the station-local business date

**Prerequisites:** C1. **Blocks C2** — three tabs under one date control with three date meanings is
§0.5 A1 shipped as a feature.

**Build — two merges, because of the deploy window.**

- *Merge 1 (migration only).* Add `fuel_transactions.business_date date`, **maintained by a BEFORE
  INSERT OR UPDATE trigger** calling `fuel_business_date(fueled_at, state)`, plus a one-shot set-based
  backfill and a `(org_id, business_date)` index.

  ⚠ **A trigger, not a stamp in the writers, and not a generated column.** `scripts/table-writers.json`
  lists **eleven** writers of `fuel_transactions` — including `apps/web/src/features/fuel/useFuelLog.ts`,
  i.e. **the browser inserts directly**. Asking eleven call sites to remember a derived column is a
  defect waiting on the twelfth, and letting the browser assert a business date is the browser asserting
  a conclusion, which is the thing `POST /api/fueling/statements` was shaped to avoid. A generated column
  is unavailable for the separate reason 0247 records: `fuel_business_date` is `stable`, not `immutable`,
  because `at time zone` reads the server's tz database. A trigger has neither problem — it evaluates
  once at write time, on a bounded row set, which is also what keeps it clear of the `set search_path`
  inlining penalty.

  *Verified precondition:* `state` is non-null on **14,796 of 14,796** canonical fills (re-measured
  2026-09-01; Q-FX2's 2026-08-25 answer holds at the larger volume), so the function's `'UTC'` fallback
  never fires in production.
- *Merge 2 (the readers).* `useFuelLog` and `useFuelRangeTotals` filter `business_date` instead of
  `fueled_at`. `efs_transactions.tran_date` is already a business date and needs no change.
  `declined_transactions` gains the same treatment against `EFS_REJECT_TZ` rather than a station zone —
  EFS documents reject times as Central, so that is the day the vendor means.
- Every `DateRangeFilter` in the section gains a one-line note naming the day it filters on.
- `fueled_at` is untouched and keeps doing what it is good at: ordering, and time-of-day display.

**Done when.** The 76 fills / $38,473 in §0.3 land in the month they were bought in, and a fill
displayed as "Aug 31" is inside an August window on every fuel surface.

**Verified by.** A PGlite matrix printing a `RESULT` line, seeded with the real failing shape — a
California fill at 18:00 local on the last day of a month — asserting it is inside that month's window
and outside the next. `lint:migrations`, `lint:migration-ordering`, `lint:table-writers` (the
regenerated `schema.generated.sql` is part of the migration commit), `lint:upserts`.

#### — MERGE 1 of 2 SHIPPED 2026-09-01 (PR #447, `claude/fuel-business-date-column`). T1 stays OPEN until merge 2.

**What shipped.** Migration **0287**: `fuel_transactions.business_date date`, a
`before insert or update` trigger (`trg_ftxn_business_date` → `set_fuel_transaction_business_date()`)
deriving it from `fuel_business_date(fueled_at, state)`, a one-shot backfill, and
`idx_fuel_txn_org_business_date (org_id, business_date desc)`. **Nothing reads it yet** — that is merge
2, and `lint:migration-ordering` passes precisely because of that.

**⚠ THE PLAN'S OWN FIGURES DID NOT REPRODUCE, and §0.3 is corrected in place.** Re-measured
2026-09-01 against production, session timezone confirmed `UTC`, over this plan's exact window
(canonical fills, 2026-01-01 → 2026-09-01):

| | Plan said | Measured | |
|---|---|---|---|
| Fills in window | 14,796 | **14,749** | the feed moves; not material |
| Station-local date ≠ UTC date | 2,278 (15.4%) | **1,833 (12.4%)** | −20% |
| Wrong month | 76 fills / $38,473 | **57 fills / $28,430.70** | −25% |

`(fueled_at at time zone 'UTC')::date` and `fueled_at::date` return an identical 1,833, so the gap is
not a comparator choice. Both plan figures are ~25% high and could not be reconstructed. **The benefit
is real and smaller than the plan advertised**; the reproducible numbers are what 0287's header claims,
with the query beside them so nobody re-derives it.

**Two things measured rather than assumed.**
- *The backfill's cost.* `explain (analyze)` evaluating `fuel_business_date` over the whole table:
  **81 ms** (14,808 rows, 39 MB). A full-table backfill is exactly the shape 0247's `set search_path`
  trap warns about, and the answer is that this table is small — an answer that expires if it grows,
  which is why the number is in the migration instead of a reassurance.
- *The backfill's blast radius, a trap the plan did not name.* A bare
  `update fuel_transactions set business_date = ...` touches all 14,808 rows and therefore also fires
  `trg_ftxn_updated` (stamping `updated_at = now()` on **every fill in the carrier's history**) and
  `trg_fuel_txn_satellites` (up to **three** satellite upserts per row, ~44k writes, each stamping its
  own `updated_at`, for a column no satellite mirrors). Both are muted for the statement and re-enabled
  in the same transaction. The matrix asserts the quietness rather than trusting it.

**Verified by:** the new `fuel-business-date` PGlite matrix — 12 assertions, `RESULT` line — including
`an 18:00-local fill on 31 Aug in California is INSIDE August`, `  ...and OUTSIDE September`,
`  ...while the OLD instant window puts that same fill in September — the defect, stated`,
`a writer cannot assert a business date — the trigger overwrites what it sent`,
`the backfill did not stamp updated_at on every fill in the history`, and `  and it did not re-touch
the 0261 satellites`. Proved able to fail by three mutations: letting the trigger `coalesce` to a
caller-supplied value, un-muting the two noisy triggers, and dropping the backfill statement. Gates:
`lint:migrations`, `lint:migration-ordering`, `lint:table-writers` (regenerated
`schema.generated.sql` committed), `lint:upserts`, `lint:rls`, plus `pnpm test`/`typecheck`/`lint`/
`build` and the rest of the CI list.

**⚠ A trap for the next person writing date assertions in a matrix.** **PGlite's session timezone is
`Etc/GMT+6`, not UTC.** A bare `where fueled_at >= '2026-09-01'` in a matrix therefore means 06:00Z and
answers a different question than the same string does in production — so the matrix writes its
instant bounds as explicit `::timestamptz` values. Which is A1 one layer down: the old filter's
meaning depends on whose session is asking.

**Merge 2 (the readers) is still owed**; T1's Done-when is not met until it lands.

#### — MERGE 2 of 2 SHIPPED 2026-09-01 (PR #448, `claude/fuel-business-date-readers`). T1 is DONE, with one stated exception.

**What shipped.**
- `useFuelTransactions` and `useFuelRangeTotals` window on `business_date` — the rows and the tiles
  above them now filter the same column, which is the point.
- `FuelLogPage`'s `setTo` no longer appends `T23:59:59`. That hack existed only because the filter
  windowed an instant; against a `date` it is a bug, and removing it is part of the fix rather than
  tidying beside it.
- **Declines get a computed window, not a column.** `efsRejectDayWindow(from, to)` converts the picked
  days into the UTC instants that bound them in Central, because EFS records reject times in Central
  whatever the station's own zone is. A fill's zone varies per row and needed a stored column; a
  decline's does not, so deriving beats storing — no migration, no backfill.
- **The Dashboard moved too**, because T1's Done-when says *every* fuel surface. Its fills query built
  bounds from `new Date(\`${fromDay}T00:00:00\`)` — the BROWSER's midnight — so the same picked range
  returned a different set of fills depending on where the viewer was sitting, and a different set
  again from the Fuel Log beside it. Its declined-attempt count now uses the same Central window the
  Rejections page does.
- Fuel Log, Rejections and Transactions each carry a one-line note naming the day their filter means.

**Two defects found while doing it, neither of them in the plan.**
1. **The Rejections page was dropping the last day of every window.** It passed bare `YYYY-MM-DD` to
   `.lte("declined_at", …)`, an instant comparison, so the bound was midnight UTC on the end day.
   Measured 2026-09-01: **3,428 of 3,429 declines (99.97%)** sit strictly after UTC midnight of their
   own day, so the final day of any picked range was kept only in name. 292 (8.5%) also fall on a
   different day in Central than in UTC. Both are closed by the half-open Central window.
2. **The Dashboard's fuel window was viewer-relative** (above). Nobody would have seen it from one
   timezone, which is why it lasted.

**⚠ ONE FUEL SURFACE IS NOT COVERED, and T1 does not claim it: Alerts.** `useAnomalies` filters
`anomalies.fueled_at` — a column on the `anomalies` table, not on `fuel_transactions` — so 0287's
`business_date` is not reachable from it. Closing it means another column, another trigger and another
two-merge dance on a second table, which is its own step rather than a rider on this one. Recorded as
**Q-FUI13**.

**Verified by:** `the fuel window is a window of days > the list filters business_date, inclusive at
both ends, with the days as picked`; `> the list no longer windows on the fueled_at instant`; `> the
tiles window on exactly the same column as the rows beneath them`; `> fueled_at still orders the log`;
and `efsRejectDayWindow > puts a 19:00-Central decline on 31 August inside August — the defect,
stated` plus `> ends at the START of the day after — half-open, so no second is dropped`. Proved able
to fail by three mutations: reverting the list to the instant window, drifting the tiles off the rows'
column, and returning the reject window to bare dates. Gates: `pnpm test`, `typecheck`, `lint`,
`build`, and the CI list run individually.

---

### T2 · Every fuel route derives its gate from the matrix

**Prerequisites:** C1. Independent of T1.

**⚠ This is not a new finding — it is a recorded one that was never closed.**
`scripts/check-section-policies.mjs`' own header says the 2026-08-27 audit found *"the entire fuel-spend
surface hand-listing roles instead of deriving them, and a dispatcher reading fuel spend nobody decided
they should read"* (D-SEP10). Two gates were built and **neither one can catch this**:
`check-section-policies.mjs` checks **migration RLS policies above 0260** and grandfathers everything
earlier; `routeGates.test.ts` asserts every mounted router **has** a role gate and deliberately does not
look at **which roles** it names. So the hardcoded lists survive in the gap between the two. T2 closes
the behaviour *and* the gap.

**Build.**
- Replace the ~26 hardcoded `requireRole(...)` lists in `modules/fuel`, `modules/fuel-spend` and
  `modules/anomalies` with `rolesThatCanView("fuel")` / `rolesThatManage("fuel")`, exactly as
  `ifta/routes/index.ts` does. Read routes take the view set, write routes the manage set. `accountant`
  and `auditor` gain the reads their matrix row already grants; **nobody gains a write.**
- **Extend `routeGates.test.ts`** from "a gate exists" to "the gate's role set equals the matrix's set
  for that router's section", with the same shrink-only waiver list the file already uses for auth-only
  mounts. Without this the lists drift back and the next audit re-finds them in another year.
- ⚠ CI runs ~19 gates from `.github/workflows/ci.yml`; a new or widened gate ships **in the same PR** as
  its ci.yml step (`cannot-push-workflow-file-changes` was resolved 2026-08-31).

**Done when.** An accountant can open Exceptions without a 403 and can generate the spend report, and a
future hardcoded list fails CI rather than waiting for an audit.

**Verified by.** The extended `routeGates.test.ts`; `lint:section-policies`; a per-role test over
`SECTION_ACCESS` for each fuel endpoint.

#### — DONE 2026-09-01 (PR #446, `claude/fuel-route-gates-derive`)

**What shipped.** 23 hand-written role lists replaced with the derived form across five route files;
the other two of the 25 counted (`/thresholds`, `/discount-rules`) were already
`rolesThatManage("admin")` and were left alone.

| File | Sites | Reads → | Writes → |
|---|---|---|---|
| `modules/fuel/routes/transactions.ts` | 10 | — | `rolesThatManage("fuel")` |
| `modules/fuel-spend/routes/spend.ts` | 3 | `rolesThatCanView("fuel")` | `rolesThatManage("fuel")` |
| `modules/fuel-spend/routes/exceptions.ts` | 5 | `rolesThatCanView("fuel")` | `rolesThatManage("fuel")` |
| `modules/fuel-spend/routes/statements.ts` | 3 | `rolesThatCanView("fuel")` | `rolesThatManage("fuel")` |
| `modules/anomalies/routes/anomalies.ts` | 2 | — | `rolesThatManage("safety")` |

`accountant`, `auditor` and `safety_manager` gained the reads their matrix row already granted.
**Nobody gained a write** — `rolesThatManage("fuel")` *is* `admin, fleet_manager`, which is what every
write already said.

**One widening beyond what A2 enumerated, named because it is a decision.** `GET
/exceptions/packet.pdf` was `admin, fleet_manager` and is now the view set. It is a read — it renders
findings the caller may already read and writes no business row — and an accountant is exactly who
assembles a claim. Deciding a finding's outcome is the PATCH, which did not move.

**Two gates, because the form and the consequence are different properties.**
- `routeGates.test.ts` gained a **source-level** fitness function: every `router.<verb>` in the three
  modules' route files must gate with `rolesThatCanView(section)` for a read or
  `rolesThatManage(section)` for a write, with a shrink-only waiver map. It reads the SOURCE, not the
  mounted stack, on purpose — comparing role *sets* at runtime cannot tell a derived answer from a
  coincidence, because `admin, fleet_manager, dispatcher` is exactly `rolesThatManage("dispatch")`.
  It also asserts every declared route was parsed, so a route the parser cannot see fails rather than
  passing unexamined.
- `apps/api/src/fuelSectionRoles.test.ts` is new and **behavioural**: 7 endpoints × 9 roles against
  the real app, asserting a permitted role gets past the gate and a refused one does not. It
  reproduces the original defect exactly — reverting one list turns the `accountant`, `auditor` and
  `safety_manager` cases red.

**No `ci.yml` change was needed.** Both are vitest, so `pnpm test` already runs them.

**Verified by:** `fuel-section route gates derive from SECTION_ACCESS (FUEL-T2, D-FUI12) > every
fuel/anomaly route reads its roles from the matrix — reads the view set, writes the manage set`;
`fuel-section endpoints agree with SECTION_ACCESS, per role > an accountant and an auditor can read
the ledger they were shown and then refused`; `...and neither of them gains a write`. Proved able to
fail by four mutations: restoring a hand-written list, putting the view set on a write route, hiding a
route from the parser, and re-checking that the per-role suite goes red on the first of those. Gates:
`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, plus the CI gate list run individually.

**Found while doing it, not fixed here — see Q-FUI12.** Four reads in these modules carry no role gate
at all.

---

### T3 · The fleet's totals are computed where the rows are

**Prerequisites:** T1 (so the aggregate and the filter agree on what a day is).

**⚠ Split, because 0252's D-AG1 forbids the obvious version.** That migration's ruling is *"THIS SUMS.
IT DOES NOT DERIVE"* — judgement stays in TS so there is never a second copy of it somewhere no unit
test can reach. Two of the five figures `useFuelRangeTotals` produces are judgement, not addition:
gallon-weighted fleet MPG applies a plausibility band, and `robustWindowMiles` prefers an OBD span, falls
back to the entered span **only if it is monotonic within ±1**, and returns `null` rather than `0` for a
non-advancing window — a guard its own header calls the single most important one it makes. Re-expressing
either in SQL is precisely what D-AG1 exists to prevent.

**T3a — the sums. No spike needed, ships immediately.** A set-based RPC in the 0252 shape returning
`fills`, `gallons`, `spend`, `flagged`, `clear` for the filtered window. Four of the six tiles stop being
computed in the browser and the `PAGE`/`max_rows` coupling stops mattering for them.

**T3b — the seam for miles and MPG. A spike first, in F0's precedent.** The question is whether the RPC
can return per-vehicle odometer aggregates rich enough for `robustWindowMiles` and the MPG band to run
unchanged in TS **without copying a constant into SQL** (the ±1 tolerance, `MIN_WINDOW_ADVANCE_MI`,
`MPG_PLAUSIBLE_MIN/MAX`). If it can, implement. **If it cannot, the honest outcome is that these two
figures keep paging and the step says so** — a wrong MPG computed quickly is worse than a right one
computed slowly, and the plausibility guards are there because each was got wrong once already.

**Done when.** T3a: four of six tiles are server-summed. T3b: either the seam is drawn and tested, or the
finding is recorded and the paging loop is left with a comment naming D-AG1 as the reason.

**Verified by.** A shared test asserting RPC output equals the current pure-function output on a fixture
spanning **more than one 1,000-row page** — the exact case the present loop is one config change away
from getting wrong; the `fuel-spend-by-period` matrix pattern (`RESULT` line); `lint:rpc-org-default`;
`expectOrgScoped`.

#### — T3a MERGE 1 of 2 SHIPPED 2026-09-02 (`claude/fuel-range-totals-rpc`). T3a is OPEN until merge 2.

**What shipped.** Migration **0289**: `fuel_range_totals(...)` returning `fills`, `gallons`, `spend`,
`has_cost`, `flagged`, `clear`, plus `fuel_search_escape(text)`. `security invoker`, `p_org` last with a
DEFAULT (D-FC1). Nothing calls it yet — the reader is merge 2.

**⚠ Two merges, and `lint:migration-ordering` would NOT have caught this one.** That gate reads added
*columns*; a new FUNCTION is invisible to it. But the failure is identical — for the ~9 minutes between
Railway serving a merge and `migrate.yml` applying it, a browser calling a function the database does
not have gets a PostgREST 404, and the Fuel Log's tiles break on a page people are using. **The gate's
silence here is a gap in the gate, not permission.**

**Why the split is correctness rather than speed, since the loop still runs for two tiles.** The browser
pages `fuel_transactions` 1,000 rows at a time until a short page arrives. PostgREST's `max_rows` is a
server setting the client does not control and this carrier is already fifteen round trips into it; if
that ceiling moves, **every tile reads low with no error beside it**. Summing in SQL removes the coupling
for the four figures that are pure addition. It does not make the page faster — T3b decides the rest.

**D-AG1 held: `has_cost` is returned as its own boolean.** `sum()` cannot distinguish "no fill carried a
cost" from "the costs sum to zero", and the tile renders those differently — "—" against "$0".

**Verified by:** `supabase/tests/fuel-range-totals.test.mjs` — 19 assertions, `RESULT` line, over a
**2,400-row fixture past two page boundaries**, compared against totals accumulated row by row in
JavaScript the way the browser's loop did. Proved able to fail by six mutations: dropping
`is_canonical`; inferring `has_cost` from `spend > 0`; dropping the org filter; passing the raw search
term to `ilike`; making `p_to` exclusive; and counting `clear` with its own condition instead of as the
complement.

**⚠ Three of those six initially passed, and each exposed a real hole in the fixture rather than in the
SQL** — worth recording because all three are the same shape, *a fixture that cannot tell two
implementations apart*:
- **`p_to` exclusive** — every fixture row sat on the 15th, so no bound change could move the count. A
  fill on the closing date was added.
- **no escaping** — the `%` case passed, but nothing covered `_`, which `ilike` treats as a
  single-character wildcard. The escape moved into `fuel_search_escape` (escaping `\` first, then `%`,
  then `_`) and a `C_001` case was added.
- **`clear` counted independently** — every fixture row had `gallons > 0`, so a `clear` counted as
  `has_anomaly is false and gallons > 0` was indistinguishable from the complement. A zero-gallon
  unflagged fill was added, which is what makes `flagged + clear = fills` an assertion.

**One fixture that could not exist:** `has_anomaly` is NOT NULL, so 0289's `coalesce(has_anomaly, false)`
can never fire. It is kept as a statement of intent and the matrix says so rather than inserting a null
the database would reject.

#### — T3a MERGE 2 of 2 SHIPPED 2026-09-02 (`claude/fuel-range-totals-reader`). **T3a is DONE. T3b remains.**

**What shipped.** `useFuelRangeTotals` now takes `fillUps`, `totalGallons`, `totalCost`, `hasCost`,
`flagged` and `clear` from one `fuel_range_totals` call. Those four tiles no longer depend on the paging
loop finishing, so no `max_rows` change can make them read low.

**What deliberately did NOT move, and this is the step's substance.** Fleet MPG and total miles still
page and are still derived in TypeScript. Both carry judgement — the MPG plausibility band, and
`robustWindowMiles` returning null rather than 0 for a non-advancing window — and D-AG1's ruling is that
judgement stays where a unit test can reach it. **They therefore still depend on the loop finishing, and
that limitation is now stated in the code rather than implied.** FUEL-T3b is the spike that asks whether
a per-vehicle odometer aggregate could feed them without copying a constant into SQL, and is allowed to
conclude that it cannot.

**One sanitiser, one term, two callers.** `searchTerm()` is extracted and used by both `searchOr` (the
list's PostgREST `.or()` grammar) and the RPC call. The RPC does not need the strip — 0289 escapes
server-side — but it must be given the SAME string, or a search containing `%,()` would count a
different set than the rows beneath it. That is the disagreement T3a exists to end, so it is asserted.

**Held until the function existed in production.** `select proname from pg_proc` was checked before
merging, exactly as #448 did for its column.

**Verified by:** `fuelRangeTotals.test.ts` (7) — `takes fills, gallons, spend, flagged and clear from
the RPC, not from the paged rows`; `still derives miles and fleet MPG in TypeScript, from the rows —
D-AG1`; `passes every filter the list uses, so the tiles and the rows describe one set`; `sanitises the
search term the same way the list does`; `surfaces an RPC failure instead of rendering zeros`. Proved
able to fail by five mutations: taking `fills` from the loop again; handing the RPC the raw search term;
swallowing the RPC error; dropping the tank-type filter; and deriving miles from the RPC.

**One existing suite this changed, and why it is not a weakened test.** `fuelWindow.test.ts` mocked
`supabase` with no `rpc`, so the totals query threw before it filtered anything and the suite reported
the change as a windowing regression it was not. Its assertion — *the tiles window on exactly the same
column as the rows beneath them* — now checks BOTH halves: the RPC's `p_from`/`p_to` arguments and the
loop's `business_date` filters. The property is unchanged; there are simply two mechanisms to hold to it
now.

#### — T3b SPIKE ANSWERED 2026-09-02 (`claude/fuel-miles-mpg-spike`). **The seam CAN be drawn.** Implementation remains.

The question was whether SQL can feed `robustWindowMiles` and the MPG band **without copying a constant
into SQL**. It can, and the finding is one sentence: **make SQL return a MEASUREMENT rather than a
VERDICT, and the constant never has to cross the boundary.**

| The judgement | What SQL returns instead | Who compares |
|---|---|---|
| `span > MIN_WINDOW_ADVANCE_MI` | the span | TypeScript |
| `obd.length >= 2` | the count | TypeScript |
| monotonic within ±1 (`v >= prev - 1`) | **the worst backward step**, `min(v - lag(v))` | TypeScript |
| `MPG_PLAUSIBLE_MIN/MAX` band | Σ(mpg·gallons) and Σ(gallons), **band passed in as parameters** | TypeScript owns the value |

**The third row is the whole finding.** "Is this sequence monotonic within one mile" looks like it needs
the tolerance in SQL. It does not: the largest backward step is a plain window aggregate with no
threshold in it, and TypeScript then asks whether that step is inside its own tolerance.

For MPG the band travels as an **argument**, which is the opposite of a copy — there is still exactly
one definition, in TypeScript, and SQL follows it automatically if it changes. A parameter with no
DEFAULT cannot drift; a literal in a function body can.

**What shipped:** `windowMilesFromAggregate` + `aggregateWindowOdo` in `@silvicom/shared`, and
`aggregateWindowOdo` doubles as an **executable statement of exactly what the SQL must compute** — the
matrix for the eventual RPC asserts against it rather than against prose.

**Verified by:** `windowMilesAggregate.test.ts` (25) — twenty enumerated row shapes covering every
branch (`two OBD readings that do NOT advance — null, never 0`; `entered with a backward step exactly at
the tolerance`; `OBD did not move but entered did — OBD still decides, and suppresses`; …) plus
`agrees on 4,096 generated sequences`, a deterministic sweep over odometer patterns rather than a
sample. Proved able to fail by six mutations: returning 0 instead of null for a non-advancing OBD span;
falling through to entered when OBD says the truck did not move; dropping the backward-step tolerance;
`>=` instead of `>` on the advance threshold; not clamping the worst step; and counting non-OBD readings
as OBD. Each broke between one and three assertions.

**⚠ NOT YET DONE, and T3b stays open for it:** the RPC itself, and the reader. The seam is drawn and
proven; nothing is calling it. The remaining work is a per-vehicle aggregate function returning the six
measurements above, a matrix asserting it against `aggregateWindowOdo`, and the reader swap — **two
merges**, because a new FUNCTION is invisible to `lint:migration-ordering` and would 404 for the ~9
minutes of the deploy window (see T3a merge 1).

#### — T3b MERGE 1 of 2 SHIPPED 2026-09-02 (`claude/fuel-miles-mpg-rpc`). T3b is OPEN until the reader lands.

**What shipped.** Migration **0290**, `fuel_range_miles_inputs(...)`: per-truck `obd_count/min/max`,
`entered_count/min/max`, `entered_worst_step`, and banded `mpg_weighted` / `mpg_gallons`. Nothing calls
it yet. **`p_mpg_min` / `p_mpg_max` have no DEFAULT**, so the band cannot exist as a second definition
here — it arrives from `packages/shared/src/dashboard.ts` at call time.

**The matrix asserts against the imported TypeScript, not against a restatement of it.** CI builds
`packages/shared/dist` before `pnpm test` (ci.yml step 48), so
`supabase/tests/fuel-range-miles-inputs.test.mjs` imports the real `aggregateWindowOdo` and
`windowMilesFromAggregate` and compares the SQL to them truck by truck. A hand-written expectation would
drift from the TypeScript the day somebody edited it, which is the exact failure D-AG1 exists to prevent.

**⚠ AND THAT IMMEDIATELY FOUND A REAL BUG IN THE SQL. Postgres `LEAST` IGNORES NULLS.** The obvious
`least(min(step), 0)` returns **0** for a truck with a single reading — i.e. "never went backwards" —
where the specification returns null, because there is no step to measure. A restated expectation would
almost certainly have restated the same mistake. Fixed with an explicit null guard, and the reason is
written above the line.

**The null-vehicle group is deliberately kept.** Fleet MPG counts fills attributed to no truck — the
browser loop's `if (!r.vehicle_id) continue` sits *after* its MPG accumulation — so dropping that group
would quietly change one figure while looking like a tidy-up. TypeScript sums MPG across every row and
miles across only the rows naming a truck.

**Verified by:** `fuel-range-miles-inputs.test.mjs` — 13 assertions, `RESULT` line, including `the SQL
aggregate equals aggregateWindowOdo for all 9 branch shapes — asserted against the imported function,
not a restatement of it`; `a 100-mile backward entry is REPORTED as -100, not judged here`; `a fill with
no odometer neither manufactures a step nor breaks the chain across itself`; `a 64-mpg fill is excluded
from the numerator AND the denominator`; `fills attributed to no truck get their own row`. Proved able
to fail by six mutations: judging monotonicity in SQL; `LEAST` without the null guard; stepping over all
rows rather than non-null ones; dropping the null-vehicle group; letting the band dilute instead of
filter; counting non-OBD readings as OBD.

#### — T3b MERGE 2 of 2 SHIPPED 2026-09-02 (`claude/fuel-miles-mpg-reader`). **T3b is DONE, and so is T3.**

**What shipped.** `useFuelRangeTotals` calls `fuel_range_miles_inputs` with the band from
`@silvicom/shared` and runs `windowMilesFromAggregate` over the returned measurements. **The paging loop
is gone.** Every tile on the Fuel Log is now independent of how many fills there are — which is what
T3a set out to do and could only half-finish.

**The judgement did not move.** `robustWindowMiles`'s preference order, its ±1 tolerance and its
null-not-zero guard, and the MPG plausibility band, are all still in TypeScript. SQL returns spans,
counts and the worst backward step; TypeScript decides what they mean.

**⚠ One assertion was DELETED rather than kept, and this is the honest half of the step.** A test that
"a non-advancing span is suppressed rather than counted as 0 miles" **cannot fail at this layer**: the
composable SUMS, and `null ?? 0` and `0` both contribute nothing. The guard is real and important — a
0-mile window makes the over-fuel `burnable` 0 and every purchase clears the ceiling — but its effect is
**unobservable in a fleet total**. Keeping the assertion would have been a test that passes whether the
guard exists or not. It is removed, the reason is written where it was, and the guard stays pinned in
`windowMilesAggregate.test.ts` against `robustWindowMiles` itself, where it is falsifiable.

**Verified by:** `fuelRangeTotals.test.ts` (11) and `fuelWindow.test.ts` (4). Named cases include
`asks the database for both functions, and never pages fuel_transactions itself`; `sends the
plausibility band as an argument, so SQL never holds a copy of it`; `refuses the entered span when it
steps back further than the tolerance`; `counts an unattributed fill toward fleet MPG and toward no
truck's miles`; `surfaces a failure of the MILES call too, not just the totals one`.

**Proved able to fail by four mutations:** reversing the loop's order so unattributed fills miss MPG;
hardcoding the band instead of sending the shared constant; forgetting the search term on the miles
call; swallowing the miles RPC error. ⚠ **That last one initially passed** — `fuel_range_totals` runs
first, so a shared error fixture never reached the miles call and a swallowed error there would have
gone unnoticed. It has its own fixture now.

---

### T4 · The Trailer column comes off the Fuel Log

**Prerequisites:** none.

**Build.** Remove the column (D-FUI14). `duty_equipment_segments` is empty and
`trailers.assigned_vehicle_id` is current-state, so there is nothing correct to render. Current pairing
stays on the vehicle and reefer-coverage surfaces, where it is already labelled as current.

**Done when.** No historical row in the section carries a live fact without saying so.

**⚠ This is a deliberate capability removal and needs Q-FUI8 acknowledged, not answered** — if the owner
wants trailer-at-fill, that is a new time-ranged pairing table and a source to fill it, which is its own
plan and not this one.

#### — DONE 2026-09-02 (`claude/fuel-trailer-column`), on Q-FUI8's stated fallback.

**Premise re-measured in production before acting on it**, per the handoff's rule about this plan's own
numbers: `duty_equipment_segments` is **still 0 rows**, and **157 of 211** trailers carry a
`assigned_vehicle_id`. So the column was not stale or approximate — it rendered TODAY's pairing beside a
fill from months ago, for three quarters of the fleet, with nothing on screen saying so.

**What shipped.** The column, its cell template, the `trailerForVehicle` helper and the
`useTrailersQuery` call are gone from `FuelLogPage.vue`. Removed, **not relabelled** — a caveat under a
wrong number is a workaround with a caveat (D-FUI14). Current pairing is untouched on the vehicle and
reefer-coverage surfaces, where it is already labelled as current and is true.

**A removal leaves nothing behind to notice, so it is pinned by a test.** Re-adding the column is one
line of a column array plus a helper that still reads perfectly plausibly — a two-minute change that
looks like an improvement. `FuelLogPage.test.ts` now mounts the page and asserts the header is absent,
that the currently-paired unit number appears nowhere against a historical fill, and that the trailer
roster is **not even queried**. Someone restoring it has to argue with Q-FUI8 rather than reverse it
quietly.

**⚠ Two vacuous-pass traps hit while writing that test, both worth knowing about for any future
page-mount suite in this app:**
- `DataTable` swaps to a card layout below 768px and jsdom reports no `matchMedia` at all, so the table
  rendered as cards, `findAll("th")` returned `[]`, and *"the headers do not include Trailer"* passed
  because there were no headers. `useMediaQuery` is stubbed to the desktop breakpoint, and the test
  additionally asserts the columns that DO belong are present, so an empty render cannot pass again.
- The trailer-roster spy was a module-level `const` referenced inside a hoisted `vi.mock` factory. That
  throws `Cannot access before initialization` — but only when the mock is actually loaded, i.e.
  **exactly when someone re-adds the import**. The regression would have surfaced as a broken-looking
  test rather than a named failure. It is a `vi.hoisted` binding now.

**Verified by:** `FuelLogPage.test.ts` — `shows no Trailer column header`; `never renders the
currently-paired trailer against a historical fill`; `does not even ask for the trailer roster — the
capability is removed, not hidden`. Proved able to fail by two mutations: re-adding the column
definition alone (1 of 3 fails), and re-adding the roster query and cell template (all 3 fail). Gates
green: `pnpm test`, `typecheck`, `lint`, `build`, `lint:ui-adoption`, `lint:ui-contrast`,
`lint:tokens-parity`, `lint:boundaries`, `lint:filesize`, `lint:funcsize`, `lint:capabilities`,
`lint:tests`, `lint:comment-claims`, and `pnpm --filter web lint:tokens`.

---

### T5 · Say what is measured, on every surface

**Prerequisites:** T1, T3.

**Build.** Fuel Spend's coverage line and IFTA's health gate are the pattern; generalise them.
- Fuel Spend and the spend PDF print the **oldest `fuel_spend_days.updated_at` in the window** —
  "figures rebuilt N days ago" (A6).
- Fuel Log, Transactions, Rejections and Cards each carry one line: rows in window, share attributed to
  a vehicle, and last feed poll — the last from `posted_last_polled_at` / `rejected_last_polled_at`
  (verified present in the schema) and the `jobs` ledger, not from a new column.
- The strip renders **above** the figures it qualifies, per IFTA's argument, not in a footnote.

**Done when.** No figure in the section reads as a claim about everything without saying what it covers.

#### — FIRST BULLET SHIPPED 2026-09-02 (`claude/fuel-spend-freshness`). ~~T5 stays OPEN for the other two.~~
#### ⇒ **T5 CLOSED 2026-09-02.** All three bullets shipped across five PRs; the last note in this step is the summary.

**What shipped.** `describeRollupFreshness` in `@silvicom/shared`, and both spend surfaces print from
it: a line above the tabs on Fuel Reconciliation, and a **"Figures built"** row on the spend PDF's
letterhead. A6 / D-FUI18 closed.

**Why the OLDEST build in the window, not the newest.** A window straddling the 14-day rebuild boundary
holds rows built last night AND rows built in August. The newest would describe the freshest corner of
the answer and flatter the rest; the average would describe nothing that exists. **Only the oldest is a
promise** — every figure here is at least this current. Same argument `readSamsaraWebhookStatus` makes
about an all-time denominator.

**One derivation, two surfaces, on purpose.** `fuelSpendReport.ts` already carries a scar about exactly
this: its price-line query drifted from the screen's, so the document said "no fill could be matched to
a posted price" while the page beside it measured 1,201 of them. Both now call one pure function.

**Only the warning form is toned.** A rebuild that happened yesterday is context, not an alert; touching
every freshness line with the caution colour is how a caution colour stops meaning anything.

**Two things deliberately NOT done.** The rebuild policy itself is untouched — A6 is a labelling fix and
whether `REBUILD_DAYS` should change is **Q-FUI9**, the owner's. And `oldestBuildAt`, written as a fold
helper, was **deleted before merge**: the query does the ordering (`order by updated_at asc limit 1`),
so it was tested-but-unused code, which is the dead-code smell this plan complains about elsewhere.

**Verified by:** `rollupFreshness.test.ts` (7) — `changes what it says, not just the number, once the
build predates the rebuild window`; `keeps the warning in the compact form the PDF's meta block prints`;
`floors the age rather than rounding it`; `never reports a negative age when a row was built in the
future`. `useSpendFreshness.test.ts` (7) — `takes the OLDEST build in the window, not the newest`;
`narrows with the truck filter`; `asks about the whole fleet when no truck is chosen, rather than about
none of it`. `fuelSpendReport.test.ts` (+4) and `FuelReconciliationPage.test.ts` (+3).

**Proved able to fail by fourteen mutations** across the four layers, each breaking one to two
assertions: `>=` for the stale threshold; rounding the age; dropping the warning from the compact form;
allowing a negative age; the PDF asking for the newest build, ignoring the truck filter, or windowing on
nothing; the web query taking the newest, ignoring the truck filter, dropping the day window, or
narrowing to no trucks when the fleet is unfiltered; the page never rendering the line, toning every
line as caution, or never toning a stale one.

**⚠ The PDF's rendered sentence CANNOT be asserted** — pdfkit compresses its content streams, which is
why that suite pins queries and page counts rather than glyphs. What is pinned there is that the
document asks the right question of the right rows; the wording is pinned in `packages/shared`.

#### — SECOND BULLET, FEED HALF, SHIPPED 2026-09-02 (`claude/fuel-feed-freshness`). T5 stays OPEN.

**What shipped.** `describeFeedFreshness` in `@silvicom/shared`, `GET /api/fueling/feed-freshness`, and
a `FeedFreshnessLine` above the filters on **Transactions** and **Rejections**. Those two pages render
EFS's own rows verbatim, so neither can show a WRONG row — only a missing one, and a stopped poller
reads exactly like a quiet week.

**⚠ THE PLAN NAMED THE WRONG COLUMN, and using it would have produced the confident lie this step
exists to remove.** T5 says the poll time comes "from `posted_last_polled_at` / `rejected_last_polled_at`".
`recordFeedFailure` stamps those **on failure too**, alongside the error text; only `recordFeedSuccess`
sets `*_last_success_at` and clears `*_last_error`. So a feed EFS has refused for two days still carries
a poll stamp from three minutes ago, and a line built on it would read *"purchases last arrived 3
minutes ago"* while nothing had arrived at all. **The SUCCESS stamp is the source**; the poll stamp is
used only to tell one state from another.

**Three states, because they need three different actions** — never collected (unconfigured; waiting
achieves nothing), running but refused (a credential or certificate, which no "last seen" timestamp can
express), and late (may resolve itself). A fourth, *polled with nothing to send*, is explicitly NOT an
alarm.

**"Late" is a multiple of each feed's own promised cadence**, read from `EFS_SOAP_POSTED_POLL_MINUTES`
(15) and `EFS_SOAP_REJECTED_POLL_MINUTES` (5) — measured from `efsSoapPoller.ts`, not from this plan. A
fixed hour would call the rejected feed healthy after twelve missed passes.

**Not the admin route, and nothing extra crosses the boundary.** `/efs-soap/config` is
`requireRole("admin")` and returns endpoint, username, TLS metadata and cursors. This is
`requireSection("fuel", "view")` — the reader of a short list is exactly who needs to know why it is
short — and it returns two sentences and four timestamps. **The vendor error text is reduced to a
boolean at the handler**: it can name a username or a certificate subject, and "it is refused" is the
whole of what a fuel reader can act on.

**Verified by:** `feedFreshness.test.ts` in `packages/shared` (11) — `reads the SUCCESS stamp, never the
poll stamp — a failing feed is polled constantly`; `calls a refused feed FAILING rather than late — one
needs a fix, the other needs patience`; `separates 'the vendor had nothing to send' from 'we never
asked'`; `scales 'late' to each feed's own cadence`. In `apps/api` (8) — `refuses a driver, who is the
subject of this data rather than its reader`; `never leaks the vendor error text, the endpoint, or a
cursor`; `selects only the six freshness columns`. In `apps/web` (5).

**Proved able to fail by twelve mutations.** ⚠ **Two initially passed, and both were leak assertions
that could not fail** — the deny-list on the select string passes for `select("*")` (the string `"*"`
contains none of the forbidden names while fetching all of them), and the "no vendor text" check could
not fail because `FeedFreshness` has no error field to leak through. The first is now an ALLOW-LIST on
the exact six columns; the second also asserts the response's key set, so a future field carrying vendor
text fails here rather than in production.

**⚠ ~~STILL NOT DONE, and T5 stays open for it~~ — CLOSED 2026-09-02, see the two notes below:** *share attributed to a vehicle* on all four pages, and
the Fuel Log's line entirely. Both need a window-wide aggregate — `fuel_range_totals` (0289) returns
`fills` but not "fills naming a truck", and Transactions/Rejections key on a text `unit` rather than a
`vehicle_id` — so both need a migration. Deferred deliberately while the permissions work is claiming
migration numbers. ~~And the **Cards** page's third fact is still under-specified.~~ **Q-FUI14 answered 2026-09-02: Cards drops the attribution fact entirely** — there is no denominator on that page — so it carries rows-in-window and last-feed-poll only.

#### — SECOND BULLET, ATTRIBUTION HALF, SHIPPED 2026-09-02 for Transactions, Rejections and Cards (`claude/fuel-row-coverage`). T5 stays OPEN for the Fuel Log.

**What shipped.** `describeRowCoverage` in `@silvicom/shared`, `useEfsRowCoverage` beside the two list
queries, and a `RowCoverageLine` under each page's freshness line. Cards took the Q-FUI14 shape
instead: no attribution fact, and the poll time it already computed now always renders.

**⚠ THE PLAN SAID BOTH RAW-FEED PAGES NEED A MIGRATION. ONE OF THEM ALREADY HAD THE COLUMN.**
T5's own note says Transactions and Rejections "key on a text `unit` rather than a `vehicle_id`, so
both need a migration". That is true of `efs_transactions` and **false of `declined_transactions`**,
which has carried `vehicle_id` since its scoring work. Measured in production 2026-09-02: 2,749
declines carry one, and they are exactly the 2,749 whose `unit` matches a vehicle. The column already
IS the attribution fact, so Rejections needed no schema change at all — and neither did Transactions,
for a different reason below. **Segment D's migration is now needed by the Fuel Log alone.**

**Why Transactions matches against the fleet's unit numbers instead of a new SQL function.** The
alternative was a `fuel_range_totals`-shaped aggregate for `efs_transactions`, which would have
restated seven filters in a second language beside the seven the list already applies. That is the
drift `fuelSpendReport.ts` carries a scar about — its price-line query diverged from the screen's and
the document contradicted the page beside it. Instead `applyEfsTxnFilters` / `applyDeclinedFilters`
were extracted and BOTH counts go through them, so the caveat cannot describe a different set than the
rows under it. It is the argument `searchTerm` makes in `useFuelLog` — one definition, two callers —
one level up. The unit list is derived from `vehicles`, the same query that fills the page's Unit
filter, never written down.

**Both counts are issued together, and the denominator is NOT the list query's `total`.** Two queries
with independent cache lifetimes can be one poll apart, and "28,300 of 28,620" quietly becomes
"28,300 of 28,041" with no error anywhere.

**The share is FLOORED.** 1,204 of 1,205 rounds to 100%, and a complete-looking share beside a row
that is not covered is the confident lie this whole step exists to remove.

**Never toned.** An incomplete attribution share is the normal state of this carrier's data, so a
caution colour here would be permanently lit — and `FeedFreshnessLine` needs that colour to still mean
"the feed has stopped". Whether some threshold of unattributed rows deserves an alarm is a detection
question with an owner, not a colour choice.

**Measured in production 2026-09-02, and one of the three is not small:**

| List | Rows | Naming a truck | Not |
|---|---|---|---|
| `efs_transactions` | 28,620 | 28,281 | **339** — 283 carry no unit at all, 56 carry a unit naming no truck |
| `declined_transactions` | 3,445 | 2,749 | **696 — one decline in five**, on the page whose whole job is a fraud signal |
| `fuel_transactions` (canonical, for the Fuel Log half still to come) | 14,868 | 14,568 | **300** |

⚠ **The 283 unit-less EFS lines are NOT the fee/DEF/footer rows one would guess.** By `item` they are
ULSR (137), ULSD (117) and DEFD (29) — real fuel purchases EFS printed with an empty unit column. The
guess was made while writing the comment and the measurement contradicted it, which is the only reason
the comment is right.

**Verified by:** `rowCoverage.test.ts` in `packages/shared` (10) — `floors the share rather than
rounding it, so a complete-looking percentage means a complete set`; `changes what it says, not just
the number, when every row names a truck`; `clamps a count read mid-write rather than printing a share
above 100%`; `gives a single unattributed row its own clause instead of 'The other 1 declines are'`.
`efsRowCoverage.test.ts` (7) — `puts every filter on BOTH counts, so the share describes the rows on
screen`; `does not count at all until the fleet's unit numbers have arrived`; `reads the declines' own
vehicle_id rather than matching unit text, and needs no fleet list`. `RowCoverageLine.test.ts` (4) —
`never takes the caution colour, however incomplete the attribution is`. `fuelCoverageLine.test.ts`
(3) — `puts the line on Rejections and asks about the declines, not the purchases`.
`fuelCardsFreshness.test.ts` (2) — `says when it last checked even when the sweep is on time`.

**Proved able to fail by twenty-one mutations** across the five layers: rounding the share, dropping
the clamp, un-flooring a fractional row count, un-grouping the thousands, removing the empty-list
guard, printing the percentage form for a complete list, pluralising the single-row clause, dropping
the singular noun, swapping the two feeds' nouns; making the transactions count run with no fleet list, taking the attributed count off the
list's filters, giving Rejections the unit-list treatment, asking for rows rather than a head count,
applying the wrong table's filters, swapping numerator and denominator; deleting the line from either
page, moving it below the freshness line, pointing Rejections at the posted feed; and on Cards,
restoring the `stale`-only render and toning every form as caution.

⚠ **`useEfsRowCoverage`'s suite takes its query slice per CALL, not per test.** A host left mounted
keeps its vue-query subscription alive, and a refetch from an earlier case lands in the recorder after
`beforeEach` has cleared it. That produced an assertion about a date window reading a chain built by a
previous test's unfiltered query — a failure that looks like a bug in the code under test.

**⚠ ~~STILL NOT DONE, and T5 stays open for it~~ — CLOSED 2026-09-02, see the note below:** the **Fuel Log's line entirely** — rows in window,
share attributed, and the posted feed's last delivery. It is the only part that needs the migration
Segment D owns: `fuel_range_totals` (0289) returns `fills` but not "fills naming a truck", and
`create or replace` cannot change a `returns table` shape, so it is `drop function` + `create` in one
transaction. Two measurements that shape it, both taken 2026-09-02: every canonical fill is
`source = 'fuel_card'` (14,868 of 14,868), so the posted feed's freshness IS the Fuel Log's freshness
and no manual-entry caveat is owed; and no fill is unscored (0 of 14,868 with a null `case_level`,
including the 3,055 belonging to 46 imports whose `efs_processing_runs` row is still `running`), so
the Flagged tile needs no scoring-backlog caveat either. **That last one is a measurement, not a
guarantee** — it was checked because a stuck scoring stage would have made a freshness line on this
page the same confident lie the `*_last_polled_at` column would have been.

#### — THE MIGRATION FOR THE FUEL LOG HALF LANDED 2026-09-02 as `0297` (`claude/fuel-range-totals-attribution`). The READER IS HELD.

**What shipped.** `fuel_range_totals` returns a seventh column, `fills_with_vehicle`, counted over the
same `matched` CTE as the other six. Nothing else about the function changed — the body below the
select list is 0289's, reproduced unchanged so the two can be diffed.

**Why the Fuel Log needs this more than the raw-feed pages did.** Its six tiles do not all cover the
same fills, and never have. **Gallons, Spend and Total fill-ups count every matching row; Total miles
counts only the attributed ones** — `useFuelRangeTotals` skips a null `vehicle_id` outright, because
`windowMilesFromAggregate` measures a per-vehicle odometer span and there is no span without a
vehicle. Fleet MPG, deliberately, counts them all. Measured 2026-09-02: **300 of 14,868 canonical
fills — 2.0% — carry no `vehicle_id`**, which is 300 fills' worth of gallons and dollars inside the
totals and outside the mileage, and therefore fuel divided by miles nothing on the page can name.
Two tiles standing side by side already describe different sets and nothing says so.

**Drop and recreate, in one transaction.** `create or replace function` cannot change a
`returns table` shape — Postgres answers "cannot change return type of existing function". Dropped by
its full nine-argument list rather than by name, because an unqualified drop turns ambiguous the
moment anybody adds an overload. `supabase db push` runs a migration file inside a transaction, so no
session observes the function missing; the precedent is 0258, which did the same for three functions.

**⚠ THE READER MUST NOT SHIP UNTIL THIS IS APPLIED, AND NO GATE WILL SAY SO.**
`lint:migration-ordering` reads COLUMNS — it does not see functions. The deploy window serves a merge
about nine minutes before its schema arrives, so a reader merged alongside this would read `undefined`
and report that **no fill in the fleet names a truck**, which is precisely the confident lie T5 exists
to remove, printed at maximum confidence. The check before merging the reader is by hand:

```
supabase db query --linked "select p.proname, pg_get_function_result(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'fuel_range_totals';"
```

…and `fills_with_vehicle` must appear in the result before the reader PR is merged.

**Landing the migration first costs nothing.** The only caller destructures the fields it wants by
NAME off a PostgREST JSON object, so an extra key is ignored and the currently-deployed build behaves
identically against the new function.

**D-AG1 holds: this sums, it does not derive.** Counting rows whose `vehicle_id` is not null has no
threshold, band or fallback in it — the same class of figure as `flagged`, `clear` and `has_cost`, and
not the class of Fleet MPG or `robustWindowMiles`, which stay in TypeScript. `vehicle_id is not null`
needs no join: the column is a foreign key to `vehicles` with `on delete restrict`, so a non-null
value cannot name a truck that is not there.

**Verified by:** the `fuel-range-totals` matrix, 19 assertions to 25 — `fills_with_vehicle equals
fills while every row names a truck`; `a fill with no truck raises fills and leaves fills_with_vehicle
where it was`; `scoped to one truck, every counted fill is attributed — the numerator lives inside the
filters`; `an empty window reports zero attributed fills rather than null`; `the attributed count
reaches the browser's call, and is a strict subset once unattributed fills exist`.

**Proved able to fail by four mutations of the one new expression**, each breaking a different
assertion: counting every row (the filter never fires) — 3 failures; inverting the predicate — 4;
counting the FLEET instead of the rows on screen — 2, one of them the per-truck scope; and
`sum(case ...)`, which is NULL rather than 0 over no rows — 1. That last one is why the empty-window
assertion exists at all: the difference only shows on a window with nothing in it.

⚠ **`fills_with_vehicle` is appended LAST in the `returns table`.** PostgREST hands the browser named
keys so position is nothing to it, but the matrix and any future positional reader get the columns
they already knew, in the order they already knew them.

#### — T5 IS DONE. The Fuel Log's line shipped 2026-09-02 (`claude/fuel-log-coverage-line`), one merge behind 0297.

**What shipped.** `describeRowCoverage` gained a `fuelLog` surface, `useFuelRangeTotals` returns
`fillsWithVehicle`, and the page carries `FeedFreshnessLine feed="posted"` and `RowCoverageLine` above
its filters — the same two lines, in the same order, as Transactions and Rejections. **All four fuel
lists now say what they cover, and T5's Done-when is met.**

**The Fuel Log's consequence clause is not a rewording of the other two, and that is the point.** The
raw-feed pages say the unattributed rows are *"absent from any figure counted per truck"*, which is
the whole truth there. Here the reader can check the claim against tiles two inches below, so the
sentence names them: the unattributed fills are *"counted in the gallons and the spend above, and in
none of the miles"*. A consistent generic clause would have been consistent and would have described
nothing — which is the failure mode this plan's thesis is about.

**The feed line is `posted`, and that is a measurement rather than an assumption.** Every canonical
fill in this carrier's data is `source = 'fuel_card'` — 14,868 of 14,868, measured 2026-09-02 — so
there is no manual-entry population whose freshness the posted feed would fail to describe. If that
stops being true the line needs a second clause, not a different column. The scoring stage was checked
for the same reason and needs no caveat either: 0 of 14,868 fills carry a null `case_level`, including
the 3,055 belonging to 46 imports whose `efs_processing_runs` row has been stuck at `running` since
2026-08-09.

**⚠ THE HAND-CHECKED ORDERING IS NOW BELT AND BRACES, NOT THE ONLY THING BETWEEN US AND A LIE.**
`fillsWithVehicle` is `number | null`, and `?? 0` is deliberately NOT written anywhere on its path.
It is the one field on that object whose absence and whose zero mean opposite things: 0 is "not one
fill in this window names a truck", which is alarming for a fleet and false for a deploy window.
A reader that reached production ahead of its schema now renders NOTHING — which is what the page said
before this existed — instead of "0% of the 14,868 fill-ups in this list name a truck". A genuine
zero still passes through as zero, because an org whose fills name no truck is a real answer.

**⚠ A DEFECT IN `FeedFreshnessLine` THAT SHIPPED WITH #481, FOUND BY MOUNTING IT HERE.** `apiFetch`
returns `{ ok: false }` for an HTTP error but does not wrap the `fetch` call itself, so a TRANSPORT
failure — offline, DNS, a dropped connection — rejects. In an async `onMounted` with no catch that is
an unhandled promise rejection, which is the one outcome that component's design rules out: it exists
to say nothing when it cannot read. Transactions and Rejections have no tests, so it had been silently
possible since it shipped; `FuelLogPage.test.ts` does not stub the API and made it visible immediately.
Fixed here.

⚠ **That test's first form could not have failed.** The RENDER is identical whether the rejection is
caught or not — nothing is shown either way — so an assertion on `html()` alone passes with the catch
deleted. The assertion is on a `process.on("unhandledRejection")` listener instead, because what
differs is whether the rejection escapes, and confirmed by mutation.

**Verified by:** `rowCoverage.test.ts` (11) — `tells the Fuel Log's reader which tiles the unattributed
fills are in and which they are not`. `fuelRangeTotals.test.ts` (13) — `reports NULL, never 0, when the
function has not got its 0297 column yet`; `passes a genuine zero through as zero — an org whose fills
name no truck is a real answer`. `fuelCoverageLine.test.ts` (6) — `puts both lines on the Fuel Log,
whose tiles are the figures they qualify`; `says nothing on the Fuel Log while the function has no
attributed count to give`; `gives the Fuel Log its own consequence clause, not the raw-feed pages'`.
`FeedFreshnessLine.test.ts` (6) — `says nothing when the request never completes at all, and lets no
rejection escape the page`.

**Proved able to fail by eleven mutations:** collapsing the null to 0 and treating a genuine 0 as
absent, on the composable; reading `fills` as the numerator; deleting the line from the page, pointing
its feed at `rejected`, and dropping the null guard so a missing column renders as 0%; naming the page
`transactions` so it takes the wrong clause; giving the Fuel Log the raw-feed clause, the raw-feed
pages the Fuel Log's, and the Fuel Log the wrong noun; and letting the freshness rejection escape.

---

## Phase P — parity

### P1 · Multi-select, and facets that come from the data

**Prerequisites:** T1.

**Build.** `FilterSelect multiple` for trucks on Fuel Log, Transactions, Rejections and Alerts;
`.eq()` becomes `.in()`. Add a **units facet to `useEfsFacets`** derived from `efs_transactions.unit`,
replacing the list built from `vehicles.unit_number` — the 4 units in §0.3 with no vehicle row are
currently unfilterable while their rows still appear (D-FUI16).

**Done when.** Every fuel list can be scoped to a set of trucks, and no filter list is narrower than the
data behind it.

---

### P2 · A scoped export on every list page

**Prerequisites:** T1, T3, P1.

**Build.** To the `spend-report.pdf` standard and no other (D-FUI15): server-rendered from the same pure
functions the screen uses, filters honoured, UUID lists validated before reaching a service-role query,
one audit row per export, and `ReportExportButton`'s scope line printed on the artefact itself so a file
that outlives its download says what it covers. CSV for the row-level pulls, PDF where a document is
being sent to somebody.

**Done when.** "Truck 654's fuel for August, as a file" is answerable from Fuel Log, Transactions,
Rejections, Cards and the ledger.

**Verified by.** Per-route export tests asserting the artefact's totals equal the screen's for the same
filters — the property that makes an export quotable months later; `expectOrgScoped`; an audit-row
assertion per route.

---

### P3 · The ledger can be scoped to a truck

**Prerequisites:** P2.

**Build.** Close A3 at both ends: `vehicleIds` in `ExceptionQuery` and `qs()`, a validated `vehicles`
parameter on `/api/fueling/exceptions` and `/totals`, and the truck control on the page. The API already
accepts `assignedTo` that the page never sends — wire that too, since C7 needs it.

**Done when.** `?trucks=` either scopes the ledger or is absent from its URL. Nothing is accepted,
preserved and ignored.

---

## Phase C — consolidation

### C1 · Delete the dead page, and say what Import is for

No merges, no routes moved — the cheapest possible first PR, and it makes the next four smaller.

**Build.**
- Delete `apps/web/src/pages/FuelEventsPage.vue` (§0.2 fact 2). The `/fuel-events` redirect stays.
- On the Import page's EFS tab, replace the copy that implies uploading is the normal path with what is
  actually true: the SOAP poller ingests continuously, and this is the backfill path for a gap or a
  period the feed never carried.

**Done when.** The tree has no unreferenced page in the fuel section, and no reader is told to upload a
file the worker already has.

**Verified by.** `pnpm test`, `pnpm typecheck`, `pnpm lint`, route-table snapshot unchanged.

#### — DONE 2026-09-01 (PR #445, `claude/fuel-import-copy-and-dead-page`)

**What shipped.**
- `apps/web/src/pages/FuelEventsPage.vue` deleted. The `/fuel-events` redirect stays, per §3's rule
  that old paths are kept forever — and it is still load-bearing: the Samsara fuel-drop notification
  email links to it (`fuelEventsWebhook.ts`).
- Two now-stale entries removed from `GRANDFATHERED_ACCESS` in `scripts/check-table-access.mjs`
  (`declined_transactions` and `fuel_events` ← the deleted page). That ratchet is shrink-only and it
  fires on a dead entry, so the removal was not optional — proved by re-adding one entry and watching
  `lint:table-access` report *"stale grandfather entry (access site moved or died — ratchet down)"*.
- The Import page's EFS tab now opens with **"You do not normally need this"** and names its actual
  job — a gap, or a period predating the feed. The page header changed with it.

**Measured while doing it, and it is stronger than §0.2 fact 7 stated.** Fact 7 said the manual upload
"is now a backfill path, not the primary one". Production says it was never any path at all
(2026-09-01, `supabase db query --linked`): **all 28,484 `efs_transactions` rows carry
`imports.source = 'efs_feed'`** — zero manual uploads, ever — with the newest row an hour old
(2026-09-01 22:49 UTC) and 6,932 in the trailing 7 days. The acquisition cadences the new copy
describes are `EFS_SOAP_REJECTED_POLL_MINUTES` (5) and `EFS_SOAP_POSTED_POLL_MINUTES` (15) in
`efsSoapPoller.ts`.

**Verified by:** `pnpm test` (all suites incl. every PGlite matrix), `pnpm typecheck`, `pnpm lint`,
`pnpm build`, and the CI gate list run individually — `lint:table-access` and `lint:boundaries`
included, since those are the two the deletion moves. The route-table snapshot is unchanged, which is
the point: no route moved.

**Not done, deliberately.** No test was added for the new copy. C1's verification is the gate list
above, a mounted-page assertion on wording is brittle, and the reasoning is recorded in place as a
template comment in this repo's register instead.

---

### C2 · Fuel Log absorbs Transactions and Rejections

**Prerequisites:** C1, **T1** — three tabs under one date control with three date meanings is A1
shipped as a feature.

**Build.**
- `/fuel-log?tab=fills|declines|source`, one `AppTabs`, tab in the URL.
- **One filter bar, and the count is the count of what THIS tab shows** — X8's defect, generalised. The
  window and truck filter are shared; per-tab facets (item/state for source records, error code/policy
  for declines) render only on their own tab.
- Extract each tab body to `apps/web/src/features/fuel/` — `FillsTab.vue`, `DeclinesTab.vue`,
  `SourceRecordsTab.vue` — from the existing pages, not rewritten. `FuelLogPage.vue` ends as a shell
  under 200 lines.
- `/transactions` and `/rejections` become query-preserving redirects.
- Nav loses two items: Fuel drops to six.

**Done when.** Every filter, column and sort that worked on the three pages works on the three tabs; a
link to `/transactions?unit=654` lands on the source-records tab with unit 654 applied.

**Verified by.** Page tests mounting all three tabs (the three pages have none today — this is the
first time any of them is under test); both route-table snapshots updated; `nav.test.ts`;
`lint:filesize` on the extracted files.

#### — DONE 2026-09-02 (`claude/fuel-log-tabs`).

**What shipped.** `/fuel-log?tab=fills|declines|source`, one `AppTabs`, tab in the URL.
`FuelLogPage.vue` is a **143-line shell** — page header, the tab strip, and the one action that belongs
to the page rather than to a view of it (`Log fill-up`). The three bodies are
`features/fuel/{FillsTab,DeclinesTab,SourceRecordsTab}.vue` (396 / 408 / 228 lines), extracted from the
three pages rather than rewritten: every column, facet, sort, drawer and drill-down came across
unchanged. `TransactionsPage.vue` and `RejectionsPage.vue` are deleted; `/transactions` and
`/rejections` are **function** redirects that carry the query AND name the tab. Fuel is six nav items.

**One filter bar per tab, and that is the design rather than a shortcut.** C2 says "one filter bar, and
the count is the count of what THIS tab shows". A reader sees exactly one bar in exactly one place; it
is rendered by the tab, so the count beside the filters is structurally the count of the rows beneath
them. A bar in the shell would have to be TOLD each tab's count, which is X8 rebuilt — the fuel-spend
page's one shared count was the unfiltered fill total on four of its six tabs.

**What IS shared is the window and the truck**, in the URL, via `useFuelLogFilters` — called ONCE in
the shell and passed down, because `useQueryState` buffers per instance and two instances writing in
one tick is the lost-write it exists to prevent. The truck is a **unit number**, not a vehicle id:
`efs_transactions` and `declined_transactions` have no vehicle column, so the unit is the only key all
three tabs can express — and it is what the inherited links already carry, which is why
`/transactions?unit=654` lands on the source-records tab with 654 applied. `FillsTab` resolves it back
to a `vehicle_id` against the fleet it already loads (`unitFilter.ts`).

**⚠ A unit the fleet does not have narrows to nothing, not to everything.** Leaving `vehicleId`
undefined when the lookup fails would show the WHOLE fleet's fills under a bar reading "999" — the
confidently-wrong shape T5 spent five PRs removing. It resolves to the nil UUID instead, and the table
renders as loading while the fleet query is still in flight so the empty state cannot flash.

**⚠ THE MERGE WOULD HAVE WIDENED A PERMISSION, AND THIS IS THE PART TO READ.** `/transactions` and
`/rejections` were catalogued `section("fuel")`; `/fuel-log` is `always`. `recruiter` and `technician`
both carry `fuel: "none"` and both reach `/fuel-log` today, so absorbing the two pages without a check
would have handed them a fraud signal and 28,620 EFS lines on a screen they already had. The two
absorbed tabs render only for `canView("fuel")`, read from the same matrix the catalogue reads
(D-FUI12), and `?tab=declines` falls back to Fills for a caller who cannot see it. This is UI gating
only — both tables are org-scoped in RLS, not section-scoped — so it restores the boundary the merge
would have dissolved and does not invent one.

**Three modules moved, because `lint:boundaries` was right about the extraction.** Tab components under
`features/fuel/` may not reach into `features/reports/` or `features/fueling/`, and the gate's own
comment says to promote rather than allow-list. `useEfsData.ts` and `efsRowCoverage.test.ts` moved to
`features/fuel/` (the fuel section is now their only consumer — "reports" was where they lived when the
pages were called reports), and `useCardAssignments.ts` to `@/composables/`. `check-table-access.mjs`'s
two grandfathered entries were repathed, not added to.

**Also changed:** the Dashboard's "Declined attempts" tile now links to `/fuel-log?tab=declines` rather
than leaning on the compatibility redirect — the C9 check the segment handoff asked B's finisher to do.
The surface catalogue loses `fuel.transactions` and `fuel.rejections`; rows an org already wrote against
those keys in `org_role_surface_access` are inert by 0296's own design, so nothing had to be migrated.

**What C2 deliberately did NOT do.** Per-tab facets stay local rather than in the URL: `driver` is a
driver ID on Fills and a driver NAME on the two raw feeds, so one shared `?driver=` would carry a UUID
into a name filter and return an empty list with no error anywhere. **C3 is the step that makes each
tab's own facets survive a refresh, and it inherits a page where the window, the truck and the tab
already do.** D-FUI16's facet fix is likewise left for P1 rather than half-done here.

**Verified by:** `pages/FuelLogTabs.test.ts` — `opens on Fills, and names the three tabs`; `takes the
tab from the URL, so a link opens on what its sender was looking at`; `lands a stale or hand-edited tab
name on Fills rather than on nothing`; `counts what the open tab is showing, in that tab's own noun`;
`keeps every column each page had`; `hands the URL's truck to whichever tab is open, as a unit and as a
vehicle id`; `shows no fills for a truck this fleet does not have, rather than all of them`; `carries
the window and the truck across a tab switch`; `writes the tab back to the URL, so the view can be sent
to somebody`; `shows a role without the fuel section the Fills tab only, and no tab strip`; `refuses a
direct link to an absorbed tab, and lands on Fills instead of a blank page`; `still admits every role
that could open the two pages before the merge`. Plus `router/routeTable.test.ts` — `the absorbed fuel
pages redirect to their tab, carrying the filters they were sent with` — and both committed route
snapshots, the `navEquivalence` snapshots (22 updated, deletions only), `lib/nav.test.ts` and
`router/sectionGuard.test.ts`, whose fuel example moved from `/transactions` to `/fuel-cards`.
`features/fuel/fuelCoverageLine.test.ts` moved with the pages it mounted and kept its assertions,
which is the T5 handoff's prediction coming true: the lines took a `feed` prop and a plain `coverage`
object precisely so they could move to a tab unchanged.

**Proved able to fail — eight mutations, each naming the tests it broke:** the gate always passing (2);
dropping `$/gal` from Fills (1); DeclinesTab ignoring the shared window and truck (2); an unknown tab
falling back to Declines (1); the tab not written back to the URL (2); every tab counting in the same
noun (1); an unknown unit widening to the whole fleet (1); a hidden tab rendering anyway (7). Every one
of the twelve assertions failed under at least one mutation.

**Gates green — the full `ci.yml` list**, including the two that are not root `pnpm lint:*`
(`pnpm --filter ./apps/web lint:tokens`, `node scripts/check-migration-ordering.mjs` and its
`--self-test`): `pnpm lint`, `lint:boundaries`, `lint:capabilities`, `lint:chart-colors`,
`lint:cli-streams`, `lint:codegen`, `lint:comment-claims`, `lint:filesize`, `lint:funcsize`,
`lint:light-dark`, `lint:migrations`, `lint:secrets`, `lint:surfaces`, `lint:table-producers`,
`lint:table-writers`, `lint:tests`, `lint:token-schema`, `lint:tokens-parity`, `lint:ui-adoption`,
`lint:ui-contrast`, `lint:upserts`, `typecheck`, `build`, `test`. No migration in this step.

---

### C3 · Every fuel page becomes sendable

**Prerequisites:** C2 (so it is done once, on the merged page).

**Build.** Adopt the `useSpendFilters` pattern — the coalescing patch buffer included, for the reason
its own header records — on Fuel Log, Cards and Alerts. Alerts additionally **writes** `?vehicle=` back
rather than only seeding from it.

**Done when.** Every page in the section survives a refresh with its filters, and every one can be
pasted into a ticket.

**Verified by.** A test per page asserting round-trip through the query string, including the
two-`v-model`-in-one-tick case that welded the spend window to 90 days.

---

### C4 · Retire `/import`

**Prerequisites:** C2.

**Build.**
- EFS upload → `SlideOver` on Fuel Log, opened from the page header.
- Pilot price report + Pilot locations export + posted-price upload/fetch → **one** Upload drawer on
  Truck Stops (`PriceUploadCard` and `StationDataCard` move, unchanged).
- **Repair fuel data** → Settings → Data & Sync.
- `/import` becomes a redirect to `/fuel-log`. Nav drops to five in the Fuel group.

**Done when.** No upload capability is lost, and the section has no page whose title is a verb applied
to a file format.

**Verified by.** Upload tests move with their components; route-table and nav snapshots;
`lint:ui-adoption` on the two new drawers.

---

### C5 · Fuel Spend, eight tabs to three

**Prerequisites:** C4. **Must land before C6**, so the policy tabs are removed by the step that
replaces them rather than left doubled.

**Build.** `Spend & trend | Buy discipline | Statements`. Reconcile a file becomes an upload drawer on
Statements. Discount capture becomes a KPI on Spend & trend that drills into the fills behind it. The
three policy tab bodies are **kept in the tree, unmounted**, until C6 files their findings — a report
deleted before its replacement produces anything is a capability gap, however brief.

**Done when.** The page has three tabs and the coverage line still renders above all of them.

**Verified by.** The existing `spendTabs.test.ts` suite, extended for the drawer; route-table snapshot
(the `?tab=` values change).

---

### C6 · The policy detectors file findings

**Prerequisites:** C5, and **Q-FUI3 answered**. Blocked until then; the fallback is that C5 ships and
the policy views remain as unmounted code with an issue reference, which is a stated gap, not a
workaround.

**⚠ Re-read §0.3 before scheduling this.** `fuel_exceptions` has **0 rows** and `fuel_statements` has
**0 rows**, so the ledger's existing producers have never fired and cannot fire until somebody uploads a
statement. The policy producers built here read the EFS feed, which this carrier *does* have 14,796 rows
of. **C6 is therefore not an enhancement to a working ledger — it is the step that gives the ledger its
first row.** Its priority is higher than its position in this list suggests, and only Q-FUI3 holds it.

**Build.**
- A producer in `packages/shared/src/fuelSpend/` emitting `off_network_premium`,
  `avoided_state_premium`, `avoided_brand_premium` at the **grouping** Q-FUI3 fixes, with its own
  `POLICY_EXCEPTION_KINDS` close-scope constant beside it — never widening `RECON_EXCEPTION_KINDS`,
  per that constant's own comment.
- A deterministic fingerprint over the grouping key, so a re-run refreshes evidence and leaves status,
  owner and note alone (D-FX10).
- Wired into the same `sync_fuel_exceptions` path the reconciler uses.

**Done when.** A window that shows an off-network premium on the old tab produces findings totalling the
same money, and re-running the window twice does not reset a human's work.

**Verified by.** A PGlite matrix printing a `RESULT` line (the `fuel-exceptions` matrix pattern);
shared tests on the producer, the grouping and fingerprint stability; `lint:table-producers`,
`lint:upserts`, `lint:comment-claims`.

---

### C7 · One Findings inbox

Split in two along the seam the work has, exactly as F6 was.

**C7a — the mapping and the read contract.** *Prerequisites: C6.* A pure shared module holding (i) the
presented queue axis, (ii) a total map from each source's status onto it and back, and (iii) a single
read contract both producers satisfy, in which the close is a **discriminated union** — a disposition
for an anomaly, a money outcome for an exception — never a flattened enum. No screen. This is where
D-FUI7 is proven and it is the step that makes C7b small; it is useless to a reader on its own and that
is fine.

**⚠ C7 as a whole is gated on Q-FUI11 (was Q-FUI6, answered in part 2026-09-01) ahead of Q-FUI1.** §0.3 measures the anomaly feed at ~2.9%
precision (3 confirmed against 95 false positives, one rule). Joining that to the money ledger would
attach a 19-in-20 wrong queue to the identified/claimed/recovered figures that are supposed to prove the
product's worth, and would put the ledger's credibility inside the detector's error bar. **Fix or gate
the detector first; merging the inbox is the reward for a queue worth working, not the remedy for one
that is not.**

**C7b — the surface.** *Prerequisites: C7a, **Q-FUI6 answered**, and **Q-FUI1 answered**.* `/fuel-spend/exceptions` becomes
`/findings`, holding both sources, with per-kind write gating, assignment, aging, and bulk actions.
Blocked on the permission ruling: without it, the honest outcome is that C7a ships and the inbox does
not, and **that is the outcome to take** rather than placing the page where a capability check happens
to pass.

**Verified by.** C7a: shared tests over the full cross-product of `ANOMALY_STATUSES` ×
`FUEL_EXCEPTION_STATUSES`, asserting the round trip and asserting that the two mappings D-FUI7 names as
wrong are unrepresentable; plus a test that every `ANOMALY_DISPOSITIONS` value survives the read
contract intact. C7b: page tests per role from `SECTION_ACCESS`, `lint:section-policies`, both
snapshots.

---

### C8 · Targets beside the policy

**Prerequisites:** C6.

**Build.** Target thresholds (on-network share, discount capture, avoided-state gallons) added to
`route_fuel_settings` and surfaced on Settings → Planned Fueling beside the avoid-lists they qualify.
Every policy figure renders variance-to-target. **Two merges** — the column, then its first reader
(`lint:migration-ordering`).

**Done when.** No policy figure on the section renders as a bare count.

---

### C9 · The Dashboard's fuel strip earns its links

**Prerequisites:** C2, C7a.

**Build.** The five fuel tiles all link to `/fuel-log` today. Point each at the view that answers it,
and add open-findings and recovered-this-quarter beside them, from the ledger. No new page (D-FUI9).

---

## 6. Open questions register

| Id | Question | Owner | Fallback the code takes until answered |
|---|---|---|---|
| **Q-FUI1** | **Where does a fuel-card theft alert belong in the capability matrix?** `/anomalies` is gated `safety`, but an `accountant` and a `dispatcher` have `fuel: view`, `safety: none`. Merging Alerts into a Fuel-section inbox either shows theft cases to the bookkeeper or hides them from the safety manager. Candidates: **(a)** the inbox lives in Fuel and each finding kind carries its own section — a `safety`-kind row is filtered out for anyone without it (**recommended**: it is the only option that does not move a capability boundary to suit a screen); **(b)** move fuel-card anomalies from `safety` to `fuel` in `SECTION_ACCESS` — defensible, since a card-misuse alert is a fuel fact, but it is a real widening and needs saying out loud; **(c)** two inboxes stay. | Miki | **C7b does not ship.** C7a ships and the two inboxes remain. No page is placed where a permission check happens to pass. |
| **Q-FUI2** | **Does the merged Fuel Log stay `requiresAuth`?** Fuel Log is ungated today so drivers keep it; Transactions and Rejections need `canViewSection(role,"fuel")`. Per-tab gating is the obvious answer and needs confirming, because it means a driver sees a tab strip with one tab. | Miki | Per-tab gating, driver sees Fills only. Stated in the page header comment. |
| **Q-FUI3** | **What is the unit of work for a policy finding?** Inherited from `policyFindingsNote` via F6b, which shipped without answering it. Candidates: per truck × kind × month (**recommended** — matches how a fleet manager holds a conversation with a driver); per kind × month fleet-wide; per fill above a dollar threshold. | Miki | **C6 does not ship.** C5 ships and the policy views stay in the tree unmounted, with the gap stated. |
| **Q-FUI4** | Inherits **Q-FX8** from `FUEL-SPEND-RELIABILITY-PLAN.md` §6 — who owns a finding operationally. C7b needs a default assignee; the question is now blocking rather than theoretical. | Miki | `rolesThatManage("fuel")` writes; unassigned by default. No new role invented on a guess. |
| **Q-FUI5** | Should **Fuel Planning** and **Truck Stops** move from Dispatch into Fuel? They are fuel objects gated on `dispatch`. Moving them means either changing their gate or accepting a nav group whose items ask two different capability questions (Fleet already does this deliberately, and says so). | Miki | They stay in Dispatch. C4 puts the price upload on Truck Stops regardless — the drawer follows the page, wherever the page lives. |

| **Q-FUI6** | ~~**The Alerts queue measures ~2.9% precision — is the detector wrong, or is the review wrong?**~~ **ANSWERED IN PART 2026-09-01 (owner ruling + §0.3a measurement): reading (a) — the detector over-fires on bad inputs.** Three root causes, measured: wrong entered tank capacity (101 of 145 trucks disagree with the sensor-learned value; 54% of `cumulative_overfuel` fires sit on them), odometer quality (74 fires / 34 false positives across four rules), and card→truck attribution (`card_multi_vehicle`, 50 / 25). The owner is correcting capacity within days. **The unresolved half is the fix order and the missing gate** — see Q-FUI11. Original framing kept for the record: §0.3: 218 cases, all `theft_case`; of 105 reviewed, 3 confirmed / 95 false_positive / 7 benign_explained; 78 still open and unreviewed. Three readings and they need different work: **(a)** the detector is genuinely over-firing and its threshold or gates need raising until what remains is worth a person's time (**recommended first move** — it is measurable and reversible); **(b)** reviewers are marking `false_positive` where they mean `benign_explained`, in which case the label is wrong and precision is understated; **(c)** the rule is sound and the fleet is clean, in which case the queue should be surfaced by exception rather than as a standing list. WP7 (behavioural) was withdrawn, so nothing else is scheduled to move this number. | Miki | **C7 does not ship in any form.** The two inboxes stay separate and Alerts is not promoted into the Fuel section. No owner-facing surface quotes the alert count as a finding. |
| **Q-FUI7** | ~~**Is statement reconciliation a real workflow for this carrier?**~~ **ANSWERED 2026-09-01: YES, and the documents are already in hand.** The weekly PDF is a **Pilot Receivables LLC invoice** billed to Silvicom Inc — verified by reading `~/Downloads/db139445F.pdf`: invoice 795506105, period 2026-08-17 → 2026-08-23, with Ticket / AUTH / Odometer / Units / Fuel Cost / **Invoice Total** / **Retail Total** columns. That is exactly what `parsePilotStatement` expects and exactly the file `FUEL-SPEND-RELIABILITY-PLAN.md` **F0-bis-upload** names. Five weekly statements are on disk (`db139445F{,1,2,3,5}.pdf`, 2026-07-28 → 2026-08-24) and were parsed successfully in the F0-bis spike. **Nothing is missing but the upload.** This is an onboarding gap, not a product-fit question: C5 keeps both tabs and the ledger keeps all four `recon_*` kinds. ⚠ It is **not** a Samsara report — Samsara is telematics and issues no fuel invoice; its data already arrives through the API collector. Original framing kept for the record: Measured: `fuel_statements` 0, `fuel_recon_runs` 0 — nobody has ever uploaded one, in eight months of production. If the answer is no, then `recon_*` and `contract_variance` are four ledger kinds with no reachable producer, "Reconcile a file" and "Statements" are two of Fuel Spend's eight tabs with no data, and C5's cut should be deeper than three tabs. If the answer is yes-but-nobody-has, that is an onboarding problem, not a product one, and it should be named as such. Compounded by Q-FX3 — the contract agreement has never been received either. | Miki | C5 keeps both tabs and the ledger keeps all four kinds. Nothing is retired on an inference from an empty table. |
| **Q-FUI11** | **In what order are the three alert root causes fixed, and does the missing capacity gate ship first?** §0.3a: `cumulative_overfuel` reads ENTERED capacity, so the `tankSensor` gate never covers it, and 96% of its fires are on trucks the learner already distrusts. Candidates: **(a)** ship the "entered capacity contradicts learned capacity → suppress the capacity-ceiling rules" gate **first** (**recommended** — a pure-function change in `anomalyRules`, no new data, no migration, and it addresses 89 of 218 cases before anybody retypes a number); **(b)** wait for the owner's capacity correction and re-score, which fixes the inputs but leaves the gate absent for the next bad row; **(c)** both, gate first then re-score. The odometer cluster (74/34) and `card_multi_vehicle` (50/25) are separate work and neither is scheduled. | Miki | (a) is not built on a guess — it waits. Until then C7 stays blocked and no owner-facing surface quotes the alert count. |
| **Q-FUI12** | **Four fuel/anomaly reads carry no role gate at all — narrow them to the matrix, or is one of them deliberately open?** Found while building T2 (2026-09-01), pinned in `routeGates.test.ts`' waiver map so they are findable: `GET /api/anomalies/:id/risk-context`, `/:id/pattern-report` and `/:id/history` are `requireOrg` only, so **any authenticated org member — including a `driver`, who holds `safety: "none"` — can read a theft case's history**; and `GET /api/fueling/statements/:id/source` is `requireOrg` only, though it does re-check the caller's org before signing a URL. T2 did not close them because T2 is a **widening** and these are a **narrowing**: gating them removes access somebody may be relying on, which is a decision that should be taken out loud rather than in passing. Candidates: **(a)** gate all four from the matrix — `rolesThatCanView("safety")` for the three anomaly reads, `rolesThatCanView("fuel")` for the statement source (**recommended**: it is what every neighbouring route now does, and the anomaly detail is reachable only from a page already gated on `safety`); **(b)** gate the anomaly reads and leave the statement source, on its org re-check; **(c)** leave all four and record them as accepted. | Miki | They stay as they are, waived with the argument in `routeGates.test.ts` and named here. Nothing is narrowed on an inference. |
| **Q-FUI13** | **Does the Alerts queue get its own business date, or does it stay on the instant?** T1 gave `fuel_transactions` a stored station-local `business_date` (0287) and moved every fuel surface onto it except one: `useAnomalies` filters `anomalies.fueled_at`, a column on a different table, so a case for a fill displayed as "Aug 31" can still fall outside an August window on the Alerts page. Candidates: **(a)** `anomalies.business_date`, trigger-maintained from the same helper, two merges (**recommended** if Alerts survives Q-FUI11 as a working queue — it is the same shape as 0287 and costs a migration); **(b)** leave it, and label the Alerts date control as filtering the detection instant; **(c)** wait for Q-FUI11 — a queue measured at 2.9% precision may not be worth a migration until it is worth working. | Miki | (b) — Alerts stays on the instant and nothing claims otherwise. A second table gets a derived column when somebody decides the page is worth it. |
| **Q-FUI14** | ~~**What is the Cards page's third fact?**~~ **ANSWERED 2026-09-02: drop it.** T5 asks four pages to carry "rows in window, share attributed to a vehicle, and last feed poll". The middle one has no meaning on Cards: a card is issued to a driver or a truck as a matter of SETUP, not attributed per row, so there is no denominator to take a share of. Inventing a substitute — "cards seen on the last sync vs cards held" — would have been a different fact wearing the same sentence's clothes, which is how a consistency rule turns into noise. **Cards carries rows-in-window and last-feed-poll only, and T5's Done-when is read as satisfied for that page.** | Miki | ~~open~~ Answered. |
| **Q-FUI8** | ~~**Trailer-at-fill: acknowledge the removal, or fund the capability?**~~ **SHIPPED ON THE FALLBACK 2026-09-02.** T4 removed the column; the premise was re-measured first (`duty_equipment_segments` still 0 rows, 157 of 211 trailers carrying a current pairing). ⚠ **This remains an acknowledgement the owner has not given, not a question they answered** — if trailer-at-fill is wanted, it is a new time-ranged pairing table plus a source that fills it (driver-app duty sessions, dispatch, or Samsara), which is its own plan. The removal is pinned by `FuelLogPage.test.ts`, so restoring it means arguing with this row rather than reversing it quietly. | Miki | ~~T4 removes the column.~~ Done. |
| **Q-FUI9** | **Should `REBUILD_DAYS = 14` change?** §0.3: every `fuel_spend_days` row outside the trailing fortnight was derived on 2026-08-25 and has never been re-derived through F10, F13a, 0254, the station backfill or any price ingest since. T5 makes the staleness *visible*; it does not fix it. Options: widen the nightly window, add a rebuild-on-derivation-change trigger, or leave it manual and documented. | Miki | T5 ships the honest line and the rebuild policy is unchanged. Visible staleness beats invisible staleness; neither is correctness. |
| **Q-FUI10** | **Who is the report for, and what does it need to say?** Every export in P2 is currently specified as "the rows on screen". A company owner is not asking for rows — the audience question decides whether the fuel report is a row dump, a per-truck summary, or a variance-to-target narrative. `finance-reader-is-a-non-native-speaker` applies: plain word leads, industry term behind the hover. | Miki | P2 ships row-level CSV plus the existing spend PDF, and no new document shape is invented on a guess. |

---

## 7. What this plan deliberately does not do

- **It does not merge `anomalies` into `fuel_exceptions`.** D-FX2 ruled on that with a reason that still
  holds — `anomalies.transaction_id is not null` cannot express a billed line we never recorded. The
  unification is at the surface (§1.2).
- **It does not touch IFTA.** The owner has said it is an incomplete mirror of Samsara's report and is a
  separate track; `SAMSARA-IFTA-MILEAGE-PLAN.md` owns the data underneath it.
- **It does not touch McLeod.** The financial pipeline is mid-flight and its own plans own it.
- **It does not delete an upload path.** §0.2 fact 6 — the Pilot email report is the only source of
  contract net price. Every upload in `/import` survives; only its address changes.
- **It does not add a Fuel overview page.** D-FUI9.
- **It does not build a new lifecycle, and it does not flatten the two that exist.** C7a maps the queue
  axis the two models share and leaves each close axis alone — the disposition the accuracy program is
  built on is not a status and is not converted into one.
- **It does not fix the theft detector.** Q-FUI6 names the measurement and the candidate readings; the
  work itself is a scoring change and belongs with the anomaly rules, not with a page-consolidation plan.
  What this plan does is refuse to build on top of the number.
- **It does not retire the reconciliation path.** Q-FUI7 is answered: the documents exist, the parser
  handles them, and only the upload is missing. C5 keeps both tabs and the ledger keeps all four
  `recon_*` kinds.
- **It does not fix the odometer cluster or `card_multi_vehicle`.** §0.3a measures both as independent
  root causes of the 2.9%; neither is scheduled anywhere, and naming them here is so that the capacity
  correction is not mistaken for the whole job.
- **It does not rewrite the business-date derivation.** `businessDate()` and `fuel_business_date()`
  already exist in both layers and T1 reuses them — including 0247's widened-window filtering shape and
  its `set search_path` constraint.
- **It does not pin migration numbers.** Next-numbered at execution.
