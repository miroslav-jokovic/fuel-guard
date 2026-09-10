# Fuel planning — stops where the tank needs them, one honest settings page, prices with and without the discount

**Status:** ACTIVE. **Rulings in §2 were MADE by the owner on 2026-09-10**, after reading §1.1: "Truck
should be fueled when it gets to 20% to the top and next stop should be based on MPG (we have this
engine also) and fuel tank capacity … there is no need to fuel 3-4 times for 1900 miles if we have
enough fuel … Rules for CA should stay, also we need proper settings … without any overcomplications."
That sentence answers Q-FP1 to Q-FP4 (§6) and is the standard every step below is graded against.
The owner had asked for the module to be made "100% precise and really accurate and polished and user
friendly" and named four observations; every one is confirmed below and each has a root cause that is
not the one the code's own comments describe. **Owner:** Miki. **Author's position:** every figure in
§1 was measured against production (org `86d6b3ea…`) or replayed through the shipped solver on
2026-09-10; nothing in it is reasoned from reading the code alone.

**Related, and deliberately not merged into this plan:**
[SMART-FUELING-PLAN](../SMART-FUELING-PLAN.md) (the 2026-07 build plan and audit — its invariants
still hold and are cited by ID), [FUEL-PRICE-DATA-PLAN](../FUEL-PRICE-DATA-PLAN.md) (where prices come
from), [FUEL-SECTION-CONSOLIDATION-PLAN](FUEL-SECTION-CONSOLIDATION-PLAN.md) (the spend side, which
already grades ONE9 purchases as `avoided_brand_premium` — §1.5 shows the planner contradicting it).

---

## 1. Position — measured 2026-09-10

### 1.1 The plan the owner looked at

`fuel_plans` holds **two rows ever** (2026-08-18 and 2026-09-10). The second is the one under
discussion: unit **748**, I-495 Mansfield MA → Windsor CO, **1,961 mi / 29.9 h**, HERE average
**65.6 mph**. The truck at plan time, from Samsara: **99% = 198 gal** of a 200-gal tank, baseline
**6.83 MPG** (derated ×0.9 → 6.147), HOS **drive 6.0 h · shift 8.3 h · cycle 12.9 h · break due in 3 h**.

| # | Mile | Station | Arrive | Fill | Price | Tags the API set |
|---|---|---|---|---|---|---|
| 1 | 950 | Flying J, IN | 43.3 gal (**22%**) | 146.7 gal → 95% | $5.571 (report, 6 h old) | covers break |
| 2 | 1,293 | Flying J, IA | 133.9 gal (**67%**) | 56.1 gal → 95% | $5.322 | overnight |
| 3 | 1,632 | **ONE9**, NE | 134.8 gal (**67%**) | 55.2 gal → 95% | **none** | overnight, off-network |

Totals: 257.9 gal, **cost null** (stop 3 has no price, so the sum is unknowable), arrival **68.2%**,
flags `off_network_stop_used · overnight_reset_required · hos_limited · stale_fuel_reading`. The page
rendered exactly one of those four flags (none — it renders only `fills_uncapped_no_load_weight`).

So the owner's four observations, as measured:

1. **"Suggesting more fuelings than we really need."** Three stops where two suffice. From stop 1
   with a full tank the truck has 934 mi of range above reserve and 1,011 mi to go; ONE fill between
   miles 1,300 and 1,880 finishes the trip. Stop 3 buys 55 gal it does not need, at a brand the
   policy avoids, at a price nobody knows.
2. **"Thresholds add fuel at 60-something percent, and it is not in settings."** Stops 2 and 3 fire
   at 67%. The trigger is `min_purchase_gal = 50` — a stop is combined into an overnight reset whenever
   the tank has ≥ 50 gal of room, i.e. **whenever it is at or below 70%** on a 200-gal tank. The
   setting IS on the page, labelled "Min purchase (gal) — Loyalty / minimum-fill threshold", which is
   not what it does.
