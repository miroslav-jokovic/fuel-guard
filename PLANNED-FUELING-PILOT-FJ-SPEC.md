# Planned Fueling (Pilot / Flying J) — Precise Build Spec

**Status:** Verified against live official docs 2026-07-06. Assumption-free — every fact below is either VERIFIED against an official source (cited §11) or explicitly marked CONFIRM-LATER (non-blocking for coding).
**Scope decision:** Pilot / Flying J / ONE9 only (single fuel network — EFS is already restricted to it). No multi-chain, no paid feeds, no routing server, no maps engine.
**Delivery decision (rev. 2):** **Read-only report.** We do NOT write anything back to Samsara (no PATCH, no route edits, no driver-app push). The output is a page with a table of suggested fueling locations. This removes the only operationally risky module and all its concurrency/testing burden.
**Cost target:** ~$0 incremental monthly. Everything runs on infrastructure already in the app.
**Supersedes:** the earlier "Planned Fueling on Route" plan, which was built for a multi-chain national future we do not have and priced in services (HERE/Valhalla routing, OPIS/ProMiles feeds, DP optimizer) we do not need.

---

## 1. What we are building (plain statement)

For each active Samsara route with an assigned vehicle: read where the truck is now, how much fuel it has, and where it is going; find the Pilot/Flying J stations that lie along that route; rank them by price; work out how many gallons to buy and where, so the truck reaches its destination cheaply without dropping below a safety reserve. **Show the result as a table on a page** — one row per suggested fueling stop (station, exit, gallons to buy, est. price, predicted fuel level on arrival). A dispatcher reads it and acts; the app writes nothing back to Samsara.

That is the whole feature. Everything below is detail on how to do it reliably and for free.

**What we read vs. what we don't:** Samsara gives the route's **stops** (current vehicle location, destination, any waypoints) — NOT the turn-by-turn roads. We do not need the roads for a report: "on the way" is decided by a detour-ratio test (§5/§6), which is free geometry. No routing engine, no map, no write-back.

---

## 2. Two corrections to earlier assumptions (both VERIFIED)

1. **The destination does NOT arrive via a webhook.** Samsara emits no `RouteCreated`, `RouteAssigned`, or `RouteUpdated` event. The only route webhooks — `RouteStopArrival`, `RouteStopDeparture`, `RouteStopEtaUpdated`, `RouteStopEarlyLateArrival`, `RouteStopResequence` — are **all Beta** and only fire once a route is already in progress (stop-progress events, not creation). → We discover new/assigned routes by **polling `GET /fleet/routes`** and diffing against our mirror. This fits the existing tiered scheduler; no new infrastructure.

2. **Pilot's public price page is real but shows POSTED retail, not our net price.** `pilotcompany.com/fuel-prices` lists ~875 stores with per-location **diesel + DEF** prices and has a sanctioned "Download Fuel Prices" button — but robots.txt has `Disallow: /api/`, so the JSON behind the page is off-limits to automated clients, and the posted number is not our negotiated price. → We use the Pilot page for **coverage and relative ranking**, and calibrate to true cost using **our own EFS net prices** (the price actually charged, which we already import). See §4.

---

## 3. Verified facts we build on

### 3.1 Samsara API (VERIFIED, developers.samsara.com, July 2026)
- **Find the route + destination:** `GET /fleet/routes` — 5 req/s, `startTime`/`endTime` required (RFC 3339), cursor pagination (`limit` ≤512, `after`). No documented driver/vehicle filter — list in a time window and filter client-side on `driverId`/`vehicleId`. `GET /fleet/routes/{id}` — 25 req/s, accepts external IDs (`key:value`).
- **Route/stop object (exact shape, OpenAPI 2025-10-23):** a route is an ordered `stops` array with **minItems 2**. There is **no `destination` field** — origin = first stop, destination = **last stop**; anything between is a waypoint (no documented cap). Each stop has `id`, `name`, `state` (`unassigned|scheduled|en route|arrived|departed|skipped`), scheduling (`scheduledArrivalTime`, `scheduledDepartureTime`, `eta`), and location expressed as **exactly one of**:
  - `address { id, name }` — a **reference only, NO lat/lng** (used when the stop was created from a saved `addressId`; the common case). To get its coordinates, call `GET /addresses/{id}` once (returns `latitude`, `longitude`, `geofence`) and **cache in the existing `geocode_cache`**.
  - `singleUseLocation { address, latitude, longitude, radiusMeters }` — lat/lng **inline** (fixed 300 m geofence).
