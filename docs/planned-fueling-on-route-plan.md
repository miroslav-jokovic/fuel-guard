# Planned Fueling on Route — Implementation Plan

**Status:** Research complete (2 layers, verified), ready for build-out
**Date:** 2026-07-06 (rev. 2 — second research layer folded in)
**Decisions made:** Price sourcing = chain APIs + fallbacks (ship day one without waiting on agreements). Driver delivery = push approved fuel stops into the assigned Samsara route. Scraping chain price pages = rejected for production (§2.1).

**Rev. 2 headline changes:** (1) a previously missed price source — the **EFS/WEX daily network price feed** available to existing EFS customers — is likely our fastest legitimate station-level, all-chain, *net-price* source; (2) optimizer changed from greedy to **O(n²) DP** (min-purchase, detour costs, and discount thresholds provably break greedy optimality); (3) Samsara `fuelPercents` via API is **raw and unsmoothed** — defensive engineering required; (4) concrete routing/map stack chosen (HERE truck routing MVP → self-hosted Valhalla at scale; MapLibre + OpenFreeMap tiles); (5) formal reliability acceptance criteria added (§10).

---

## 1. Executive summary

FleetGuard will gain a fuel-stop planning engine: for every active Samsara dispatch route, compute where the truck should fuel, how many gallons, and at what price — optimizing total fuel cost including detour cost — then, after dispatcher approval, push the fuel stop into the Samsara route so it appears in the Driver App.

Research finding that shapes everything: **no truck-stop chain offers a free open fuel-price API.** Love's and Pilot both have real APIs, but both are partner/customer-gated (no published fee; access via a sales/partner agreement that takes weeks). Therefore the price layer is built as a **pluggable multi-source pipeline**: ship immediately with prices derived from our own EFS transaction data + EIA regional index, and slot in Love's/Pilot chain APIs as agreements land. No scraping — both chains' ToS prohibit it.

## 2. Verified facts (all confirmed against official sources, July 2026)

### 2.1 Fuel price sources

| Source | What it is | Access | Station-level? | Status |
|---|---|---|---|---|
| **Love's Store & Fuel Prices API** | REST API on developer.loves.com (MuleSoft Anypoint). `GET /stores` (stores + prices in one call), `GET /fuelPrices` (filter by product codes). OAuth2 client-credentials. Prod base `https://apis.loves.com/locations/api/` | Gated: "Request Access" / Love's sales rep. No published fee | Yes | **Verified live.** Rate limits & update cadence not public — ask during onboarding |
| **Pilot Company partner API** | Partner portal at developers.pilotcompany.com; APIs granted case-by-case to transportation partners (e.g., Alvys has a PFJ fuel integration) | Partner agreement via Pilot fleet sales | Presumed yes | Existence verified; contents/terms login-walled |
| **ONE9 Fuel Network** | Pilot Company brand (owned since 2019; Mr. Fuel, Pride, Stamart, Speedway commercial lanes). Locations appear in Pilot's directory | Via Pilot | **Unverified** — ONE9 dealer pages show no prices | Must ask Pilot explicitly whether ONE9 prices are in the feed |
| **EFS/WEX daily network price feed** ⭐ | Fleet One EDGE program emails customers a **daily price feed of network locations and prices** (member portal has a Price Feed page). Verified to exist; file spec is customer-only | **We already are an EFS customer** — request from the WEX/EFS account manager | Yes — network-wide, all chains, likely incl. our negotiated pricing | **Highest-leverage ask. Do this first.** Format/coverage to confirm with account manager |
| **EIA Open Data API v2** | Free US government API. Route `/v2/petroleum/pri/gnd/data/`, product `EPD2D` (on-highway diesel), duoareas `NUS`, `R10`–`R50`, `SCA`. Released **Tuesdays ~10:00 ET** (holiday → Wed). Limits ~9,000 req/hr, burst <5/s | Free (instant key at eia.gov/opendata/register.php) | No — US/PADD/CA weekly averages | Verified incl. exact request pattern. Sanity bands + surcharge index only |
| **EFS transactions (already in FleetGuard)** | `efs_transactions` + `fuel_transactions` carry actual `price_per_gal` paid per station | Already have it | Yes (stations our fleet visits) | This is *net* (discounted) price — the number that actually matters |
| **TA/Petro (BP)** | Real developer portal (developer.accessta.com): Truck Service + Retail Service APIs (locations, amenities, parking/shower availability). **Fuel prices absent from published API list**; token-gated Swagger may hide a price field | Request portal token | Unknown | Verified portal; price availability unconfirmed — ask. TMS vendors get TA prices via OPIS |
| **Other chains (Maverik, Sapp Bros, Roady's, AmBest, Kwik Trip, Casey's, Circle K Pro)** | No public price APIs anywhere; prices flow through card networks (WEX/EFS, Comdata) and OPIS | — | — | Verified negative. **Buc-ee's: exclude entirely — semis prohibited.** OPIS is the upstream everyone (ProMiles, Trimble, Comdata) licenses |
| **ProMiles** (fallback, paid) | Trucking-specific: near-real-time diesel + DEF from 9,600+ truck stops; SOAP/SDK under NDA (appdev@promiles.com) | Paid, unpublished pricing | Yes, all chains | Best single-vendor fallback if chain deals stall |
| **OPIS (Dow Jones)** | Gold standard, 8,000+ truck stops, daily feeds + REST Rack API | Paid enterprise | Yes | Budget option of last resort |

