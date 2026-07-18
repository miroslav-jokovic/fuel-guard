# Planned Fueling — Implementation Plan

**Feature:** A daily, per-truck fuel plan. FuelGuard reconstructs each truck's route, finds the Pilot/Flying J stations along it, and suggests exactly where to fuel and how many gallons — optimized for lowest net cost within the truck's range, reserve, and driver-hours limits. Output is a **read-only report/page** (no write-back to Samsara). Suggestions **auto-recalculate** when a truck deviates from the assumed route.

**Status:** Research verified against live official docs (July 2026). **Reviewed adversarially — see `PLANNED-FUELING-RISK-ANALYSIS.md` for the full assumption/blocker/gap register.** Critical safety fixes from that review are folded in below (emergency sizing subordinate to safety, INFEASIBLE state, HOS min-of-clocks, detour/idle burn, CA edge cases, measurement loop as launch gate). Remaining open items and business decisions are in §12. Supersedes the earlier `planned-fueling-on-route-plan.md` and `PLANNED-FUELING-PILOT-FJ-SPEC.md`.

**Locked decisions (confirmed for our fleet):**
- Fleet profile: **mixed reefer + dry van**, **mostly hazmat**, **US + Canada (≈99.9% US)**, **team drivers present**, max registered gross **80,000 lb**.
- Scope: **Pilot network** (EFS restricted to it). **Preferred** (discounted) = Pilot + Flying J outside California. **Emergency-only** = ONE9 and any CA station — used only when safety forces it, target 50 gal (safety-sized, §8.1).
- Routing: **HERE Routing API v8, `transportMode=truck`**, with the **full vehicle profile including hazmat class + tunnel category** — required, because hazmat restrictions change the legal route (§6). We compute our own truck-legal route (industry standard; Samsara exposes no path).
- Prices: the **Pilot/FJ daily email**, which **already contains net prices** (our deal is a flat discount) — rank directly on net; EFS is a QA cross-check, not required for calibration.
- Consumption: model **reefer/idle burn** (mixed fleet — use the existing `trailers.is_reefer` flag), not miles-only.
- HOS: handle **team drivers** (combined availability) and both **US and Canadian rulesets** (drive off the clocks Samsara returns).
- Delivery: **read-only report** — no Samsara write-back.
- Cost target: **~$20/month** for our fleet (HERE truck routing; else $0 on existing infra).
- **Productization intent:** build every fleet-specific rule as **per-org configuration**, not hardcoded, so this can be sold to other carriers (see §14).

---

## 1. What we are building

For each active truck with an assigned Samsara route:
1. Read the load's start, waypoints, and destination from Samsara.
2. Rebuild the truck-legal driving route with HERE v8 (close to what Samsara Commercial Navigation will have the driver drive).
3. Find the Pilot/FJ stations within a corridor of that route.
4. Read the truck's current fuel level, MPG, position, and the driver's remaining hours from Samsara.
5. Run the fueling algorithm: pick the station(s) and gallons that minimize total net cost while never dropping below the reserve floor, respecting tank capacity, range, and the 30-minute HOS break.
6. Show it as a table — one row per suggested stop (station, exit, gallons, est. net price, predicted arrival fuel %, detour, HOS note).
7. Track the truck live; if it leaves the assumed route, recompute and update the suggestions.

Nothing is written back to Samsara — the dispatcher/driver reads the plan and acts.

---

## 2. Architecture at a glance

```
Samsara ──> route (stops) ─────────────┐
Samsara ──> vehicle GPS + fuel% ────────┤
Samsara ──> HOS clocks ─────────────────┤
                                         ▼
                          [Route reconstruction]  HERE v8 truck route ─> decoded polyline (cached)
                                         │
Pilot daily email ─> fuel_prices ────────┤
EFS transactions  ─> net-price calib ────┤
Static Pilot/FJ locations ───────────────┤
                                         ▼
                          [Corridor match]  stations within ~2.5 mi of polyline
                                         │
                                         ▼
                          [Fuel algorithm]  greedy min-cost + reserve + HOS
                                         │
                                         ▼
                          [Daily report]  table per truck  ──(live GPS deviates)──> recompute
```

All jobs run on the existing scheduler + jobs ledger; all reads go through the existing rate-limited `samsaraHttp.ts`.