3. **"There is only a setting for maximum and it should be 100%."** Every fill tops out at **95%**:
   `usableFraction = 0.95` is a constant in `truckState.ts`, not a setting. The one visible cap,
   "Partial-fill cap 75%", belongs to the opt-in min-drawdown policy and is hidden while
   "Always fill to full" is on. Reserve is "20% of usable", which is **19% of the gauge** — the number
   a dispatcher reads is not the number the planner uses.
4. **"Show the price with and without the discount."** The Pilot daily report carries both and
   `fuel_prices` stores both — **2,729 rows in the last 7 days, 100% with `posted_price` and
   `net_price`, average discount $0.595/gal, max $1.073** — and the planner selects only `net_price`.

### 1.2 The replay — the same truck, five ways through the shipped solver

The corridor station list is not persisted with a plan, so the replay used the three stations the
plan chose plus, in the "dense" variant, a priced Pilot every 70 mi and an unpriced ONE9 every
55 mi. **Variant A reproduces stops 1 and 2 of the saved plan to the tenth of a gallon** (43.3 → 146.7,
133.9 → 56.1), which is what makes the rest of the table evidence rather than illustration.

| Variant | HOS given to the solver | Stations | Stops | Arrival % of tank at each stop |
|---|---|---|---|---|
| A | as Samsara reported (cycle 12.9 h) | the saved plan's 3 + 2 | 2, then **INFEASIBLE** | 22%, 67% |
| B | as Samsara reported (cycle 12.9 h) | dense | **5**, all "overnight" | **68%, 61%, 66%, 66%, 67%** |
| C | cycle 70 h, everything else the same | dense | 3, all "overnight" | 68%, 38%, 41% |
| D | **no HOS at all** | dense | **2** | **22%, 22%** |
| E | cycle 70 h | sparse | 2 | 22%, 23% |

Read down the Stops column: the plan the owner expects (D, E) is what the solver produces when HOS is
absent or generous, and the plan the owner got (A, B) is what HOS does to it. **HOS is not timing the
fuel; it is placing it.** Two mechanisms, both in `solver.ts`:

- **The reset-combine (F1 below).** When the legal drive clock binds before fuel, a station within
  75 mi before the limit with ≥ `min_purchase_gal` of room becomes an "overnight" full fill. Variant C
  is this alone: three fills at 68/38/41% where two at 22% would do.
- **The cycle clock is never restarted, and silent legs never charge it (F2 below).** Samsara said
  12.9 h of cycle remained; the trip needs 29.9 h. `silentResetAt` resets drive and shift, not cycle,
  and does not subtract the miles it just drove from any clock. Once the cycle is spent, the legal
  window is ~0 mi, every iteration is a "silent 10-hour reset" a few miles long, and any station that
  falls inside one of those slivers with 50 gal of room becomes a stop. Variant B is that: five stops.
  Variant A is the same thing running out of stations: INFEASIBLE with a full tank and 668 mi to go.
  **There is no 34-hour restart anywhere in the model** (`grep -rn restart packages/shared/src/smartFueling`
  returns nothing), so any driver near the end of a cycle produces this shape.

### 1.3 The numbers the planner uses that no page shows

| Constant | Value | Where | What it does |
|---|---|---|---|
| `usableFraction` | 0.95 | `truckState.ts:65` | fill ceiling; "fill to ~95%" on every stop |
| reserve base | usable, not tank | `truckState.ts:77` | "20%" is 19% of the gauge |
| `refuelBandMiles` | 150 | `types.ts` default; **no column, no field** | fuel only in the last 150 mi of range |
| `criticalFuelPct` | 10 | same | emergency vs off-network threshold |
| `oppositeSideAccessMiles` | 2 | same | detour charged to an opposite-side stop |
| `COMBINE_BAND_MI` | 75 | `solver.ts:170` | the overnight-combine window |
| `FUEL_SERVICE_MS` | 45 min | `solver.ts:30` | on-duty time per fuel stop |
| `BORDER_TOP_OFF_PCT` | 80 | `fuelPlanning.ts:23` — the solver comment says **85** | top off before CA/MA below this |
| avg speed for "Reachable now" | 55 mph | `truckState.ts:66` | the tile; the solver uses the route's 65.6 |