**Explicitly rejected (decision confirmed 2026-07-06):** scraping chain public price pages (pilotcompany.com/fuel-prices ~871 stations, loves.com store pages, ta-petro.com, etc.) as a production data source. Rationale: (a) Love's ToS expressly bans "mine, scrape" without written consent and licenses the site for non-commercial use only — not gray, prohibited; (b) Pilot's ToS clause is JS-walled/unread, but pilotcompany.com robots.txt has `Disallow: /api/`, putting the page's underlying price endpoints explicitly off-limits to automated clients; (c) zero reliability guarantees — redesign or bot-protection silently breaks fuel planning with no recourse; (d) it undermines the Phase 0 partner ask to Pilot; (e) posted retail still isn't net fleet price, so scraping wouldn't remove the need for the EFS-derived model. US case law on scraping public data is genuinely unsettled (hiQ, Van Buren), so this is recorded as a business risk decision, not only a legal one. Public pages remain fine for **manual QA spot-checks** of our price pipeline, and as leverage in the Pilot conversation ("you already publish this — grant it via the API"). GasBuddy scraping resellers likewise rejected.

**Pricing nuance that must be modeled:** posted pump price ≠ fleet's price. Discounts are *retail-minus* (posted − negotiated rebate) or *cost-plus* (OPIS rack + taxes + markup, independent of pump price). So the optimizer ranks stations by **estimated net price** = posted price − org's per-chain discount rule, continuously calibrated against actual EFS settlement prices.

### 2.2 Samsara API (verified against developers.samsara.com, spec 2025-10-23)

