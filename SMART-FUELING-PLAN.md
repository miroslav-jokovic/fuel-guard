# Smart Fueling (Dispatcher-Driven) — Implementation Plan

**Feature:** A standalone module where a **dispatcher enters a start + end (and optional waypoints) and picks a truck**, and FleetGuard returns **where to fuel and how many gallons** along that route — optimized for lowest net cost within the truck's **current fuel, range, reserve, HOS, and consumption**. Output is a **read-only options report** (no write-back to Samsara). Once a plan exists, it **tracks the truck live** and recomputes when it deviates.

**Why this shape (vs. the earlier `PLANNED-FUELING-PLAN.md`):** the dispatcher enters the route, so we **no longer depend on Samsara Routes existing** — the single biggest risk in the earlier plan (§0 of `PLANNED-FUELING-RISK-ANALYSIS.md`) is removed. Everything else the earlier docs verified (HERE v8, Samsara stats/HOS reads, Pilot data, the fuel-purchase algorithm, the full risk register) **still applies and is reused here** — this document is the authoritative BUILD PLAN and does not re-verify those facts; it references them.

**Locked (confirmed for Silvicom):** Pilot network now (EFS-restricted); Preferred = Pilot + Flying J outside CA; Emergency-only = ONE9 + any CA station. Mixed reefer + dry van; mostly hazmat; US + Canada (~99.9% US); team drivers present; ≤80,000 lb. Prices from the Pilot daily email (already net; flat discount). Read-only. ~$20/month all-in.

**Product intent:** build the **core chain-agnostic** and Pilot-specific only as *configuration/adapters*, so it can be sold to other carriers later without a rewrite. Build the seams now; implement only the Pilot/EFS/Samsara adapters in v1.

---

## Guiding principles (non-negotiable)

1. **Assumption-free by construction.** When an input isn't trustworthy, the plan **abstains or raises INFEASIBLE — never emits a best-guess stop.** A wrong suggestion a driver follows can strand a truck; an honest "cannot plan" cannot.
2. **Read-only.** No write-back to Samsara. The dispatcher/driver acts on the report.
3. **Safety outranks cost, always.** The reserve floor and HOS legality are hard constraints; price is optimized only within them.
4. **Chain-agnostic core, Pilot config.** No Pilot constant is hardcoded in logic; "preferred vs emergency", discount model, and price source are per-org data/adapters.
5. **Measure before trust.** The accuracy/backtest/dry-run loop is a **launch gate**, not an afterthought (risk-doc C5).
6. **Reuse, don't rebuild** (~80% reuse): `samsaraHttp.ts` (rate-limited client), scheduler + jobs ledger, geocode cache, fuel-level smoothing from the fueling-time-precision work, EFS import, per-org `integration_credentials`, RLS org-scoping.

---

## Safety invariants the solver must satisfy (carried from the risk register — each is a test)