`resolveRouteFuelConfig` reads `refuel_band_miles`, `critical_fuel_pct` and `opposite_side_access_miles`
from a row that has never had those columns (0058, 0061, 0062, 0063, 0065, 0325 — none adds them), so
they are defaults for every org and always will be until a migration exists.

### 1.4 The settings page, field by field

| Field | Read by the solver? | Note |
|---|---|---|
| Reserve (% of usable tank) | yes | mislabelled — see 1.3 |
| MPG safety factor | yes | |
| Emergency fill (gal) | yes | |
| Min purchase (gal) | yes, **as the overnight trigger** and as the min-drawdown floor | hint says "loyalty" |
| Corridor buffer (mi) | yes | |
| Off-route recompute (mi) | **no** — Phase 6 live tracking was never built; nothing reads `deviation_threshold_mi` | inert |
| Price freshness (hours) | yes | DB default 30 (0058), code default 72, prod 72 |
| Networks on | yes | |
| Always fill to full | yes | hint says "Off (default)"; code default **true** (d03b80e), DB default **false** (0061), prod true |
| Partial-fill cap | only when the above is off | |
| Plan DEF stops | **no** — nothing reads `plan_def` | inert |
| Preferred / Avoided / Emergency brands | yes / yes / **no** — `emergencyBrands` is resolved and never consulted | free-text CSV although `BRAND_LABELS` is a catalogue |
| Avoided states / Fuel-before states | yes | free-text CSV |
| Targets | spend page, not the planner | correct, C8 |
| Default equipment, truck profile | yes (routing) | |
| Chain discount rules | yes (posted-layer stations only) | zero rows in prod; hint says Pilot does not need one, which is right |

### 1.5 Brand policy, as applied

`isPreferred` excludes avoided brands and avoided states. When no preferred priced station is reachable,
`pickStop` takes the **nearest station of any kind** — the avoid-brand list is not consulted on that
path, so ONE9 (avoided, emergency-only, **0 of 106 stations priced**) is a legal non-emergency
"off-network" pick. The spend page, from the same settings row, grades every ONE9 gallon as an
`avoided_brand_premium` finding (C6, 8 findings / $660.61 as of 2026-09-06). The planner recommends
what the report then penalises.

### 1.6 Price coverage in the corridor registry, last 72 h

| Brand | Stations | Priced (Pilot report, net) | Posted (public layer, USD) |
|---|---|---|---|
| pilot | 540 | **486** | 0 |
| flying_j | 253 | **197** | 0 |
| one9 | 106 | 0 | 0 |
| loves | 616 | 0 | 0 — last posted 2026-07-17 |
| road_ranger | 55 | 0 | 54 |
| six regional brands | 32 | 0 | 0 |

The Pilot report is the only live feed and it is healthy (latest 2026-09-10 12:00). Everything the
planner can price today is Pilot/Flying J; the "posted − rule" path (F5 in effectivePrice) has no fresh
input and no rules, so `priceEstimated` today can only mean "station history median".

---

## 2. The rulings (made 2026-09-10)

**One arithmetic fact first, because the owner's "1,200–1,300 miles between fills" is not what a
20% rule produces.** Unit 748: 200 gal × 6.83 MPG = **1,366 mi** tank-to-empty. Full to a 20% reserve
is 160 gal, and the planner derates MPG by the safety factor 0.9, so it plans on **983 mi** between
fills. "Fuel at 20%" and "fuel every ~1,000 mi" are the same rule for this truck; 1,200–1,300 is the
tank run nearly dry. The distance is a consequence of two settings the owner controls — reserve % and
the MPG safety factor — and FP6's hints say so in those words. Nothing else in the planner shortens it
once D-FP1 lands.