---

## 3. Verified facts (all confirmed against official docs, July 2026)

### 3.1 Samsara — reading the route, truck, and driver
- **Routes:** `GET /fleet/routes` — 5 req/s; `startTime`/`endTime` required (RFC 3339); cursor pagination (`limit` ≤512). No driver/vehicle query filter — list a time window and filter client-side on the route's `driver`/`vehicle`. `GET /fleet/routes/{id}` — 25 req/s.
- **Route shape:** ordered `stops` array, **minItems 2**. **No `destination` field** — origin = first stop, destination = **last stop**, middle = waypoints. Each stop's location is **one of**: `address { id, name }` (reference only — resolve coordinates via `GET /addresses/{id}`, which returns `latitude`/`longitude`/`geofence`; cache in existing `geocode_cache`), or `singleUseLocation { address, latitude, longitude }` (inline lat/lng). Each stop also carries `plannedDistanceMeters` — Samsara's **planned road distance from the previous stop** (accurate leg mileage, no routing call needed).
- **No road geometry in Samsara (VERIFIED)** and **no PATCH used** — we recompute the path ourselves (§6) and never write to Samsara.
- **Live location + fuel:** `GET /fleet/vehicles/stats?types=gps,fuelPercents` (snapshot) and `GET /fleet/vehicles/stats/feed` (cursor feed; poll no faster than **every 5 s**). `gps` returns lat/lng, heading, speed, time. **`fuelPercents` is RAW/UNSMOOTHED via the API** (Samsara KB: the dashboard's 7-point rolling median "is not applied" to the stats API) — we smooth it ourselves. **Tank capacity is not in the API** — we store `vehicles.tank_capacity_gal`.
- **Driver hours (HOS):** `GET /fleet/hos/clocks` — scope **Read ELD Compliance Settings (US)**; filter with `driverIds`; cursor pagination. Fields (durations in ms, nested): `clocks.drive.driveRemainingDurationMs`, `clocks.shift.shiftRemainingDurationMs`, `clocks.cycle.cycleRemainingDurationMs`, `clocks.break.timeUntilBreakDurationMs`, and `currentDutyStatus.hosStatusType` (`driving|onDuty|offDuty|sleeperBed`). Values reflect last ELD sync — may be stale if the driver tablet is offline (CONFIRM freshness via GPS timestamp).
- **No off-route / deviation event exists (VERIFIED).** Route signals are stop-centric only: `GET /fleet/routes/audit-logs/feed` (GA — arrivals/departures/skips/ETA/resequence) and `RouteStop*` webhooks (all Beta). **Route deviation must be computed client-side** by comparing live GPS to our own HERE polyline (§7).
- **Auth/limits:** Bearer token, 150 req/s per token / 200 req/s per org, 429 + `Retry-After` (handled by `samsaraHttp.ts`). All our calls are reads.

### 3.2 HERE Routing API v8 — rebuilding the truck route
- **Request:** `GET https://router.hereapi.com/v8/routes?transportMode=truck` with `origin=lat,lng`, one or more `via=lat,lng` (intermediate stops, repeatable), `destination=lat,lng`, `return=polyline,summary`, `apiKey=…`. Truck restrictions (low bridges, weight/height/hazmat) apply only when vehicle params are supplied, in `vehicle[...]` form: `vehicle[grossWeight]` (kg), `vehicle[height]`/`vehicle[width]`/`vehicle[length]` (cm), `vehicle[axleCount]`, `vehicle[weightPerAxle]` (kg), `vehicle[shippedHazardousGoods]`, `vehicle[tunnelCategory]`. (Units per the truck-routing guide: weights kg, dimensions cm.)
- **Geometry:** `return=polyline` yields an encoded **Flexible Polyline** per section. Decode with the official `@here/flexpolyline` npm library (Python/Java also available) → lat/lng list. This decoded polyline is both the fuel corridor and the reference line for deviation detection.
- **Pricing:** truck routing is HERE's **"Advanced" tier** — reported ~**5,000 free transactions/month, then ~$2.50/1,000** (exact figures CONFIRM in the HERE console; the tier classification is consistent across sources). At ~300 routes/day (~9k/mo), budget **≈$10–20/mo**. Caching (§6) keeps calls well below the raw request count.
- **Multi-waypoint:** supported via repeated `via=` — covers multi-stop loads.

### 3.3 Pilot / Flying J — locations and daily prices
- **Locations (static):** load once from OpenStreetMap/Overpass (`brand:wikidata=Q1434601` + ONE9 affiliate brands) or the Pilot "Download All Locations" export; ~900 sites. Refresh quarterly. Stored in `fuel_stations` with lat/lng + exit + diesel-lane flag.
- **Prices (daily email — primary source, NET):** the Pilot/FJ daily email **contains net prices** (our deal is a flat discount), per location. We parse it each morning and upsert `fuel_prices.net_price`; the solver ranks directly on net. (Still validate row completeness per email, §risk-analysis H8.)
- **EFS as QA cross-check:** imported EFS transactions confirm the email's net matches what we actually paid; a divergence flags a pricing problem but isn't needed for normal operation.

### 3.4 Fuel-purchase algorithm & HOS rule
- **Fixed-route fuel purchasing** is a well-studied problem (Khuller/Malekian/Mestre 2007; Lin et al. 2007). Note the classic *provably optimal* greedy assumes **variable** purchase amounts (buy just enough to reach a cheaper station). Our policy forces **full fills** (rule 4), so we solve the *full-fill station-selection* variant instead — this is a deliberate, driver-friendly policy choice, **not** the theoretical cost optimum, and it carries a small, bounded cost penalty (savings are low-single-digit % regardless). We do not claim provable optimality under full-fill; we test correctness empirically (§10).
- **HOS 30-minute break:** 49 CFR 395.3(a)(3)(ii) — no driving past **8 cumulative hours** of driving without a ≥30-min break; **on-duty-not-driving (fueling) satisfies it.** So a fuel stop timed near the break due-point carries near-zero time cost.

### 3.5 Existing FuelGuard foundation we reuse (verified in repo)
Rate-limited Samsara client (`apps/api/src/lib/samsaraHttp.ts`), tiered scheduler (`services/samsaraScheduler.ts`), jobs ledger with no-overlap index (`services/jobs.ts` + `0027_jobs.sql`), geocode cache (`services/geocode.ts` + `0018`), `vehicles.tank_capacity_gal`/`baseline_mpg` (`0003`), EFS import pipeline (`0011`), `audit_logs`, per-org `integration_credentials` (`0012`), AI verification. Fuel-level smoothing from the fueling-time-precision work should be reused, not rebuilt.

---

## 4. Data model (new migrations, start at 0033; repo `NNNN_description.sql` convention, existing RLS org-scoping)

| Table | Purpose / key columns |
|---|---|
| `fuel_stations` | Pilot/FJ/ONE9 registry: `brand`, `store_number`, name, lat/lng, address, **`state`** (for CA-avoidance), exit, `has_diesel`. Static, quarterly refresh. Unique (brand, store_number) |
| `fuel_prices` | `station_id`, `product` (diesel/def), `posted_price`, `net_price`, `source` (pilot_email/efs), `observed_at`. Append-only; latest-per-station view |
| `fuel_discount_rules` | Per org per chain: `type` (retail_minus/cost_plus/none), `cents_off`, calibration stats. One row for Pilot in v1 |
| `samsara_routes` (+ `samsara_route_stops`) | Local mirror of pulled routes: samsara ids, driver/vehicle, stops with coords + `plannedDistanceMeters`, `synced_at` |
| `route_geometries` | Cached HERE polyline per (origin, waypoints, destination, vehicle-profile, engine-version); decoded lat/lng + total meters |
| `fuel_plans` | One per (route, vehicle) run: input snapshot (fuel %, tank, MPG, HOS, prices used), `status` (fresh/stale/recomputed), est. total cost, est. savings vs. naive, `computed_at` |
| `fuel_plan_stops` | Suggested stop (a report row): `station_id`, gallons, price used + source + age, predicted arrival fuel %, detour miles, HOS-break flag, sequence, `superseded_by` (on recompute) |
| `route_fuel_settings` (org) | Reserve floor %, corridor miles, min purchase gal, MPG safety factor, deviation threshold, price TTL, vehicle truck-profile defaults. **Policy rules:** `always_fill_full` (default true), `avoid_states` (default `['CA']`), `avoid_brands` (default `['one9']`), `emergency_fill_gallons` (default 50) |

---

## 5. The pipeline (jobs on the existing scheduler)

1. **Route sync (~10 min tier):** poll `GET /fleet/routes` (window now−12 h → now+3 d); mirror to `samsara_routes`; resolve each stop's coordinates (inline or `GET /addresses/{id}` → cache); diff to find new/changed routes with an assigned vehicle. **If a vehicle has no usable route/destination, produce no plan for it (explicit "no route" state) — never fabricate a destination.** A route created inside the poll gap can leave a truck's first leg briefly unplanned — use the audit-logs feed / a fast first-plan path to shorten that gap.
2. **Route reconstruction (§6):** for each such route, call HERE v8 truck routing (origin → via → destination, with the vehicle's truck profile); decode + cache the polyline in `route_geometries`.
3. **Snapshot:** `GET /fleet/vehicles/stats?types=gps,fuelPercents` (smooth fuel %; gallons-on-hand = smoothed % × `tank_capacity_gal`) and `GET /fleet/hos/clocks` (driver's remaining drive time + time-until-break). Miles-to-go from the HERE route (and cross-checked with summed `plannedDistanceMeters`).
4. **Corridor match:** buffer the polyline by `corridor_miles` (default 2.5); candidate = `fuel_stations` in the buffer that are ahead of the truck's current position along the route.
5. **Fuel algorithm (§8):** apply policy rules (full fills; avoid CA + ONE9; HOS; 50-gal emergency cap) and select the stops; write `fuel_plans` + `fuel_plan_stops`.
6. **Report (§9):** render the per-truck table.
7. **Live tracking + recompute (§7):** poll GPS; if the truck deviates beyond threshold, recompute route + suggestions and mark the old plan `recomputed`.
8. *(optional)* **Accuracy loop:** reconcile against the EFS transaction when it lands → calibrate discount, feed savings/adherence report.

---

## 6. Route reconstruction (HERE v8)

We compute our own truck-legal route because Samsara exposes no path and its proprietary, dynamically-rerouted path can't be fetched or exactly reproduced. This is exactly how PC*Miler/Expert Fuel and ProMiles work.

- **Inputs:** origin = truck's current GPS (or first stop before departure); `via` = intermediate stops; destination = last stop. **Full vehicle + load profile** from the truck/trailer/load records: weight (up to 80,000 lb), height/length/axles, and — critically for our fleet — **hazmat class** (`vehicle[shippedHazardousGoods]`) and **tunnel category** (`vehicle[tunnelCategory]`). Hazmat is required, not optional: without it HERE returns a non-hazmat route that diverges from the driver's actual hazmat-legal path, breaking corridor accuracy. Trailer type (reefer/dry) is carried for consumption modeling (§8.2). Fields default from `route_fuel_settings` only when genuinely unknown.
- **Output:** decoded Flexible Polyline (via `@here/flexpolyline`) + total distance. Cache per (stop-set, vehicle profile, engine version) — routes rarely change shape, so most days are cache hits and HERE calls stay well under the free/cheap tier.
- **Fidelity:** on interstate legs (where fueling happens) HERE and Samsara pick the same highways; Pilot/FJ sit on those highways, so the candidate set matches what the driver passes. Residual risk (Samsara choosing a different one of two plausible interstates) is handled by live-GPS recompute (§7) and by surfacing the top few candidates rather than one.

---

## 7. Live tracking & reroute detection

Samsara has **no off-route event**, so we detect deviation ourselves:
- Poll `GET /fleet/vehicles/stats/feed?types=gps` on a planning-appropriate cadence (e.g. every few minutes for active routes — far below the 5 s floor, to conserve quota).
- Compute the perpendicular distance from the live point to the cached HERE polyline. If it exceeds `deviation_threshold` (e.g. > corridor width sustained for N minutes / M miles), the truck has left the assumed route.
- On deviation: recompute the HERE route from the **current GPS → destination**, re-run the corridor match and fuel algorithm, mark the prior `fuel_plans` row `recomputed`, and update the report with fresh suggestions.
- Progress along the (non-deviated) polyline also advances "miles-to-go" and drops candidate stations the truck has already passed — so the plan naturally tightens as the day goes on.
- The route audit-logs feed (GA) can additionally trigger a refresh on stop arrival/departure; it's an accelerator, GPS is the source of truth.

---

## 8. Fueling rules (policy layer) + algorithm

### 8.1 Station tiers, business rules, and priority order

**Two station tiers:**
- **Preferred** = Pilot + Flying J **outside California** — these carry our negotiated discount. Normal planning uses only these.
- **Emergency-only** = **ONE9** (in the Pilot network but **no discount**) and any Pilot/FJ **inside California**. Used only when safety forces it, and then capped.

**Rules, strict precedence (higher wins on conflict):**
1. **Safety — never below reserve** (default 20% usable). Non-negotiable.
2. **HOS legality.** A suggested stop must be legally reachable. **Legal remaining driving time = `min(drive, shift, cycle)`** — never `driveRemaining` alone, because the 14-h shift or 60/70-h cycle usually binds first. The 30-min break (`timeUntilBreak`) is a *segmenting* constraint: it forces a stop after that much driving and consumes shift wall-clock — a fuel stop placed just before it is ideal, one placed after (assuming non-stop driving) is illegal. Convert time→distance with a **conservative** average speed (well below posted, reserve-padded). Use whatever clocks Samsara returns for that driver's ruleset (short-haul/other rulesets differ); never bank on split-sleeper or adverse-driving as available capacity. Never suggest an unreachable or illegal stop.
3. **Prefer discounted, non-CA stations.** Plan on preferred stations only; **avoid California** and **avoid ONE9**. Detect CA entry/exit by testing the polyline against the CA boundary; each station carries a `state` flag; ONE9 by `brand`. CA handling has three cases (not just the simple one): **(a) short traverse enterable from outside** → top off at the last preferred station before the border, cross on one tank, refuel after exit; **(b) in-CA distance exceeds one-tank range, or the truck starts in CA** → planned in-CA fill(s) are unavoidable; accept the cost, never strand (this uses CA stations by necessity, flagged); **(c) route crosses the CA line multiple times** → apply the pre-border top-off logic per crossing segment. Safety (rule 1) governs all three.
4. **Fill to the top.** Every preferred stop is a **complete fill** — no partial fills (turns the solver into station selection, §8.3).
5. **Best price.** Among preferred, reachable options, choose the cheapest net price.

**Emergency exception (the only use of CA/ONE9 and the only exception to full-fill):** if no preferred station is reachable before the truck would hit its reserve floor, the planner permits an emergency fill at the nearest reachable emergency-only station — a ONE9 or a CA Pilot/FJ. **Sizing is subordinate to safety:** the fill is sized to reach the next reachable station **plus reserve**. The 50 gal (`emergency_fill_gallons`) is a *soft cost target* to minimize spend at a non-discounted/CA site — it is used only when it is sufficient to reach the next station safely; if 50 gal cannot bridge the gap, buy enough that it can. Safety (rule 1) always wins over the cost cap. Every emergency stop is flagged in the report.

**INFEASIBLE state (hard alert, never silent):** if **no** station of any tier (preferred *or* emergency) is reachable before the reserve floor — a true fuel desert or a truck already too low — the planner does **not** emit a best-guess stop. It raises a loud `INFEASIBLE — no reachable fuel, driver must act now` alert on the report and via the org's alert channel. This is the most safety-critical branch: an unreachable suggestion is worse than an honest "cannot plan."

### 8.2 Inputs
- **Fuel level:** own 7-point rolling median over raw `fuelPercents` (reuse the fueling-time-precision smoothing); distrust readings within ~60 min of a fill; ±5–10% sensor margin. Gallons-on-hand = smoothed % × usable capacity (default 95% of rated).
- **Consumption:** `vehicles.baseline_mpg` refined by the Samsara fuel-energy report, with a **quantified, calibrated** safety factor. **Model non-mileage burn separately:** idle burn (gal/h × idle hours), and **reefer burn (~0.5–1 gal/h) when the assigned trailer is a reefer** (existing `trailers.is_reefer`) — whether the reefer draws from the tractor tank or a separate tank is a per-truck config. Dry vans use miles+idle only. Auto-widen reserve in mountain/winter corridors.
- **Detour fuel counts:** the round-trip detour to a candidate's pump is in the range/reserve feasibility check, not just display.
- **Weight-legal fills:** a full fill adds ~1,000+ lb; cap the fill so gross stays ≤ 80,000 lb (or org max) given the load's gross weight. If current gross weight isn't in the system, assume near-max for loaded hazmat/heavy and cap conservatively, flagging that the driver must verify at the scale.
- **Net price (simplified):** the daily email **already contains net prices** (flat discount deal), so rank directly on `net_price`. EFS actuals are a QA cross-check only. *(Discount model stays configurable per org — flat / retail-minus / cost-plus / per-site — for productization, §14.)*
- **HOS:** legal remaining = `min(clocks.drive, clocks.shift, clocks.cycle)`; `clocks.break.timeUntilBreakDurationMs` as segmenter. **Team drivers:** when the truck has two drivers, the truck can run well beyond one driver's clock (they swap) — detect the team assignment and use combined availability, while still respecting each driver's individual legality. Use whatever ruleset (US/Canada/short-haul) Samsara returns per driver.

### 8.3 Solver — full-fill station selection
Because every stop is a full fill (rule 4), the solver does not decide gallons — it decides **which stations to stop at** so that: consecutive fills are within tank range minus reserve (rule 1); California is crossed on one tank with a pre-border top-off (rule 3); and total spend is minimized by preferring cheap stations and never being *forced* to fill at an expensive one within range (rule 5). With a single chain and stops ordered along the route this is a short, provable pass: walk the route, and whenever the tank would drop to reserve before the next *cheaper-or-equal* reachable station, insert a full fill at the cheapest reachable station before that point (and always insert one at the last non-CA station before a CA leg). Min purchase respects the Pilot loyalty threshold (50 gal) — trivially satisfied by full fills.
- **HOS-aware placement:** if a 30-min break falls due mid-route (`timeUntilBreakDurationMs`), prefer a fill near that point and treat its time cost as ~zero (fueling satisfies the break, 49 CFR 395.3); respect drive/shift remaining so the stop is reachable.
- **Output per truck:** ordered full-fill stop(s) + gallons each (= capacity − arrival level) + predicted arrival fuel % + est. total net cost + savings vs. a naive "fill wherever near-empty" baseline. Honest expectation: station selection saves low-single-digit % of fuel spend; the negotiated Pilot discount (via EFS) is the larger lever.
- **Edge cases, never silent:** no `fuelPercents` coverage (fall back to last EFS fill **within a bounded time window**, widen reserve, low-confidence badge; **abstain** if the last fill is too old to trust); no preferred station reachable (§8.1 emergency, safety-sized); **nothing reachable at all (§8.1 INFEASIBLE hard alert)**; in-corridor station with no price row (define: use regional fallback price + flag, don't silently drop); route <2 stops / no route / unassigned (explicit "no plan" state); prices stale past TTL or email row-count drop (visible warning); HOS stale/offline (gate on GPS liveness, assume limit due soon, flag).

---

## 9. Report / UI (Vue, `features/fueling/`)

- **Fleet fuel page:** table of active trucks with a plan status chip (fresh/stale/recomputed) and est. savings.
- **Per-truck plan:** the suggestion table (station, exit, gallons, est. net price + age, predicted arrival fuel %, detour mi, HOS-break flag); a fuel-level projection along the route; optional map (free MapLibre + OSM) drawing the HERE polyline, corridor, candidates, and the truck's live position.
- **Settings:** Pilot discount rule, planning parameters (reserve %, corridor, deviation threshold, MPG factor, price TTL), truck profile defaults, provider health (HERE key, daily-email parse status).
- **Reports:** monthly realized savings, plan adherence (planned vs. actual fueling from EFS), price-source freshness.

---

## 10. Modular task breakdown (small, dependency-ordered, ~80% reuse)

| # | Module | Reuses | Notes |
|---|---|---|---|
| M1 | Migrations 0033–00xx (§4 tables + RLS) | migration convention | pure schema |
| M2 | Station registry: Overpass load → `fuel_stations`, quarterly refresh | jobs, geocode cache | static data |
| M3 | Daily price ingest: parse Pilot morning email → `fuel_prices`; EFS net-price calibration | EFS import, jobs | confirm posted vs net |
| M4 | Route sync + address resolution → `samsara_routes` | scheduler, samsaraHttp, geocode cache | reads only |
| M5 | HERE v8 adapter: truck request → decode Flexible Polyline → cache `route_geometries` | — | ~$20/mo, cached |
| M6 | Corridor match: buffer polyline, candidate stations ahead of truck | — | geometry math |
| M7 | Fuel algorithm: smoothing + greedy solver + HOS-aware placement → `fuel_plans` | fuel-precision smoothing | property-tested |
| M8 | Live tracking + reroute recompute | GPS feed, M5–M7 | client-side deviation |
| M9 | Vue report/UI + settings | web app patterns | read-only |
| M10 | **Accuracy/measurement loop (LAUNCH GATE — not optional):** EFS reconciliation, predicted-vs-actual arrival fuel%, emergency-fill rate, near-reserve-breach rate, station-passed-vs-suggested mismatch | EFS import, recon | required before drivers rely on plans |

Whole feature is the low-risk reads-and-report path — no Samsara write path, so no PATCH race tests. **But read-only ≠ automatically safe:** a wrong *suggestion* a driver follows can still strand a truck, so correctness is verified against physics, not just the solver's own math.

**Verification gates:**
- **Solver invariants (property tests):** never plans below reserve *including detour + idle/reefer burn*; respects capacity and legal weight; INFEASIBLE fires when nothing is reachable.
- **Adversarial physical inputs (end-to-end tests):** biased/optimistic MPG, +10% sensor bias, fuel-desert corridors, closed/missing station, HOS where shift/cycle binds — the plan must degrade safely (widen reserve / emergency / INFEASIBLE), never emit an unreachable stop.
- **Golden routes** including CA-long, starts-in-CA, multi-crossing, and fuel-desert cases (not just "a handful").
- **Deviation detection** unit tests on synthetic GPS tracks (incl. wrong-highway divergence).
- **Backtest before launch:** replay historical routes + EFS actuals; report what the plan would have suggested and whether any truck would have stranded.
- **Dry-run period:** plans displayed as *advisory only*; ship to drivers only once predicted arrival-fuel error, mismatch rate, and near-reserve breaches are within target.

---

## 11. Cost

| Item | Cost |
|---|---|
| HERE truck routing (~9k/mo, cached) | **~$10–20/mo** (Advanced tier; confirm in console) |
| Pilot daily price email parse | $0 |
| EFS net prices | $0 |
| Station locations (OSM one-off) | $0 |
| Map tiles (optional, MapLibre + OSM) | $0 |
| Compute (existing scheduler/jobs/Supabase) | $0 |

**Total ≈ $20/month, all-in.** No routing server, no OPIS/ProMiles, no paid Pilot API. If HERE cost ever matters, self-hosted Valhalla drops routing to $0 (one small box) at the cost of slightly weaker off-interstate truck data.

---

## 12. Open items — see `PLANNED-FUELING-RISK-ANALYSIS.md` for full detail

**HARD DEPENDENCY — verify before building the solver:**
- **Do routes exist and are destinations meaningful?** Call `GET /fleet/routes` on the real token. Samsara routes are optional dispatch objects; a fleet may track GPS+HOS but never create routes, and the true destination can live in a stop's `notes` rather than the last stop. If routes are sparse/unreliable, we need a fallback trigger (plan from current GPS + provided destination). The pipeline must **degrade gracefully** to "no plan (no route)" rather than assume a destination.

**Business decisions — RESOLVED (2026-07-08):**
- Reefer: **yes, mixed reefer + dry van** → model reefer/idle burn per trailer. ✔
- Price basis: **daily email is net; flat discount** → rank on net directly. ✔
- Load weight: **80,000 lb max registered** → cap fills to ≤80k; conservative when live gross unknown. ✔
- Scope: **US + Canada (≈99.9% US); teams present; mostly hazmat** → hazmat routing required, team HOS required, Canada handled as secondary. ✔ *(DEF: still confirm whether we plan DEF or leave to driver.)*

**Confirm during build (non-blocking):**
- Pilot email exact columns/completeness; HERE truck tier numbers in console; HOS offline-staleness behavior (gate on GPS liveness); per-truck HERE vehicle profiles (or org defaults); EFS automated feed (optional upgrade).

---

## 13. Source appendix (verification links)

Samsara: developers.samsara.com — /reference/fetchroute, /reference/patchroute (not used), /docs/route-locations, /reference/getaddress, /reference/getvehiclestats, /reference/getvehiclestatsfeed, /reference/gethosclocks, /docs/capturing-live-route-progress-via-api, /docs/rate-limits; kb.samsara.com 360037502312 (fuelPercents median not applied to API). No off-route event (verified against event/webhook catalog + audit-logs feed).
HERE: docs.here.com/routing/docs/routing-v8-truck-routing, /routing-v8-route-geometry, /routing-v8-intermediate-waypoints; github.com/heremaps/flexible-polyline; npm @here/flexpolyline; here.com/get-started/pricing (Advanced tier; exact figures confirm in console).
Pilot/FJ: pilotcompany.com/fuel-prices, locations.pilotflyingj.com, Wikidata Q1434601; daily price email (our existing inbound).
EFS/WEX: existing FuelGuard import; net price per transaction.
Algorithm: Khuller/Malekian/Mestre ACM TALG 2011 (cs.umd.edu/projects/gas/gas-station.pdf); Lin et al. ORL 35(3) 2007. HOS: 49 CFR 395.3(a)(3)(ii) (ecfr.gov). Industry pattern (own-route + corridor): Trimble PC*Miler "POIs Along the Route" (2.5 mi default), ProMiles Fuel Opt.
Foundation (repo, verified): lib/samsaraHttp.ts, services/samsaraScheduler.ts, services/jobs.ts + 0027, services/geocode.ts + 0018, vehicles.tank_capacity_gal/baseline_mpg (0003), EFS import (0011), audit_logs, integration_credentials (0012), trailers/is_reefer (recent migrations).

---

## 14. Productization — building it multi-tenant so it can be sold

To sell this to other carriers, nothing fleet-specific may be hardcoded. Build **now** for our fleet, but behind these configuration seams so onboarding a new carrier is data, not code. Everything is per-org and RLS-scoped (existing pattern).

**Configuration axes (each per-org):**
- **Fuel networks & stations** — we ship Pilot/FJ/ONE9; the station registry and tier logic must accept other chains (Love's, TA/Petro, Casey's, etc.). Keep `fuel_stations` chain-agnostic; "preferred vs emergency" is a per-org rule, not a Pilot constant.
- **Price sources** — one `PriceSource` interface; we implement "daily email (net)". Others may need a different email format, a chain API, or a paid feed (OPIS/ProMiles). Make the parser per-org/pluggable.
- **Fuel-card program** — EFS for us; leave room for Comdata/WEX/others as the net-price/QA source.
- **Discount model** — flat for us; support retail-minus, cost-plus, and per-site tiers (the `fuel_discount_rules` table already allows this).
- **Rules engine** — reserve %, corridor width, avoid-states, avoid-brands, min purchase, emergency gallons, full-fill vs partial, MPG safety factor — all `route_fuel_settings`, no code changes to retune.
- **HOS rulesets** — US (incl. short-haul) and Canada; always drive off the clocks Samsara returns per driver rather than hardcoded limits, so new rulesets work automatically.
- **Trailer / cargo types** — reefer, dry van, tanker, flatbed; hazmat classes → both consumption and routing. Per-load, not per-org.
- **Vehicle profiles** — per-truck dimensions, tank config (single/dual/separate reefer tank), MPG, hazmat capability — needed for correct HERE routing and fill math.
- **Units & currency** — US customary + metric (Canada: L, km, CAD); store canonical (metric/UTC) internally, present per-org.
- **Telematics provider** — Samsara today; if sold to non-Samsara fleets, the route/GPS/HOS reads sit behind a provider interface (Motive/Geotab are future adapters).
- **Multi-tenancy & cost** — per-org HERE API key or metered usage attribution (routing cost is the one per-org variable cost — track it for billing).

**Now vs later:** in-scope for v1 = our fleet's config values populated (Pilot/FJ, EFS, flat net, US+Canada, reefer/dry, hazmat, teams). Later (only if we sell) = additional network/price/card/telematics adapters. The design cost of the seams is small; retrofitting them after hardcoding is large — so build the interfaces now, implement only our adapters.