- **Reserve floor never breached**, counting the **round-trip detour fuel** to a candidate pump **plus idle burn plus reefer burn** — not miles×MPG alone (C3, H1, H10).
- **HOS legal remaining = `min(drive, shift, cycle)`** with the 30-min break as a mid-route **segmenter**; convert time→distance with a **conservative, reserve-padded** speed; drive off whatever clocks Samsara returns per driver's ruleset; **team drivers** use combined availability; **never** bank split-sleeper or adverse-driving (HOS-correctness, M6, H4).
- **Weight-legal fills:** cap the fill so gross stays ≤ 80,000 lb (or org max); when live gross is unknown, assume near-max for loaded hazmat and cap conservatively, flagging driver verification (H2).
- **Emergency fill is sized to reach the next reachable station + reserve.** The 50-gal cap is a *soft cost target*, explicitly subordinate to the reserve rule (C1).
- **INFEASIBLE is a loud state** ("no reachable fuel, act now"), never a silent bad stop (C2).
- **California:** handle all three cases — short traverse (top off before the border), in-CA distance > one tank / starts-in-CA (planned in-CA fills, accept cost, don't strand), multiple crossings (per-segment) (C4).
- **Abstain on stale/absent inputs:** no `fuelPercents` coverage → last EFS fill only within a bounded window, else abstain; stale HOS (offline tablet) → assume limit due soon + flag; stale prices → visible warning; in-corridor station with no price → regional fallback + flag, never silent-drop (H4, H8, H9, edge-cases).

---

## Phase 0 — Data-readiness verification (GATE — before any solver code)

The dispatcher-entry model removes the Routes dependency but **keeps two hard data dependencies** that must be proven on the real Silvicom token first:

- **`fuelPercents` coverage & quantization** per truck: do their trucks actually report tank level via the stats API, and how coarse? (Varies by make.) A truck with no fuel telematics can't be planned from live state — it must fall back to last EFS fill or be excluded. Audit coverage %.
- **HOS clocks exist & are fresh:** drivers run Samsara ELD, `GET /fleet/hos/clocks` returns drive/shift/cycle/break, and freshness is gated on GPS liveness.
- **HERE key:** create it; confirm truck routing + Flexible Polyline decode + geocoding work and the Advanced-tier pricing in the console.
- **Pilot daily email:** confirm exact columns, that prices are net, per-location, and completeness (row count).
- **`tank_capacity_gal` accuracy** (usable vs rated) and `baseline_mpg` representativeness per truck.

**Deliverable:** a one-page data-readiness report + a go/no-go. **Gate:** don't build the solver until fuel% + HOS coverage are confirmed (or the fallback/exclusion behavior is decided for trucks that lack them).

---

## Architecture at a glance

```
Dispatcher: start + end (+ waypoints) + truck  ─────────────┐
Geocode inputs (reuse geocode cache / HERE geocode)          │
Samsara: live GPS + fuelPercents (snapshot) ────────────────┤
Samsara: HOS clocks (min-of-clocks) ────────────────────────┤
Truck/trailer profile (weight, dims, hazmat, reefer, tank)  │
                                                             ▼
                         [HERE v8 truck route] → decoded polyline (cached route_geometries)
                                                             │
Pilot daily email → fuel_prices.net_price ───────────────────┤
Static Pilot/FJ/ONE9 registry → fuel_stations ───────────────┤
                                                             ▼
                         [Corridor match]  candidate stations ahead, within buffer
                                                             ▼
                         [Smart-fueling solver]  reserve + HOS + burn + CA + INFEASIBLE
                                                             ▼
                         [Options report]  stops, gallons, net$, arrival%, detour, flags, savings
                                                    │
                            (live GPS deviates) ────┴──> recompute
                                                    │
                            EFS actual lands ───────┴──> measure (predicted vs actual)
```

All jobs on the existing scheduler + jobs ledger; all Samsara reads through `samsaraHttp.ts`. No PATCH, no write path.

---

## Data model (chain-agnostic; migrations continue the `NNNN_` convention, RLS org-scoped)

| Table | Purpose |
|---|---|
| `fuel_stations` | Chain-agnostic registry: `brand`, `store_number`, name, lat/lng, `state`, exit, `has_diesel`, `tier` source. Unique (brand, store_number). Pilot/FJ/ONE9 loaded in v1 |
| `fuel_prices` | `station_id`, `product` (diesel/def), `posted_price`, `net_price`, `source` (pilot_email/efs), `observed_at`. Append-only; latest-per-station view |
| `fuel_discount_rules` | Per org per chain: `type` (flat/retail_minus/cost_plus/per_site), `cents_off`, calibration stats. One Pilot row in v1 |
| `fuel_plan_requests` | Dispatcher input: origin/dest/waypoints (typed + resolved lat/lng), vehicle_id, created_by, created_at |
| `route_geometries` | Cached HERE polyline per (origin, waypoints, destination, vehicle-profile, engine-version): decoded lat/lng + total meters |
| `fuel_plans` | One per request run: input snapshot (fuel%, tank, MPG, HOS, prices used), `status` (fresh/stale/recomputed/infeasible), est. total cost, est. savings vs naive, `computed_at` |
| `fuel_plan_stops` | A suggested stop (report row): `station_id`, gallons, net price + source + age, predicted arrival fuel%, detour miles, HOS-break flag, sequence, `superseded_by`, `is_emergency` |
| `route_fuel_settings` (org) | reserve %, corridor miles, min purchase, MPG safety factor, deviation threshold, price TTL, truck-profile defaults, **policy:** `always_fill_full`, `avoid_states` (`['CA']`), `avoid_brands` (`['one9']`), `emergency_fill_gallons` (50), `preferred_brands`, `emergency_brands` |

---

## Phases (dependency-ordered; each is shippable + testable)

### Phase 1 — Station & price registry (chain-agnostic data spine)
- **M:** `fuel_stations`, `fuel_prices`, `fuel_discount_rules`, `route_fuel_settings` (+ RLS).
- Station loader: Overpass/Pilot export → `fuel_stations` (Pilot/FJ/ONE9), quarterly refresh; **cross-validate** OSM ∩ Pilot export ∩ daily-email presence; verify brand via Wikidata; treat closures + `has_diesel` as safety-critical (H6).
- Price ingest: parse Pilot morning email → `fuel_prices.net_price`; **completeness/row-count check** each morning (H8); EFS net as QA cross-check.
- **Exit:** current net prices for all Pilot corridor stations in DB, freshness-monitored. Reuse: jobs, geocode cache, EFS import.

### Phase 2 — Routing engine (HERE v8 adapter)
- Geocode dispatcher-typed origin/dest/waypoints → lat/lng (reuse geocode cache; HERE geocode fallback).
- HERE v8 `transportMode=truck` with **full vehicle profile incl. hazmat class + tunnel category** (required — a non-hazmat route diverges from the legal path); `return=polyline,summary`; decode Flexible Polyline via `@here/flexpolyline`; cache in `route_geometries`.
- Corridor buffer (default 2.5 mi) + candidate stations **ahead of the truck's current position**; check **access side** of divided highways (M3); flag **ambiguous highway choice** as low route-confidence (H5).
- **Exit:** given start/end + truck profile → cached truck-legal polyline + ordered candidate Pilot stations. Property tests on corridor math + unit-conversion round-trips (M1).

### Phase 3 — Truck state + HOS + consumption model
- Snapshot: `GET /fleet/vehicles/stats?types=gps,fuelPercents` → **smooth fuel%** (reuse fueling-precision 7-pt median; distrust 60-min post-fill window; ±5–10% sensor margin) → gallons-on-hand = smoothed% × usable capacity.
- HOS: `GET /fleet/hos/clocks` → **`min(drive, shift, cycle)`** + break segmenter; **team-driver** detection → combined availability; per-driver ruleset; **freshness gate** on GPS liveness.
- Consumption: `baseline_mpg` × **calibrated** safety factor (not a guess) + **idle burn** (gal/h × idle h) + **reefer burn** (~0.5–1 gal/h when `trailers.is_reefer`) + **detour fuel** + **weight-legal fill cap**; auto-widen reserve in mountain/winter corridors.
- **Exit:** a validated `TruckFuelState` object (gallons-on-hand, legal range, HOS windows, burn model) with confidence flags. Pure where possible; adversarial-input tests.

### Phase 4 — The smart-fueling solver (pure, in `packages/shared`)
- Full-fill **station-selection** solver (policy-configurable to partial later): walk the corridor; insert a full fill at the cheapest reachable station before the tank would hit reserve; always top off at the last preferred station before a CA leg; respect capacity, weight, HOS placement (fuel stop near the break = ~zero time cost).
- Rule precedence: (1) reserve floor, (2) HOS legality, (3) prefer discounted non-CA, (4) full fill, (5) best net price. **Emergency exception** safety-sized; **INFEASIBLE** hard state; all three **CA cases**.
- **Exit:** given candidates + `TruckFuelState` + prices → ranked plan (stops, gallons, net cost, savings vs naive, arrival%, flags). **Tests:** property invariants (never below reserve incl. detour+idle+reefer; capacity/weight; INFEASIBLE fires) + adversarial physical inputs (optimistic MPG, +10% sensor, fuel desert, closed station, shift/cycle binding) + **golden routes** (CA-long, starts-in-CA, multi-crossing, fuel desert). Correct the "provably optimal" language — full-fill is a policy variant, tested empirically (C6).

### Phase 5 — Dispatcher UI + on-demand flow (`features/fueling/`, Vue + design system)
- Dispatcher page: enter start/end (+ waypoints, autocomplete/geocode), pick truck → **Generate plan** → options table (station, exit, gallons, net price + age, predicted arrival fuel%, detour mi, HOS-break flag, savings vs naive); INFEASIBLE / low-confidence banners; fuel-level projection along the route; optional map (MapLibre + OSM) drawing polyline/corridor/candidates/live truck.
- Settings: Pilot discount rule, planning params (reserve %, corridor, deviation, MPG factor, price TTL), truck-profile defaults, provider health (HERE key, email parse status).
- **Exit:** the interactive tool the boss asked for, read-only, design-system-consistent, typecheck/lint/tokens green.

### Phase 6 — Live tracking + reroute recompute
- Poll `GET /fleet/vehicles/stats/feed?types=gps` on a planning cadence (minutes, far below the 5 s floor); perpendicular distance to cached polyline; on deviation beyond threshold (sustained N min/M mi; shorten window when fuel low, H5) → recompute HERE route from current GPS → destination, re-run corridor + solver, mark prior plan `recomputed`; advance miles-to-go and drop passed stations.
- **Exit:** plans stay current as trucks move; deviation unit tests on synthetic GPS tracks incl. wrong-highway divergence.

### Phase 7 — Measurement / backtest / dry-run (LAUNCH GATE — required, not optional)
- EFS reconciliation: **predicted-vs-actual arrival fuel%** (next `fuelPercents`), **emergency-fill rate**, **near-reserve-breach rate**, **suggested-vs-actual station mismatch**, realized $ savings.
- **Backtest harness:** replay 60–90 days of historical routes + EFS actuals → what the plan *would* have suggested + whether any truck would have stranded. **This is the number that earns trust and doubles as the sales proof.**
- **Advisory dry-run period:** plans shown but labeled advisory; ship to drivers only when prediction error + mismatch + near-reserve breaches are within target. Kill switches: per-org flag, provider circuit breakers (HERE, email parse), alert on any near-reserve breach.
- **Exit:** proof-of-savings + safety validation → drivers may rely on it.

### Phase 8 — Productization seams (interfaces now, Pilot/Samsara/EFS adapters only)
- `PriceSource` interface (impl: Pilot daily email); chain-agnostic `fuel_stations`/tiers; discount model config (flat now; retail-minus/cost-plus/per-site ready); HOS ruleset pass-through; units/currency (canonical metric/UTC, present per-org); `TelematicsProvider` interface (Samsara adapter now; Motive/Geotab later); per-org HERE key / metered-cost attribution for billing.
- **Exit:** onboarding a new carrier is data + a thin adapter, not a rewrite. No new adapters built in v1.

---

## Open items to confirm (don't silently assume)

- **DEF:** plan DEF stops (`product=def` exists) or state it's the driver's responsibility? (M10)
- **Plan lifecycle:** confirm MVP = on-demand one-shot (Phase 5), with live tracking (Phase 6) as the next increment — vs. persistent auto-tracked from creation.
- **Per-truck vehicle profiles** (dims/weight/hazmat capability/tank config) source: fleet records vs. org defaults — needed for correct HERE routing + fill caps.
- **Trucks lacking `fuelPercents`/ELD** (from Phase 0): fallback-to-EFS, exclude, or manual fuel% entry?

## Cost
HERE truck routing (cached) ~$10–20/mo; Pilot email parse $0; EFS $0; OSM one-off $0; MapLibre/OSM tiles $0; compute $0 (existing). **≈$20/month all-in.** Valhalla self-host drops routing to ~$0 later if needed.

## Reuse map
`lib/samsaraHttp.ts`, `services/samsaraScheduler.ts`, `services/jobs.ts`+`0027`, `services/geocode.ts`+`0018`, `vehicles.tank_capacity_gal`/`baseline_mpg`, fuel-precision smoothing, EFS import, `integration_credentials`, `trailers.is_reefer`, RLS org-scoping, design system (DataTable/FilterBar/PageHeader/Base*/FormField).

## Verification sources
See `PLANNED-FUELING-PLAN.md` §13 (Samsara/HERE/Pilot/algorithm/HOS citations, verified July 2026) and `PLANNED-FUELING-RISK-ANALYSIS.md` (full assumption/gap/blocker register). This plan folds every Critical + HOS-correctness fix from that review into the invariants above.

---

# Audit — verification findings & plan corrections (2026-07, pre-build)

Two independent passes: **external fact-check** (HERE, Samsara, FMCSA/IFTA, Pilot/OSM — fresh web research, sources below) and **internal repo verification** (what we can actually reuse today). Purpose: remove assumptions/blockers/gaps before Phase 0. Each item is CONFIRMED / CORRECTED / GAP, with the concrete plan change.

## A. External facts — CONFIRMED (build against these)
- **HERE v8 truck routing** — endpoint `router.hereapi.com/v8/routes?transportMode=truck`, repeatable `via`, `return=polyline,summary` all current. `vehicle[...]` params confirmed: `grossWeight`/`weightPerAxle` **kg**, `height`/`width`/`length` **cm**, `axleCount` int. `shippedHazardousGoods` enum = exactly `explosive, gas, flammable, combustible, organic, poison, radioactive, corrosive, poisonousInhalation, harmfulToWater, other`. `tunnelCategory` = `B, C, D, E` (no A). **Polyline is returned PER SECTION — decode each section, then stitch.** HERE **forward geocoding** (`geocode.search.hereapi.com/v1/geocode`) works with the **same API key** (separate transaction billing).
- **Samsara** — `GET /fleet/vehicles/stats(/feed)?types=gps,fuelPercents` current; feed cursor-based, **≥5 s** poll floor. **`fuelPercents` is RAW/UNSMOOTHED via the API** (KB 360037502312 still accurate) → we smooth. **Tank capacity is NOT in the API** → keep storing it (we do). `GET /fleet/hos/clocks` fields confirmed: `driveRemainingDurationMs`, `shiftRemainingDurationMs`, `cycleRemainingDurationMs`, `timeUntilBreakDurationMs`, `hosStatusType` (scope **Read ELD Compliance Settings (US)**, cursor paged, `driverIds` filter). **No off-route event** — deviation is client-side (as planned). Limits 150 req/s token / 200 org, 429 + `Retry-After`.
- **FMCSA HOS (49 CFR 395.3)** — 11-h drive / 14-h shift / 60-70-h cycle all current (last change Sep 2020). **30-min break triggers off 8 h of DRIVING time (not shift)** — implement the trigger on cumulative drive time. A **≥30 consecutive min** non-driving fuel stop resets it (splash-and-go < 30 min does not). **`legalDrive = min(drive, shift, cycle)`** confirmed correct.

## B. External facts — CORRECTED / newly-flagged (change the plan)
- **[COST — UNVERIFIED, do not commit the ~$20/mo] (Phase 0):** HERE's public pricing no longer exposes clean per-transaction routing numbers; free-tier size (5k vs 30k/mo — sources conflict) and whether **truck routing bills as "advanced" transactions** are both unconfirmed. Verify in the HERE console/quote before forecasting. Volume (~9k/mo) is trivially fine on any tier.
- **[HERE Base Plan LICENSE — new constraint]:** the Base Plan **excludes route/stop *optimization*** (reordering destinations) and asset-tracking/telematics use. Our solver inserts fuel stops along a **fixed dispatcher-ordered route** = plain point-to-point routing → **within terms**. **Do NOT add multi-stop destination-sequence optimization** without HERE Tour Planning or a different license. Documented as a hard boundary.
- **[IFTA — savings framing correction]:** "buy in low-tax states" does **NOT** cut an interstate carrier's fuel *tax* — IFTA reconciles tax by **miles driven per state**, crediting pump tax already paid. The **only real routing lever is the lowest NET / tax-adjusted BASE price** (rack + margin), plus the negotiated discount. **California avoidance is still justified — but by real BASE-cost premium** (CARB diesel spec, LCFS, cap-and-trade), not by tax. **Change:** the report + backtest metric must measure **net/base-price** savings and must not claim tax savings. This makes the routing lever even more modest than "cheapest pump price" implies — reinforce the honest expectation.
- **[Team drivers — Samsara limitation]:** there is **no first-class co-driver/"isTeam" field**; `driver-vehicle-assignments` resolves to a **single** driver per vehicle. **Change:** default to **single-driver HOS (safe, never over-promises range)**; expose an optional **dispatcher "team + 2nd driver" override** in the plan form that widens combined availability. Do not silently assume a team.
- **[HOS enum]:** verify `hosStatusType` sleeper value spelling (`sleeperBerth` vs `sleeperBed`) against a live response in Phase 0 before hard-coding.
- **[@here/flexpolyline]:** official but low-activity (last tags ~2021). **Vendor/pin it** (or self-decode — the format is simple) so a decoder gap can't block us.
- **[Station data source priority]:** OSM **undercounts** US truck stops and has unreliable diesel/DEF/store-number tags. **Change:** primary source = **Pilot's official "Download All Locations"** export (`locations.pilotflyingj.com`, has store #, lat/lng, diesel/DEF lanes) as system of record; OSM/Overpass (**query both `Q1434601` Pilot Flying J AND `Q64130592` Flying J**) only as a supplement/cross-check. **ONE9 has no reliable Wikidata QID** — source ONE9 from Pilot's own directory. Public posted prices exist but are **retail ≠ net** — the daily email stays authoritative.
- **[CA boundary geometry]:** use the **US Census cartographic boundary file** (`cb_YYYY_us_state_500k`, generalized) for polyline-vs-CA crossing tests — not raw TIGER/Line (coastline over-detailed) and not Natural Earth (too coarse near the line).

## C. Internal repo verification — what we can reuse (CONFIRMED) and the GAPS
**Reusable (verified in repo):**
- `lib/samsaraHttp.ts` — rate-limited, honors 429 `Retry-After`, exponential backoff. ✔
- `services/jobs.ts` + `services/samsaraScheduler.ts` — ledger + tiers. ✔
- **Forward geocoding EXISTS** — `services/geocode.ts` `lookup()` hits Nominatim (`GEOCODE_URL`, `countrycodes=us,ca`). **Reuse/generalize it for dispatcher-typed origin/dest** (or HERE geocode). Not a blocker. ✔
- `vehicles.tank_capacity_gal` + `monitored_tank_capacity_gal` + `observed_max_fill_gal` + `baseline_mpg`. ✔
- `trailers.is_reefer` + `reefer_tank_capacity_gal`. ✔
- EFS import carries `price_per_gal` per transaction (QA cross-check). ✔

**GAPS (must be built — folded into the phases):**
- **[GAP-1 — per-truck HERE profile MISSING] (Phase 1 migration):** `vehicles` has **no** height/length/width/axle_count/empty_or_gross_weight/hazmat-capable/tunnel-category. Add these columns (+ `trailers.length` for combined length), with **org defaults in `route_fuel_settings`** when a truck's value is unknown. Required for correct hazmat/height-legal routing.
- **[GAP-2 — per-LOAD inputs MISSING, cannot be inferred] (Phase 5 form → Phase 2 routing):** hazmat class + gross weight are **per shipment**; there is **no loads/orders table**. The dispatcher plan form MUST capture, per request: **load gross weight** (or "assume ≤80k"), **hazmat class** (dropdown → HERE enum), and **tunnel category**. Without these the hazmat route (a locked requirement) is wrong. This is the single most important build addition from the audit.
- **[GAP-3 — fuel-level smoothing NOT found] (Phase 0 confirm → Phase 3):** grep found no reusable 7-point median / fuel-smoothing code despite the plan assuming reuse. **Confirm it exists; if not, build it** — it's a trivial pure function (7-point rolling median + post-fill distrust window), fully testable. Do not assume reuse.
- **[GAP-4 — DEF still open] :** decide plan-DEF vs driver-responsibility (unchanged open item).

## D. Phase 0 checklist (updated by this audit) — the go/no-go gate
Run against the **real Silvicom Samsara token** and the **HERE console** before writing solver code:
1. **`fuelPercents` coverage** — % of active trucks returning a fuel level, and its quantization (how coarse). Trucks without it → EFS-fallback or excluded (decide).
2. **HOS clocks** — % of drivers with fresh clocks; confirm the four `*DurationMs` fields + `hosStatusType` **enum spelling** on a live response.
3. **HERE console** — create key; confirm truck route + section-polyline decode + forward geocode; **read the actual transaction category + free-tier + overage price for truck routing** (kills the cost assumption).
4. **Pilot daily email** — confirm columns, that prices are **net**, per-location, and a **row-count completeness** baseline.
5. **Vehicle-profile data availability** — do we have (or can the fleet provide) per-truck dimensions/axles/weight + hazmat capability? If not, org defaults + per-load form inputs (GAP-1/GAP-2).
6. **`tank_capacity_gal` / `baseline_mpg` populated** for the active fleet (sparse data → widen reserve / low-confidence).

**Sources (2026-07):** HERE — docs.here.com/routing/docs/routing-v8-truck-routing, geocoding-and-search/docs/geocode, here.com/get-started/pricing + /base-plan-restrictions, npm `@here/flexpolyline`. Samsara — developers.samsara.com /reference/getvehiclestatsfeed, /reference/gethosclocks, /docs/rate-limits, /reference/getdrivervehicleassignments; kb 360037502312. FMCSA — ecfr.gov 49 CFR 395.3, fmcsa.dot.gov HOS summary + 30-min-break guidance. IFTA — iftach.org; CA base cost — CARB/LCFS/cap-and-trade (Stillwater, RMI). Stations — locations.pilotflyingj.com (Download All Locations), Wikidata Q1434601/Q64130592, Census cartographic boundary files.

## E. Phase 0 — live results on the Silvicom token (2026-07-15, first pass)
- **HOS: fully available — 100%** of 1,081 drivers return `drive/shift/cycle/timeUntilBreak`. Field shape confirmed exactly: `clocks.drive.driveRemainingDurationMs`, `clocks.shift.shiftRemainingDurationMs`, `clocks.cycle.cycleRemainingDurationMs` (+ `cycleStartedAtTime`, `cycleTomorrowDurationMs`), `clocks.break.timeUntilBreakDurationMs`; plus `violations{...}` and **`currentVehicle{id,name}`**.
- **`hosStatusType` enum (confirmed):** `driving, onDuty, offDuty, sleeperBed, personalConveyance` (it's `sleeperBed`, not `sleeperBerth`).
- **Team detection is possible after all:** group HOS clocks by `currentVehicle.id` among active drivers → 2+ = a team. Upgrades GAP from "unsupported" to **"inferable via `currentVehicle`"** (still expose a dispatcher override). `currentVehicle` also gives the driver↔truck link for pulling the right driver's HOS when planning a truck.
- **Fuel level: the response field is `fuelPercent` (singular)** even though the request type is `fuelPercents`; sample truck reported `fuelPercent.value = 68` with a fresh timestamp — so fuel level IS present. (First probe pass under-reported to 0% due to reading the plural key; probe corrected, coverage % re-measured next pass.)
- GPS: 100% present, ~73% fresh ≤30 min (stale = parked trucks). 186 vehicles, 1,081 drivers (large driver pool).

**Phase 0 VERDICT (2026-07-15): GO.** Corrected re-run: **fuel level 99%** (185/186), **1% quantization** (high-res — tighter smoothing/reserve OK), HOS 100%, GPS 100%, **0 active teams** (single-driver default is the norm; team override deferrable). Live data supports planning from truck state directly. Remaining (non-blocking for Phase 1 schema): HERE console cost/tier check; one Pilot daily-email format sample. Open micro-decisions carried into Phase 1: the **1 fuel-less truck** and any future no-fuel trucks → EFS-fallback (bounded) or exclude; **DEF** plan-vs-driver.

---

# Route fidelity to Samsara — research + strategy (2026-07)

Goal: our independently-computed HERE truck route should match the route Samsara actually has the driver drive, so the fuel corridor is right. Findings (sources in the agent report):

- **Samsara's maps are HERE-powered** (HERE ↔ Samsara partnership, Aug 2025). So our HERE v8 `transportMode=truck` route shares Samsara's underlying road network + truck-restriction data → strong CORRIDOR-level agreement by default. This validates the recompute-with-HERE approach.
- **But not turn-by-turn identical:** Samsara layers a proprietary traffic/telemetry model on top, and some drivers navigate via Google Maps (a driver-selectable setting). So the realistic, industry-standard target is **corridor / primary-highway match** (what PC*Miler/ProMiles rely on), not path identity — which is all fuel planning needs (truck stops sit on the interstates both engines pick).
- **Levers, in order of value:**
  1. **Match the profile, not the path** — real truck profile (dims/axles/weight/**hazmat**/tunnel) + `routingMode=fast` + tolls/ferries allowed. DONE: profile + hazmat + `routingMode=fast` are set; this maximises shared restriction behaviour.
  2. **Alternatives + union** — request HERE `alternatives=3` + `routeLabels=true`; take the UNION of corridor stations across the alternatives so an ambiguous highway choice never drops a station on the corridor Samsara actually chose. ROADMAP (Phase 6): needs per-corridor projection so a station on an alternate keeps a correct along-route position — not a drop-in, done right in the live-tracking phase.
  3. **Breadcrumb calibration** — after/along the trip, pull `GET /fleet/vehicles/stats/history` (gps) or `/fleet/vehicles/locations/history`, map-match the driven breadcrumbs to recover the actual highways, and (a) confirm the chosen corridor or (b) pick the HERE alternative whose labels match. This is the only ground truth (Samsara exposes no planned-route geometry) and is the Phase 6/7 calibration loop. Also detects the Google-Maps-hand-off drivers.
- **Honest ceiling:** corridor-level match + breadcrumb calibration. Turn-by-turn parity is not achievable (proprietary traffic layer + per-driver nav app).

## Phase 2 — LIVE VERIFIED (2026-07-15)
HERE probe on the real key (Chicago→Kansas City truck route): HTTP 200; response shape `routes[0].sections[].{polyline, summary.length, summary.duration}` matches `parseHereRoute`; decoder produced 4,369 points, **525.2 mi / 8.1 h**, endpoints EXACT (41.8781,-87.6298 → 39.0997,-94.5786). Routing integration + Flexible Polyline decoder **confirmed against live data**. Remaining unverified live shape: Samsara `/stats/history` fuelPercents array (snapshot shape was Phase-0-verified; low risk — confirmed on the first real plan).