### D-FP1 — a fuel stop is placed by RANGE and by nothing else

Fuel stops go where the tank needs them: full fill, at the cheapest preferred priced station inside the
last `refuel_band_miles` of range above reserve; if that band has none, the farthest reachable preferred
station. Hours of service **annotate** a plan — "covers the 30-min break", "this is where the day
ends", drive hours left on arrival — and never **place** a stop. The reset-combine
(`solver.ts:286-298`) is removed, not tuned: variant C shows that no threshold on it produces a plan a
dispatcher would call precise, because any threshold below "the tank is at reserve" is a fill above
reserve. A stop that happens to land where the day ends keeps an `isOvernight` tag as a coincidence
label, exactly as `coversBreak` already does.

Why not keep it as "combine only when a fill is needed before the next reset anyway": that variant was
worked through and still yields 60–68% fills at every overnight (the next day's 720 mi always exceeds
what a two-thirds tank covers above reserve), which is the shape the owner rejected.

### D-FP2 — the HOS model charges every driven mile and models the restart

Cycle is decremented for every mile the solver moves the truck, silent legs included. When the cycle
is exhausted, a **34-hour restart** is applied silently and the cycle returns to the full window. The
window length is not in Samsara's clocks; assume **70 h** (the 70/8 ruleset this fleet runs) and flag
`cycle_restart_required` so the dispatcher sees it. After D-FP1 this affects only tags and flags, never
placement — which is why F2 is safe to fix at all.

### D-FP3 — the fill target is a setting, defaults to 100%, the reserve is a gauge reading, and every fill is a full fill

`fill_target_pct` (new column, default **100**) replaces `usableFraction`. `reserve_pct` becomes a
percentage **of the tank** — the number on the gauge — not of "usable"; for the one configured org
that moves the reserve from 19% to 20% of the gauge, which is stated here so it is not discovered.
"Usable" leaves the vocabulary of the UI entirely. The plan says "Arrive ~22% → fill to 100%" and
means it. Min-drawdown (partial fills to reach cheaper fuel, opt-in since 0061) is **retired** under
"without any overcomplications": the solver always fills full, `always_fill_full` / `fill_cap_pct` /
`min_purchase_gal` leave the form, and the Buy-discipline tab's partial-fill reading of the same
column goes with them. Columns stay until a later migration drops them.

⚠ Stated, not hidden: 748's largest fill on record is **168.7 gal against a 200-gal nameplate**
(`observed_max_fill_gal`). A 100% target plans a 156-gal fill for it. Either the nameplate is wrong or
the driver never runs it down; the plan cannot tell which. `effectiveTankCapacityGal` already takes
the larger of the two, so a truck that over-fills its nameplate is handled; one that under-fills is
not, and stays a data question for the roster, not a planner rule.

### D-FP4 — one brand ladder, applied on every path

Enabled → preferred → other enabled (off-network, flagged) → **avoided brands and avoided states are
emergency-only, on every path**, and **an unpriced station is never a non-emergency pick on any path**.
`emergency_brands` is retired as a concept: "avoided" already means "emergency only", and a second
list that nothing reads is a copy with a delay fuse. `pickStop` and the min-fill lookahead both use the
same predicate.

### D-FP5 — every price is shown twice, and the totals are too

`PlanStopView` gains `postedPrice` and `discountPerGal`; the plan gains `totalCostAtPump` and
`discountSavings`. The stop reads **"Pump $5.94 · Your price $5.57 · −$0.37/gal"** and the summary
tile reads "Est. cost $1,516 · $153 below pump". Where only a net price exists (history median), the
stop says so instead of inventing a posted figure; where only a posted price exists and no rule, the
two are equal and the stop says "no contract discount on file for Love's". The `(est.)` suffix becomes
a real basis label: "Pilot report, 6 h ago" / "station history" / "brand average".

