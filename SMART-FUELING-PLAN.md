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