- **Per-leg distance (useful):** each stop carries `plannedDistanceMeters` — the **planned road driving distance from the previous stop** (a scalar, computed by Samsara's routing engine). This gives us accurate **miles-to-go per leg** for the fuel/MPG math without any routing call of our own. `actualDistanceMeters` is the GPS-measured equivalent after the fact.
- **No road geometry exists in Samsara's API (VERIFIED), and we don't need it.** The route/stop objects contain **no polyline, geometry, or road-path field**, and Samsara Commercial Navigation's own path is proprietary + dynamically rerouted, so it cannot be fetched or reproduced exactly. **This is not a blocker:** every established fuel optimizer (PC*Miler/Expert Fuel, ProMiles, CoPilot) computes its *own* truck-legal route from the stops and buffers it — none consumes the nav system's polyline. We do the same (§5.1). On the interstate legs where trucks fuel, our computed route and Samsara's agree (one obvious truck-legal path; Pilot/FJ sit on those interstates), so the on-route candidate set matches what the driver actually passes.
- Route is assigned to `driver` **or** `vehicle`, never both.
- **Current location + fuel:** `GET /fleet/vehicles/stats?types=gps,fuelPercents` — 50 req/s, max 3 stat types/call. Use `/fleet/vehicles/stats/feed` for continuous cursor sync.
- **`fuelPercents` is RAW/UNSMOOTHED via the API** (Samsara KB, verbatim: the 7-point rolling-median transformation "is not applied to the data included in the vehicle/stats API endpoint"). We smooth it ourselves. **Tank capacity is NOT in the API** — we already store `vehicles.tank_capacity_gal`.
- **No write-back in this version.** We do not use `PATCH /fleet/routes/{id}`. The feature is read-only; the dispatcher acts on the report manually. (If a future version ever wants to push stops into the Driver App, note that PATCH fully replaces the `stops` array and needs the read-modify-write + concurrency safeguards described in the prior plan — but that is explicitly out of scope here.)
- **Auth/limits:** Bearer token, 150 req/s per token / 200 req/s per org, 429 returns `Retry-After`. Our `samsaraHttp.ts` already handles this. All calls we make are reads.

### 3.2 Pilot / Flying J data (VERIFIED)
- **Prices:** `pilotcompany.com/fuel-prices` — HTML table, ~875 stores, columns Store / **Diesel** / **DEF** / Bio Blend / Unleaded / etc., per-location, with a "Download Fuel Prices" button. Numbers are **posted retail** (page itself markets "save up to 65¢/gal" off these). `robots.txt` allows `/` but disallows `/api/`.
- **Locations (lat/lng), free:** OpenStreetMap via Overpass, `brand:wikidata=Q1434601` (Pilot Flying J), plus ONE9 affiliate brands; ~900 locations company-wide. Alternative: the locator's "Download All Locations" button (`locations.pilotflyingj.com`).
- **Official API:** `developers.pilotcompany.com` exists but is a gated Salesforce partner portal (login-walled). Not needed for this build. CONFIRM-LATER only if we ever want live net pricing direct from Pilot.

### 3.3 EFS / WEX "Fleet One EDGE" (VERIFIED unless noted)
- **We already import EFS transactions.** Each fuel line carries station/merchant, product code (ULSD diesel), gallons, unit price, unit/driver — and reflects the **net (discounted) price actually charged**. This is our ground-truth price source.
- **Free automation to replace manual CSV upload:** (a) **scheduled daily Transaction Report emailed automatically** from eManager — zero provisioning; (b) **"Data Sharing Preferences" real-time feed** (EFS issues separate feed credentials, ~5 business days). Both appear free (no fee documented — CONFIRM-LATER with account manager).
- **Rejections/declines** (for the Pilot-only restriction): eManager has a first-class per-card **Rejections** view and a "Rejections and Overrides" module. Whether declines can be **scheduled/fed** (vs. viewed per-card) is **CONFIRM-LATER** — not blocking; the fuel feature does not depend on it.

---

## 4. Data-source decision (all free, no scraping of `/api/`)

| Need | Source | Cost | Freshness |
|---|---|---|---|
| Station locations (lat/lng, exit) | OSM/Overpass `brand:wikidata=Q1434601` (one-off, refresh quarterly). Fallback: Pilot "Download All Locations" | $0 | Static |
| Posted diesel/DEF price per store (coverage + ranking) | Pilot "Download Fuel Prices" export (sanctioned button, not `/api/`), pulled on a schedule | $0 | Daily |
| **Net price actually paid** (ground truth, ranking calibration) | Our imported **EFS transactions** | $0 | Per-fill |
| Regional sanity check (optional) | EIA on-highway diesel index (free gov API, weekly) | $0 | Weekly |

**Price model (simple, single chain):** rank candidate stores by `estimated_net = posted_diesel − org_discount`, where `org_discount` is one number per org (their Pilot deal, e.g. "cents off posted" or a cost-plus flag). Continuously calibrate that single number by comparing recent EFS net prices at the same stores against the posted price. Because it is one chain with one deal, the *ranking* of Pilot stores by posted price is a strong proxy even before calibration — we are choosing between Pilot A and Pilot B, not across chains.

---

## 5. Data model (minimal — 4 tables, migrations start at 0033)

Existing max migration is `0032`. Follows the repo `NNNN_description.sql` convention and existing RLS org-scoping.

| Table | Purpose / key columns |
|---|---|
| `fuel_stations` | Pilot/FJ/ONE9 registry: `brand`, `store_number`, name, lat/lng, address, exit, `has_diesel`. Refreshed quarterly from OSM. Unique (brand, store_number) |
| `fuel_prices` | `station_id`, `product` (diesel/def), `posted_price`, `estimated_net_price`, `source` (pilot_page / efs / eia), `observed_at`. Append-only; latest-per-station view for the planner |
| `fuel_plans` | One per (route, vehicle) report run: input snapshot (fuel %, tank gal, MPG, prices used), `status` (fresh / stale), est. total cost, est. savings vs. naive, `computed_at`. No push/approval columns — this is a report |
| `fuel_plan_stops` | Suggested stop (a table row): `station_id`, gallons to buy, price used + source + age, predicted arrival fuel %, detour miles, sequence |

Org settings (reserve %, corridor miles, min purchase, price TTL) go in the existing settings mechanism — no new table required. Report generation is logged to `audit_logs` (existing). Because nothing is written to Samsara, there is no version hash, no approval state, and no push lifecycle to model.

### 5.1 Route geometry — compute our own truck route (industry standard)

We cannot get Samsara's path, so — exactly like every established fuel optimizer — we compute our **own truck-legal route** between the route's stops and buffer it. This is the proven, sufficient approach; none of PC*Miler/Expert Fuel, ProMiles, or CoPilot uses a foreign nav polyline.

**Engine (pluggable behind one interface; pick per cost/ops appetite):**

| Engine | Truck-legal + polyline | Cost at ~300 routes/day | Notes |
|---|---|---|---|
| **TomTom Routing** ⭐ MVP | Yes (per-request truck constraints, `encodedPolyline`) | **$0** — 2,500 req/day free, commercial use allowed | Zero infra, commercial-grade truck data. Start here |
| Self-hosted **Valhalla** | Yes (per-request height/weight/length/hazmat, encoded polyline) | $0 per-request, only infra (~16–32 GB RAM box) | Full control, unlimited volume; OSM truck data patchier off-interstate |
| **HERE** Routing v8 | Yes (per-request dims, flexible polyline) | ~**$20/mo** (5k free truck txns, then ~$5/1k) | Best truck-restriction data with no infra |
| ~~Google Routes~~ | **No truck mode at all** (VERIFIED) | — | Excluded |

**Why exact fidelity to Samsara isn't required:** on interstate legs (where fueling happens) every engine picks the same highways Samsara does, and Pilot/FJ sit on those highways. Divergence only appears on regional/urban legs, which have few truck stops anyway. Residual risk — Samsara choosing a different one of two plausible interstates — is mitigated by: (a) using commercial-data engines (HERE/TomTom behave more like Samsara than raw OSM); (b) re-validating against the truck's **live GPS** as it moves (the report refreshes, so divergence self-corrects); (c) surfacing the **top few** candidates, not a single stop, so the driver/dispatcher picks the one actually on their path.

Geometry cached per (stop-pair, engine version) — routes rarely change shape, keeping engine calls (and any cost) minimal.

---

## 6. The flow (end to end)

1. **Route sync (new scheduler tier, ~10 min):** poll `GET /fleet/routes` for the window now−12 h → now+3 d; upsert a local route mirror; diff to find new/changed routes with an assigned vehicle.
2. **Resolve stop coordinates:** for each stop, use inline `singleUseLocation` lat/lng, or resolve `address.id` via `GET /addresses/{id}` (cache in `geocode_cache`). First stop's role is origin, last is destination.
3. **Snapshot:** pull `GET /fleet/vehicles/stats?types=gps,fuelPercents`; smooth fuelPercents (§7); gallons-on-hand = smoothed % × `tank_capacity_gal`. **Miles-to-go = sum of remaining legs' `plannedDistanceMeters`** (accurate road distance from Samsara — no routing call needed).
4. **Compute the route corridor (§5.1):** call the truck routing engine (origin → waypoints → destination) to get a truck-legal **polyline**; buffer it by `corridor_miles` (default 2.5, matching Trimble's off-route default). A Pilot/FJ station is a candidate if it falls in the buffer. (Cheap fallback if the engine is ever unavailable: haversine detour-ratio on stop coordinates.)
5. **Compute (§7):** decide which stop(s) and how many gallons, respecting reserve floor, tank capacity, and MPG, minimizing total cost.
6. **Render report:** write `fuel_plans` + `fuel_plan_stops`; the page shows a table (station, exit, gallons to buy, est. net price, predicted arrival fuel %, detour miles, est. savings vs. naive). The dispatcher reads it and acts. **Nothing is written back to Samsara.**
7. *(optional, later)* **Accuracy loop:** when the matching EFS transaction lands, compare actual gallons/price vs. the report → feeds the discount calibration (§4). Pure read; sharpens future reports.

---

## 7. Fuel logic (deliberately simple)

- **Smoothing:** apply our own 7-point rolling median to raw `fuelPercents` before any decision (mirrors what Samsara's dashboard does but the API does not). Distrust readings within ~60 min of a fill (dual-tank equalization). **Reuse the tank-rise / fuel-level logic already built in the fueling-time-precision work — do not rebuild it.**
- **Consumption:** `vehicles.baseline_mpg` with a conservative safety factor. Miles remaining come from the route legs.
- **Reserve floor:** never plan the truck below a configurable reserve (default 20% usable). Hard constraint.
- **Optimizer = greedy, not DP.** With a single chain and on-route stops (no cross-chain detour games, no per-stop penalties), the classic rule is **provably optimal**: at each candidate, buy just enough to reach the next *cheaper* candidate; if none is cheaper within range, fill up (to capacity minus margin). This is a short, testable function — no dynamic-programming machinery, nothing to maintain. (If detour costs or min-purchase thresholds are ever switched on, revisit; not now.)
- **Output:** ordered stop(s), gallons each, predicted arrival fuel %, est. total cost, and savings vs. a "fill at the next stop" baseline. Set expectations honestly: optimization alone is a low-single-digits % lever; the big win is buying at the right Pilot with the negotiated discount, which the EFS calibration captures.
- **Edge cases handled explicitly, never silently:** no fuelPercents coverage on a truck (fall back to last EFS fill + widen reserve + low-confidence flag); no Pilot within range (flag, no plan); route with <2 stops or unassigned (skip); all prices stale (plan with a visible staleness banner).

---

## 8. Risk profile: read-only, so effectively none

There is no write path. The app only reads from Samsara and renders a table, so the failure modes that made the earlier plan risky (deleting a dispatcher's stops, PATCH races, past-stop mutation, duplicate pushes) **cannot occur here**. Worst case is a stale or wrong *suggestion*, which a dispatcher reviews before acting — never an automated change to a live route. This is why the feature is both cheaper and safer than the original design.

---

## 9. Modular task breakdown (small, independent, mostly reuse)

Each module is a self-contained unit that builds on existing infrastructure (jobs ledger, `samsaraHttp.ts`, scheduler, geocode cache, audit log, EFS import). Ordered by dependency; many are a few hours, not days.

| # | Module | Reuses | Independent of |
|---|---|---|---|
| M1 | Migrations 0033–0036 (§5 tables + RLS) | migration convention | everything |
| M2 | Station registry: Overpass fetch → `fuel_stations`, quarterly refresh job | jobs, geocode cache | M3–M8 |
| M3 | Price ingest: Pilot "Download Fuel Prices" pull + EFS-net derivation → `fuel_prices`, latest view | EFS import, jobs | M4–M8 |
| M4 | Route sync tier: poll `GET /fleet/routes`, mirror, diff, resolve stop coords via `GET /addresses/{id}` (cache) | scheduler, samsaraHttp, geocode cache | M5–M7 |
| M5 | Route corridor: truck-routing engine adapter (TomTom MVP) → polyline → buffer → candidate stations; haversine fallback | geocode cache | M6 |
| M6 | Compute: fuel-level smoothing + greedy optimizer → `fuel_plans`/`fuel_plan_stops` | fuel-precision smoothing | M7 |
| M7 | Vue UI: route list + report table (station, exit, gallons, est. price, predicted fuel %, savings) | existing web app patterns | — |
| M8 | *(optional, later)* Accuracy loop: EFS reconciliation → discount calibration | EFS import, recon | ships last |

The entire feature is now the low-risk reads-and-report path (M1–M7), ~80% reuse. There is no push module. M8 is an optional follow-up that sharpens price accuracy over time and can ship whenever.

**Verification gates:** unit tests on the greedy optimizer (property test: solution never violates reserve or capacity; cheaper station added never increases total cost); a couple of golden real-route fixtures checked by hand. No mock-Samsara race tests needed — nothing is written back.

---

## 10. Cost & the few things to confirm later (none block coding)

**Recurring cost: ~$0 on the MVP path.** Routing via TomTom's free tier (2,500 req/day covers ~300/day, commercial use allowed) = $0; no map-tile bill (free MapLibre/OSM if a map is wanted; a plain table works); no OPIS/ProMiles, no paid Pilot API. Only existing infra. Optional upgrades if ever wanted: HERE truck routing ≈ $20/mo (better off-interstate truck data, no infra) or self-hosted Valhalla ($0 per-request, one small box). None required for launch.

**CONFIRM-LATER (do while/after coding, not before):**
- Pilot ToS exact clause on automated use of the "Download Fuel Prices" export (page ToS is JS-rendered — read it in a browser). If restrictive, EFS-net prices alone still power the feature for stores the fleet visits.
- EFS: is the automated feed / scheduled-email export free for us, and can rejections be scheduled? (5-min call to the account manager, 888-824-7378.)
- Whether EFS feed includes an explicit net-vs-retail price column (field dictionary).
- Samsara Beta route webhooks — optional accelerator only; polling remains the source of truth regardless.

---

## 11. Source appendix (verification links)

Samsara: developers.samsara.com — /reference/fetchroutes, /reference/patchroute, /docs/making-changes-to-a-route-via-api, /docs/capturing-live-route-progress-via-api, /reference/getvehiclestats, /docs/rate-limits, /docs/webhooks; kb.samsara.com/hc/en-us/articles/360037502312 (fuelPercents median not applied to API).
Pilot/FJ: pilotcompany.com/fuel-prices, pilotcompany.com/robots.txt (`Disallow: /api/`), locations.pilotflyingj.com, developers.pilotcompany.com (gated), Wikidata Q1434601.
EFS/WEX: emgr.efsllc.com/common/pdf/administrator.pdf (scheduled Transaction Report, p.15–17), help.fleetio.com/en_US/fuel/efs-fuel-card-integration (Data Sharing feed, 5-min polling), support.firstfleetinc.com (eManager Rejections view), efsllc.com/fuel-card/fleet-one-edge-card.
Algorithm: single-chain on-route fuel purchasing is the fixed-route case where greedy is optimal (Khuller/Malekian/Mestre; Lin et al.).
Existing FleetGuard foundation (verified in repo): `apps/api/src/lib/samsaraHttp.ts`, `services/samsaraScheduler.ts`, `services/jobs.ts` + `0027_jobs.sql`, `services/geocode.ts` + `0018`, `vehicles.tank_capacity_gal`/`baseline_mpg` in `0003`, EFS pipeline `0011`, `audit_logs`, `integration_credentials` `0012`.