### D-FP6 — the settings page is the solver's rule order, and only fields the solver reads

Five sections in the order the planner applies them, each field with a hint that says what changes
when it changes:

1. **Tank and safety** — fill target %, reserve % (of tank), MPG safety factor, refuel band (mi),
   critical fuel %.
2. **Stations** — networks on (checkboxes, as now); preferred brands and avoided brands as
   checkboxes drawn from the enabled set; avoided states and fuel-before states as chips with the
   50-state list; border top-off % (new column, replaces the constant and the 80/85 disagreement);
   corridor buffer; opposite-side detour (mi).
3. **Emergencies** — the splash size (gal), and nothing else: every planned fill is full (D-FP3).
4. **Prices** — freshness window; the discount rules table, limited to enabled brands, with the
   sentence about Pilot kept.
5. **Load and truck defaults** — unchanged. **Targets** — unchanged, stays beside the brand lists (C8).

Retired from the form: off-route recompute, plan DEF, emergency brands (inert or unread), and the
three min-drawdown fields (D-FP3). Their
columns stay until a later migration drops them; a column with no reader is harmless, a form field
with no reader is a lie.

### D-FP7 — every plan flag is a sentence, and a new flag cannot be silent

A `PLAN_FLAG_COPY` map, typed as `Record<PlanFlag, string>` over a `PlanFlag` union the solver's
`flags` array is narrowed to, so adding a flag without copy fails typecheck (the `FINDING_SECTIONS`
pattern). The page renders every flag it receives. "Savings vs naive" is retired: the naive baseline
is the same solver with a different picker, and its number was null on both production plans.

### D-FP8 — one speed

The route's own average (`distanceMiles ÷ durationHours`) is the speed everywhere: the solver already
uses it; "Reachable now" on the Route card uses 55. The API computes `truckStateView` after the route
exists, so it passes the route speed in.

---

## 3. What we build — one PR per step, branch from `origin/main`, gates green, merge on green