- **Routes:** `GET /fleet/routes` (5 req/s; `startTime`/`endTime` required; cursor pagination, limit ≤512), `GET /fleet/routes/{id}` (25/s; accepts external IDs `key:value`), `PATCH /fleet/routes/{id}` (**100/min**), `DELETE`. Route object: stops[] with `state` (`scheduled|en route|arrived|departed|skipped`), `eta`, `scheduledArrivalTime`, `plannedDistanceMeters`, address or `singleUseLocation` (lat/lng + `radiusMeters`), `notes` (≤2000 chars).
- **PATCH semantics (critical):** JSON merge-patch; the `stops` array is **fully replaced**. To add a fuel stop: GET route → append stop (keeping every existing stop's `id`) → PATCH full array. Only add/modify stops with **future** scheduledArrivalTime — modifying past-scheduled stops causes documented "unpredictable behavior". Optional `recomputeScheduledTimes: true`.
- **No navigation polyline.** The API exposes dispatch stops only, not the driver's turn-by-turn path. Route geometry between stops must be computed ourselves (see §5.2).
- **Vehicle data:** `/fleet/vehicles/stats` types `gps` (5 s cadence), `fuelPercents`, `obdOdometerMeters`; `GET /fleet/reports/vehicles/fuel-energy` for per-vehicle `efficiencyMpge` (72 h processing lag — use for baselines, not same-day; ECU-filtered, will NOT reconcile with raw stats `fuelConsumedMilliliters`). **Tank capacity is NOT in the API** — we already store `vehicles.tank_capacity_gal`. ✔
- **`fuelPercents` precision caveats (all verified, critical for this feature):**
  - The API returns **raw, unsmoothed** readings. Samsara's dashboard applies a 7-data-point rolling median to compensate for fuel slosh, but per Samsara KB this transformation "is not applied" to the stats API. **We must implement our own rolling-median smoothing.**
  - Integer percentage points only; ECU quantization step is undocumented and varies by make (some trucks report in coarse steps) — **profile per VIN empirically** during rollout. Samsara's own theft alerts treat <5% swings as noise.
  - Coverage varies by make/model/year (Hino and Isuzu notably lack native fuel reporting); when unsupported the stat is silently omitted.
  - Dual saddle tanks equalize slowly through the crossover (~30–60 min) and often only one tank carries the sender — **distrust readings within ~60 min of a fill**.
- **HOS clocks (verified):** `GET /fleet/hos/clocks` (25 req/s) → `driveRemainingDurationMs`, `shiftRemainingDurationMs`, `cycleRemainingDurationMs`, `timeUntilBreakDurationMs`, `currentDutyStatus`. Returns empty status if the driver app is offline. This feeds HOS-aware stop placement (§5.3).
- **Competitive position (verified):** Samsara natively offers only *retrospective* Fuel Price Insights (scores past transactions vs. nearby cheaper stations; not API-exposed). **No native proactive fuel-stop planner exists**; the only Samsara Marketplace occupant is "Fuel Smart by Foruscorp." Proactive route-based fuel planning is open ground for FleetGuard.
- **Webhooks 2.0 (all route events are Beta):** `RouteStopArrival/Departure/EtaUpdated/EarlyLateArrival/Resequence`, `GeofenceEntry/Exit`. **No RouteCreated/Updated event exists** — new/changed routes must be discovered by polling `GET /fleet/routes` and `GET /fleet/routes/audit-logs/feed` (5/s, cursor feed of stop-state changes). Signature: HMAC-SHA256 over `v1:<timestamp>:<raw body>`, 5 retry attempts then dropped — webhooks are an accelerator, polling is the source of truth.
- **Write paths for delivery:** PATCH stop into route (canonical), `POST /v1/fleet/messages` driver message (≤2,500 chars, no read receipts), `POST /addresses` (100/min) to register truck stops as geofenced Addresses referenced by `addressId`.
- **Limits/auth:** 150 req/s per token, 429 + `Retry-After` (our `samsaraHttp.ts` already handles this). Current per-org API tokens are sufficient; OAuth2 only needed if we later publish a Samsara Marketplace app.

### 2.3 Existing FleetGuard foundation we build on

TS monorepo (Express API + Vue 3 web + Supabase). Already in place and reusable as-is: per-token rate-limited Samsara client with retries (`lib/samsaraHttp.ts`), tiered sync scheduler (`services/samsaraScheduler.ts`), jobs ledger with DB-enforced no-overlap (`services/jobs.ts` + partial unique index), geocode cache w/ site-level precision (`services/geocode.ts`), `vehicles.baseline_mpg` + `tank_capacity_gal`, EFS import pipeline, audit log, per-org `integration_credentials`, AI verification layer. Gaps: no mapping UI, no route entities, no price store, no optimizer.

---

## 3. Price layer — pluggable multi-source pipeline

One interface, N providers, per-org enablement. Every price row carries `source`, `observed_at`, `expires_at`, and `confidence` so the optimizer and UI can always show data lineage and staleness.

```
FuelPriceProvider (interface)
├── EfsDerivedProvider      // Phase 1 — live day one (from imported transactions)
├── EfsPriceFeedProvider    // Phase 1/2 ⭐ — daily EFS/WEX network price file (request from account manager)
├── EiaIndexProvider        // Phase 1 — regional sanity bands + surcharge index
├── LovesApiProvider        // Phase 2 — when access granted
├── PilotApiProvider        // Phase 2/3 — when partner agreement lands (ask: ONE9 included?)
├── TaPetroProvider         // If token-gated Location API turns out to carry prices
└── ProMilesProvider        // Optional Phase 4 — paid gap-filler (also best DEF source, 18k+ locations)
```

If the EFS price feed materializes as expected (daily, network-wide, station-level, reflecting our negotiated pricing), it becomes the **primary** production source and chain APIs become secondary/corroborating — that inverts the original priority and removes most coverage risk. Parse pipeline mirrors the existing EFS transaction import (staging table, faithful line store, idempotent upsert).

- **EfsDerivedProvider:** every imported EFS line already contains station identity + `price_per_gal` actually paid. Across the fleet (and time-decayed), this yields net prices at every station the fleet uses — arguably better than posted prices because it *is* the discounted price. Freshness varies by station traffic; confidence decays with age (e.g., full weight <24 h, zero weight >7 days, then fall back to chain/regional estimate).
- **Net-price model:** `estimated_net = posted_price − discount(org, chain)`; discount rules per org per chain (retail-minus cents/gal or cost-plus flag), seeded manually in Settings and **auto-calibrated** by regressing EFS actuals against posted prices once chain feeds are live.
- **Staleness policy:** every price displayed or used in optimization shows age; prices older than a configurable TTL (default 24 h) are flagged and down-weighted; EIA band check rejects outliers (guards against feed glitches).
- **Provider hygiene:** each provider runs as a `jobs`-ledger job on the existing scheduler pattern, with circuit breaker (N consecutive failures → pause + alert email), full-snapshot upsert, and per-provider health row surfaced in Settings.

## 4. Data model (new migration set)

| Table | Purpose / key columns |
|---|---|
| `fuel_stations` | Canonical station registry: `chain` (pilot/flying_j/one9/loves/other), `store_number`, name, lat/lng, address, `amenities`, `samsara_address_id` (once registered), external ids per source. Unique on (chain, store_number). Seeded from chain location feeds + geocode cache + EFS history |
| `fuel_prices` | `station_id`, `product` (diesel/def), `posted_price`, `estimated_net_price`, `source`, `observed_at`, `expires_at`, `confidence`. Append-only; latest-per-station materialized view for the optimizer |
| `fuel_discount_rules` | Per org per chain: `type` (retail_minus/cost_plus/none), `cents_off`, calibration stats |
| `samsara_routes` (+ `samsara_route_stops`) | Local mirror of dispatch routes: samsara ids, assignment, stops with schedule/state/eta, `synced_at`, `samsara_version_hash` (for optimistic concurrency on PATCH) |
| `fuel_plans` | One per (route, vehicle) planning run: inputs snapshot (fuel %, tank gal, MPG, prices used), status (`draft → approved → pushed → completed / stale / rejected / failed`), totals (est. cost, est. savings vs. naive), `approved_by`, `pushed_at` |
| `fuel_plan_stops` | Planned stop: `station_id`, gallons to buy, price used + source + age, arrival fuel % predicted, detour miles/minutes, `samsara_stop_id` after push |
| `route_fuel_settings` (org-level) | Reserve floor % (default 20), max detour miles, min purchase gal, corridor width, auto-plan on/off, price TTL |

RLS mirrors existing org-scoping. All pushes/approvals write `audit_logs`.

## 5. Planning engine

### 5.1 Trigger & lifecycle

1. **Route sync job** (new tier on `samsaraScheduler`, e.g. every 10 min, 5 req/s budget): pull routes in a rolling window (now−24 h → now+7 d), upsert mirror, diff against last sync. Webhooks (`RouteStopArrival/EtaUpdated`, beta) accelerate refresh when configured, but polling is authoritative.
2. New/changed route with assigned vehicle → enqueue **plan job**: snapshot vehicle state (latest `fuelPercents` × `tank_capacity_gal`, GPS), compute plan, store as `draft`.
3. Dispatcher reviews in FleetGuard (map + table), edits/approves.
4. **Push job:** register station as Samsara Address if needed → GET route → verify version hash → append fuel stop(s) with future `scheduledArrivalTime`, notes like `FUEL: Loves #421 — buy ~92 gal @ $3.41 net (est). Do not fuel before this stop.` → PATCH full stops array (`recomputeScheduledTimes: true`) → optional driver message → mark `pushed`.
5. **Monitor:** stop-arrival (webhook or audit-log feed) + subsequent fuel transaction close the loop; actual price/gallons vs. plan is recorded → feeds calibration and a "plan adherence" report. Material deviation (route resequenced, fuel burn ahead of model, price change > threshold) → plan flagged `stale` → replan proposed.

### 5.2 Route geometry (gap Samsara doesn't fill)

Samsara gives stops, not the path. To find stations "on the way" we need the driving polyline between consecutive stops, truck-appropriate (Class 8: height/weight restrictions are a safety issue, not a nicety). Layer-2 research validated the options; decisions:

- **MVP: HERE Routing API v8, `transportMode=truck`** — verified best-in-class truck routing (per-request vehicle dimensions, hazmat/tunnel categories, violated-restriction notices, commercial restriction data better than OSM). Our volume (~hundreds of computations/day ≈ 9k/mo) sits inside the reported 30k free transactions/month — **that free-tier number is secondary-sourced; confirm in the HERE console before committing** (also confirm truck routing's transaction class). Prototype fallback: OpenRouteService `driving-hgv` (~2,000 req/day free; confirm commercial-use terms with HeiGIT).
- **Scale: self-hosted Valhalla** (`ghcr.io/valhalla/valhalla-scripted`) — first-class `costing=truck` with **per-request truck dimensions** (each vehicle sends its own height/weight/axles). US-only tiles ≈ 11–17 GB disk; serving is mmap-based, 8–16 GB RAM suffices; **pre-build tiles off-platform** (CI/temp VM), ship the tar to a Railway Pro volume. All-in ≈ $100–200/mo flat, unlimited requests. Caveat: OSM truck-restriction coverage is weaker than HERE/Trimble — if restriction accuracy ever becomes contractual (hazmat/oversize), budget Trimble PC*Miler (quote-based, industry standard). **Rejected: OSRM** (no truck profile, profiles baked at preprocess time, ~123 GiB serve RAM for planet); **Mapbox/Google Routes** (no truck routing — verified).
- **Map tiles (dispatcher UI): MapLibre GL + OpenFreeMap** — free hosted OSM vector tiles, commercial use explicitly allowed, no keys/limits; donation-funded single-maintainer, so keep the style URL configurable with a paid fallback ready (Stadia Starter $20/mo or Protomaps hosted, 50k req/mo free). **Do not use tile.openstreetmap.org in production** (OSMF policy: no SLA, blockable without notice, warns commercial services explicitly). At scale: self-host Protomaps PMTiles US extract on R2+CDN. MapTiler/Stadia free tiers and Carto basemaps are non-commercial — not options.
- **Station registry seeding:** one-off Overpass API extraction keyed on `brand:wikidata` QIDs (Pilot Q64128179, Flying J Q64130592, Love's Q1872496, TA Q7835892, Petro Q64051305) + `highway=services` + `amenity=fuel`+`hgv=yes`. Verified NA object counts: Love's 2,065, Pilot 1,169, Flying J 518, TA 374, Petro 180 (objects ≠ sites — dedupe multi-element plazas by proximity+brand). **OSM does not reliably carry store numbers** — station↔EFS/chain-feed matching must use brand + proximity, with a manual QA pass. Enrich parking capacity from USDOT/BTS NTAD "Truck Stop Parking" layer where facilities match. Repeatable refresh path: Geofabrik `us-latest.osm.pbf` + osmium.
- **Nominatim:** our planned one-time geocode of a few thousand stations, single-threaded at ≤1 req/s with permanent caching, fits the OSMF policy carve-out for small one-time bulk tasks (verified). Note the policy's no-resale clause explicitly names vehicle-tracking apps — geocoding stays an internal function, results cached in `geocode_cache`.
- Corridor = polyline buffered by org-configured width (default 2 mi). Candidate stations = `fuel_stations` within corridor, plus stations within `max_detour_miles` where detour cost is priced in. Geometry cached per (stop-pair, engine version) — routes rarely change shape.

### 5.3 Optimization algorithm

This is the classic **fixed-route fuel purchasing problem** (Khuller/Malekian/Mestre "To Fill or Not to Fill", ESA 2007 / ACM TALG 2011; Lin et al., ORL 2007). Layer-2 research corrected the original design: the pure greedy (buy-enough-to-reach-cheaper / else fill up) is provably optimal **only without** per-stop fixed costs, minimum purchases, or stop budgets. Our constraint set (detour cost per stop, min purchase, gallon-threshold loyalty perks, reserve floors) **breaks greedy optimality** — the literature's answer is a lot-sizing DP (Atamtürk & Küçükyavuz 2008 O(n²); Schulz & Suzuki 2023).

- **Solver: O(n²) DP over ordered candidate stations.** State = station × arrival-fuel level; transition (i → j) = fill at i to reach j respecting capacity/reserve/min-purchase; edge cost = gallons × effective_net_price(i) + fixed_stop_cost(i) − threshold bonuses. With n ≤ ~100 candidates per route this solves in microseconds — no heuristics needed. Max-stops constraint adds a Δ dimension if ever required (O(Δn²)).
- **Greedy as test oracle:** with fixed costs, min purchase, and thresholds zeroed, the DP must reproduce the Khuller/Lin greedy exactly — property-based test invariant.
- **Effective net price per station** = posted/cost-plus estimate − card discount − amortized loyalty value + out-of-network fee if applicable, compared **ex-tax if IFTA handling is enabled** (ProMiles' argument: refundable state tax shouldn't distort station ranking — org-configurable, phase 4+).
- **Fixed stop cost** = detour miles × org $/mile + stop minutes × org $/hr (driver + truck opportunity cost). Default stop time 20–30 min.
- **HOS-aware placement:** verified rule (49 CFR 395.3(a)(3)(ii)): no driving past 8 cumulative driving hours without a consecutive 30-min break; since 2020, on-duty-not-driving (fueling) **counts** if consecutive ≥30 min. Pull `/fleet/hos/clocks`; a candidate stop landing where the break will be due gets its time cost heavily discounted (stop extended to ≥30 min). This is standard industry practice (Trimble Expert Fuel inputs include HOS/route policies).
- **Consumption model:** `baseline_mpg` refined by Samsara fuel-energy `efficiencyMpge` (rolling 30-day, excluding the 72-h processing window), conservative safety factor.
- **Starting fuel:** smoothed `fuelPercents` (own rolling median, §2.2) × usable capacity, minus sensor tolerance; readings <60 min post-fill distrusted (dual-tank equalization).
- Output: stops + gallons + predicted arrival fuel % + est. total cost + savings vs. "fill where convenient" baseline. **Set expectations honestly: verified industry benchmark for optimization alone is 4–11¢/gal (~1–3% of fuel spend)** (ProMiles, Trimble/TMW claims; Trimble's H&M case: $500k year one). Discount capture (card programs) is a separate, larger lever we already support via EFS.
- Edge cases handled explicitly: no `fuelPercents` coverage (Hino/Isuzu etc. — fall back to last-transaction reconstruction, widen reserve, flag low confidence); no candidate station within range (plan out-of-corridor stop with warning); route with <2 stops; unassigned routes (skip); prices all stale (plan with warning banner, never silently).

**Default parameters (sourced, all org/vehicle-overridable):**

| Parameter | Default | Basis |
|---|---|---|
| Usable tank capacity | 95% of rated | 49 CFR 393.67 (fill marking; 2026 rule kept 95% marking) |
| Typical config sanity check | 2×100–150 gal saddle tanks | OEM specs; validate against `tank_capacity_gal` |
| MPG fallback (no telemetry) | 6.9–7.0 | NACFE 2024; prefer per-truck fuel-energy report |
| Reserve floor | 20–25% usable, higher winter/remote (org + seasonal override) | Industry practice (heuristic — flagged); Knight case validates configurability |
| Fuel-level error margin | ±5–10%; distrust ≤60 min post-fill | J1939 SPN 96 + telematics vendors + Samsara's own 5% noise threshold |
| Min purchase | 25–50 gal; loyalty thresholds Pilot 50 / Love's 50 / TA 60 gal | Chain program rules (verified) |
| Stop time | 20–30 min; ≥30 when doubling as HOS break | Trade sources |
| Stop time cost | $60–80/hr equivalent | Heuristic, org-configurable |
| Out-of-network fee | $0.50–$3.00/txn | EFS/Comdata reporting; contract-specific |

**Design insight from industry (Suzuki 2008; Trimble H&M case):** minimize *total affected cost*, not fuel price alone — drivers reject plans ignoring amenities/time. And **driver compliance is the real bottleneck** (Trimble's flagship case leads with 94% compliance tied to bonuses): the plan-vs-actual adherence report (§5.1 step 5) is a first-class feature, not an afterthought.

### 5.4 Concurrency & safety on the Samsara write path

PATCH replaces the whole stops array, so a race against dispatcher edits in the Samsara dashboard can destroy stops. Mitigations: GET immediately before PATCH; compare against our mirror's version hash; abort + resync + re-approve on mismatch; never touch stops whose scheduled arrival is past; per-route mutex via jobs ledger; idempotency key on push; on PATCH failure (or 100/min budget pressure — batch all fuel stops for a route into one PATCH), rollback plan status and alert. All pushes are dispatcher-approved (per decision) — no silent auto-push in v1; org setting can later enable auto-push for low-risk plans.

## 6. UI (Vue, new feature module `features/fueling/`)

- **Fuel Planning page:** list of active routes with plan status chips (none/draft/approved/pushed/stale), est. savings column.
- **Plan detail:** map (MapLibre GL + OSM raster tiles — free, no key; upgrade path to paid vector tiles later) showing route line, corridor, candidate stations colored by net price, chosen stops; side panel with editable stops table (swap station → live re-optimize), price age badges, fuel-level projection chart along the route; Approve & Push button (permission-gated).
- **Settings:** provider credentials + health, discount rules per chain, planning parameters (reserve %, corridor, detour cap), auto-plan toggle.
- Reports: monthly savings, plan adherence (planned vs. actual fueling), price-source coverage.

## 7. Phased roadmap

| Phase | Scope | Depends on |
|---|---|---|
| **0 — Business actions (start now, zero code)** | **① Ask the WEX/EFS account manager for the daily network price feed (Fleet One EDGE price file) — highest leverage, we're already a customer.** ② Request Love's API access (sales rep / portal "Request Access"; ask about DEF product code, update cadence, rate limits). ③ Contact Pilot fleet sales re: partner API — explicitly ask whether ONE9 dealer prices are included. ④ Register free EIA API key. ⑤ Verify HERE free tier (30k/mo) + truck transaction class in the HERE console. ⑥ Request TA developer portal token (developer.accessta.com) — check whether the Location API carries fuel prices | Nobody — do this week; lead time is weeks |
| **1 — Foundation (~2–3 wks)** | Migrations (§4); route sync job + mirror; station registry seeded from EFS history + geocoding; EfsDerivedProvider + EiaIndexProvider; provider framework w/ health + circuit breakers | — |
| **2 — Planner (~2–3 wks)** | Routing sidecar (Valhalla/OSRM) + corridor matching; optimizer + tests (property-based tests on solver invariants); plan lifecycle + jobs; Fuel Planning UI with map | Phase 1 |
| **3 — Samsara push + close the loop (~1–2 wks)** | Address registration, PATCH push with §5.4 safeguards, driver messages, arrival/transaction reconciliation, staleness/replan, savings report | Phase 2 |
| **4 — Chain feeds & calibration (as access lands)** | LovesApiProvider, PilotApiProvider (+ ONE9 if confirmed); discount auto-calibration vs. EFS actuals; optional webhooks 2.0 ingestion; evaluate ProMiles only if chain coverage insufficient | Phase 0 outcomes |

Verification gates per phase: unit + property tests on solver; replay tests of PATCH flow against a mock Samsara server (race scenarios); price-pipeline tests with stale/outlier fixtures; end-to-end dry-run mode (plan + push disabled) run on real fleet for a week before enabling pushes.

## 8. Risks & open questions

| Risk | Impact | Mitigation |
|---|---|---|
| Love's/Pilot access delayed or denied | No posted-price coverage for non-visited stations | Phase 1 works without them (EFS-derived); ProMiles as paid fallback; feature still delivers value on frequented corridors |
| ONE9 prices not exposed anywhere | Blind spot at ONE9 network | Confirm with Pilot in Phase 0; EFS-derived covers visited ONE9 sites |
| Samsara route webhooks are Beta | Payloads may change | Polling is authoritative; webhooks optional accelerator (same posture as existing siphoning webhook) |
| `fuelPercents` ECU coverage varies by truck | Plans on wrong starting fuel | Per-vehicle coverage audit at rollout; fallback estimator + wider reserve; confidence flag on plan |
| PATCH race destroys dispatcher's stops | Operational damage + trust | §5.4: version check, future-stops-only, mutex, approval gate, audit |
| Fuel sensor error / MPG variance strands a truck | Severe | Reserve floor default 20%, conservative MPG factor, never plan below floor, dispatcher sees projection curve |
| Love's API cadence/rate limits unknown | Sizing unknown | Ask during onboarding; design assumes ≥ daily full snapshot, cache-first |
| Routing sidecar ops burden (OSM tile builds) | DevOps cost | MVP on HERE hosted (no infra); containerized Valhalla with pre-built tiles when volume justifies |
| OSM truck-restriction gaps (low bridges, weight limits) | Safety/legal if a truck is routed under a low bridge | MVP uses HERE (commercial restriction data); at scale, keep HERE for final-leg validation or budget PC*Miler if contractual |
| Raw `fuelPercents` noise → wrong starting-fuel estimate | Plan under/over-fuels | Own 7-point rolling median (mirrors Samsara dashboard), ±5–10% margin, 60-min post-fill distrust window, per-VIN quantization profiling at rollout |
| Drivers don't follow plans | Feature shows no savings regardless of optimizer quality | Adherence report from day one; amenity-aware stop selection; realistic 4–11¢/gal savings claims; consider driver incentive guidance for orgs (Trimble case: 94% compliance via bonuses) |
| EFS price feed differs from expectation (format/coverage) | Primary source degraded | Confirm spec with account manager in Phase 0 before building the parser; chain APIs remain the fallback path |
| OpenFreeMap (single maintainer) disappears | Map UI degraded | Style URL configurable; Stadia/Protomaps fallback ready; self-host PMTiles at scale |

## 9. Reliability & precision acceptance criteria (definition of "done")

The feature does not enable route pushes for an org until it passes these gates:

**Data quality gates**

- Price freshness SLO: ≥95% of prices used in an approved plan are <24 h old (measured continuously; dashboard metric). Any plan using a price >TTL carries a visible staleness warning and reduced confidence score.
- Price accuracy check: where two sources cover the same station, divergence >$0.15/gal flags both rows for review; EIA regional band rejects outliers beyond ±25% of PADD average.
- Station registry: every station used in a plan has site-level geocode precision (±0.5 mi), verified chain/brand, and a diesel-lane flag; manual QA pass completed on the seeded registry before launch.
- Fuel telemetry audit per org at rollout: for each vehicle, verify `fuelPercents` coverage, measure empirical quantization step over 2 weeks, record per-VIN confidence tier. Vehicles below tier threshold get widened reserves and a low-confidence badge on their plans.

**Engine correctness gates**

- Property-based test suite: DP reproduces greedy exactly when fixed costs/min-purchase/thresholds are zeroed; solution never violates reserve floor or capacity at any point along the route; monotonicity checks (cheaper station added → total cost never increases).
- Golden-route regression set: ≥25 real anonymized routes with hand-verified optimal solutions, run on every CI build.
- Simulation backtest before launch: replay ≥3 months of historical routes + EFS actuals; report what the optimizer would have saved vs. what was actually spent. This number validates the savings claim and calibrates defaults.

**Integration safety gates**

- Samsara push: mock-server race test suite (concurrent dashboard edit during PATCH, past-stop mutation attempt, 429 storm, webhook replay/duplicate) all green; idempotent re-push verified.
- Dry-run week per org: plans generated and displayed but pushes disabled; dispatchers rate plan sensibility; ≥80% of plans rated actionable before enabling push.
- Kill switches: per-org feature flag, global env flag (same pattern as `SAMSARA_SYNC_HOURS=0`), provider-level circuit breakers with alert emails.

**Ongoing SLOs (post-launch dashboard)**

- Plan-to-arrival price drift: median |planned − actual price| per gallon, target <$0.05.
- Fuel-level prediction error at planned stop arrival: target within ±8%.
- Plan adherence rate (driver fueled at planned stop ±1 exit): tracked per org, per driver.
- Realized savings: actual $/gal vs. counterfactual "filled at most convenient stop" — the headline metric, computed from reconciled EFS transactions.

## 10. Source appendix (key verification links)

Love's: developer.loves.com → Store & Fuel Prices API (Anypoint Exchange, OAuth2 CC, `/stores`, `/fuelPrices`); loves.com/en/terms-of-use (anti-scraping clause). Pilot: developers.pilotcompany.com (gated); pilotcompany.com/fuel-prices (public table, not for programmatic use); pilotcompany.com/one9-fuel-network. TA: developer.accessta.com. EFS price feed: Fleet One EDGE carrier guide (community.loadsmart.com article 22802768789651); member.fleetoneedge.com/PriceFeed. EIA: eia.gov/opendata/documentation.php; route `/v2/petroleum/pri/gnd/data/`; release schedule eia.gov/petroleum/gasdiesel/schedule.php.

Samsara: developers.samsara.com — /docs/making-changes-to-a-route-via-api, /docs/creating-routes-via-api, /docs/capturing-live-route-progress-via-api, /docs/rate-limits, /docs/event-subscriptions, /docs/webhooks, /reference/getvehiclestats, /reference/getfuelenergyvehiclereports, /reference/gethosclocks, /docs/driver-dispatch-messaging; kb.samsara.com articles 360037502312 (fuel-level median smoothing not applied to API), 360042282731 (fuel-energy computation), 360043272731 (Fuel Price Insights).

Routing/maps: valhalla.github.io (truck costing, mjolnir guide), github.com/valhalla/valhalla docker README, docs.here.com/routing/docs/truck-routing, openrouteservice.org/restrictions + /terms-of-service, graphhopper.com/pricing, developer.trimblemaps.com, operations.osmfoundation.org/policies/tiles + /policies/nominatim, openfreemap.org, docs.protomaps.com, docs.railway.com/pricing/plans.

Algorithm: Khuller/Malekian/Mestre, ACM TALG 7(3) 2011 (cs.umd.edu/projects/gas/gas-station.pdf); Lin et al., ORL 35(3) 2007; Atamtürk & Küçükyavuz, ORL 36(3) 2008; Schulz & Suzuki, TR-E 169 2023; Suzuki, NRL 55(8) 2008. Industry: admin.promiles.com/FuelOpt (incl. FuelOpt_Defined ex-tax argument); Trimble Expert Fuel H&M case (transportation.trimble.com blog); FMCSA 30-min break: law.cornell.edu/cfr/text/49/395.3; tank fill marking: eCFR 49 CFR 393.67 + Federal Register 2026-03265. Fleet discount models: rtsinc.com/articles/cost-plus-vs-retail-minus. ProMiles: promiles.com/fuel-finder (appdev@promiles.com). OPIS: opis.com Truckstop Spread Report (9,000+ stops daily). Loyalty minimums: pilotflyingj.com/myrewards-plus-faqs (50 gal), TA UltraONE rules PDF (60 gal). OSM seeding: taginfo/name-suggestion-index brand QIDs; NTAD Truck Stop Parking FeatureServer.