| Step | Change | Done when |
|---|---|---|
| **FP1** | Solver: delete the reset-combine; HOS becomes a clock the walk advances (breaks, 10-h resets, 34-h restart applied silently, cycle charged on every leg) with `cycle_restart_required`; `isOvernight` becomes a coincidence tag; min-drawdown removed from `fillPolicy.ts` | replay fixture "unit 748 Mansfield → Windsor: two fills at the reserve, not five at two-thirds" passes and is proved to fail on the pre-FP1 solver; "an overnight reset never places a fuel stop the range does not need"; "a truck whose cycle runs out mid-trip is planned exactly like one with a fresh cycle" |
| **FP2** | Brand ladder (D-FP4) in `stationSelect.ts`; `pickStop` and the min-fill lookahead use it; `emergencyBrands` removed from `RouteFuelSettings` | "an avoided brand is never chosen for an off-network stop"; "a station with no price is never a non-emergency pick"; prod ONE9 replay yields no ONE9 stop |
| **FP3** | Migration (next-numbered): `fill_target_pct` (100), `refuel_band_miles` (150), `critical_fuel_pct` (10), `opposite_side_access_miles` (2), `border_top_off_pct` (80); `always_fill_full` default → true; `price_ttl_hours` default → 72; regenerate `schema.generated.sql` | `lint:migrations`, `lint:table-writers`, matrices green; **no reader in this PR** (`lint:migration-ordering`) |
| **FP4** | Readers: `resolveRouteFuelConfig` reads the five columns; `usableFraction` deleted; reserve = % of tank; `BORDER_TOP_OFF_PCT` deleted; form schema + defaults | "reserve is a share of the tank, not of a usable fraction"; the settings page round-trips every column (`ROUTE_FUEL_SETTINGS_COLS` derives it) |
| **FP5** | Prices twice (D-FP5): API reads `posted_price`; `PlanStopView` + totals; `TripPlan` + `FuelPlanSummary` copy; basis labels | a stop with both prices shows both and the per-gallon difference; a history-median stop shows net only with its basis; `totalCostAtPump − totalCost = discountSavings` pinned |
| **FP6** | Settings page rebuilt to D-FP6 | `lint:ui-adoption`, `lint:tokens` green; every field on the page is read by the solver or the router (pinned by a test that walks `routeFuelSettingsFormSchema.shape` against `resolveRouteFuelConfig`'s output keys) |
| **FP7** | Plan page: `PLAN_FLAG_COPY`, one speed (D-FP8), "Savings vs naive" retired, station card shows posted/net/basis | every flag in the union has copy (typecheck); Route card "Reachable now" equals the solver's first-leg window |
| **FP8** | Verification on production: replan 748's route, one CA-bound route, one MA-bound route; record stops, arrival %, both totals in §7 | three rows in the progress log with measured figures |

FP1 and FP2 are pure shared code and can ship the same day. FP3 must merge and be applied before FP4
(the two-merge rule; `pnpm verify:live` confirms). FP5–FP7 are independent of each other after FP4.

## 4. What we delete

- Min-drawdown: the `!cfg.alwaysFillFull` branch of `fillPolicy.ts` (FP1); `always_fill_full`,
  `fill_cap_pct`, `min_purchase_gal` from the form and `RouteFuelSettings` (FP6); the Buy-discipline
  partial-fill reading (FP6).

- `solver.ts` reset-combine branch and `COMBINE_BAND_MI`; `silentResetAt`'s partial clock handling.
- `truckState.ts` `usableFraction` and the `usableGal` vocabulary in views.
- `fuelPlanning.ts` `BORDER_TOP_OFF_PCT`.
- `emergency_brands` from the form, schema, defaults and `RouteFuelSettings` (column stays).
- `deviation_threshold_mi` and `plan_def` from the form (columns stay).
- `savingsVsNaive` and the `nearest` picker's second solver run.

## 5. What this plan refuses to do

- **Live tracking / re-plan on deviation (Phase 6).** Not built, not demanded (two plans ever), and
  `deviation_threshold_mi` pretending it exists is part of why the page reads as outdated.
- **A DEF plan.** `plan_def` has no reader; adding one is a feature, not precision.
- **Pricing ONE9 or Love's.** No feed exists; the planner must say "no price" rather than estimate
  from a brand average that has no fresh members (1.6).
- **Tuning the reset-combine.** §2 D-FP1 says why.

## 6. Questions — owner rulings needed, with the recommendation

All four answered by the owner's 2026-09-10 ruling quoted in the status line.

- **Q-FP1 Fill target default — ANSWERED 100** ("to the top"). The setting stays for a fleet whose
  pumps stop early; the gauge caveat in D-FP3 stands.
- **Q-FP2 Keep min-drawdown? — ANSWERED no** ("without any overcomplications"). Retired, D-FP3.
- **Q-FP3 Cycle window after a restart — ANSWERED 70 h**, with the flag; no per-org setting.
- **Q-FP4 Still fetch HOS? — ANSWERED yes, as annotation only** ("next stop should be based on MPG and
  fuel tank capacity"): the break tag, the day-end tag and hours left on arrival.

## 7. Progress log — append one dated line per step, never edit the §3 table

- 2026-09-10 — plan written from the production measurements in §1; nothing built.
- 2026-09-10 — owner ruled on §1.1 (quoted in the status line); §2 became rulings, §6's four questions
  answered, min-drawdown retired under "no overcomplications". FP1 starts.
- 2026-09-10 — **FP3 BUILT** (#729): migration 0335 adds `fill_target_pct` (100), `refuel_band_miles` (150), `critical_fuel_pct` (10), `opposite_side_access_miles` (2), `border_top_off_pct` (80); `always_fill_full` default → true, `price_ttl_hours` default → 72. No reader in this merge; FP4 waits for `pnpm verify:live` to report 0335 current.
