# All-Network Truckstop Locations + Near-Real-Time Prices — Analysis & Data Plan

**Goal:** expand Smart Fueling from the current single-company, Pilot-only setup to a **centralized station + price database covering all US/Canada truckstops**, usable by **many carrier tenants** of the app, with reliable, fresh (near-real-time) pump prices.

**Scope of this document:** (1) precise audit of the current situation in the repo, (2) verified research (2026-07) of every realistic data source for locations and prices, (3) the target multi-tenant architecture and a phased build plan. All external claims were re-verified against providers' current sites in July 2026; source URLs inline.

---

## 1. Current situation (repo audit)

### 1.1 What exists and works

The Smart Fueling module is built and live-verified (Phase 0 GO on the Silvicom token; HERE routing live-verified 2026-07-15). The relevant data spine (migration `0058_smart_fueling_spine.sql`):

| Table | Scope today | Notes |
|---|---|---|
| `fuel_stations` | **Global** (cross-org reference; any authenticated org reads, service-role writes) | Already the right multi-tenant shape. Unique on `(brand, store_number)`. |
| `fuel_prices` | **Per-org** | `posted_price` + `net_price`, `source` (`pilot_email`/`efs`), append-only, `observed_at`, latest-per-station lookup index. |
| `fuel_discount_rules` | Per-org per-brand | `flat` implemented; `retail_minus`/`cost_plus`/`per_site` scaffolded. |
| `route_fuel_settings` | Per-org | reserve %, corridor, TTL, preferred/avoid brands & states, truck-profile defaults. |

The planner (`fuelPlanning.ts` + pure solver in `packages/shared`) already: degrades explicitly on missing data, carries **price age**, **price-estimated flags and confidence** (`estimateStationPrice` history/brand fallback), border top-off logic, and EFS reconciliation for predicted-vs-actual. The `PriceSource` adapter seam (SMART-FUELING-PLAN Phase 8) was planned for exactly this expansion.

### 1.2 The gaps between "works for Silvicom" and "distributable product"

1. **Station coverage: one brand.** `fuel_stations` is populated only by the Pilot email ingest (~875 price-report sites). Love's (~650), TA/Petro (~300), regionals (Road Ranger, Sapp Bros, Kwik Trip, Maverik, Casey's…), independents (AMBEST etc.), and Canada cardlocks are absent. US truck-fuel universe is roughly **8,000–18,000 locations** depending on definition (OPIS covers ~9,000 US truckstops; ProMiles claims 18k+ locations incl. services).
2. **Station coordinates are city-centroid geocodes.** `pilotPriceIngest.ts` places sites by geocoding *city + state* (the email has no addresses). Its own comments call the Pilot locations export "the precision upgrade." For a corridor matcher with a 2.5-mile buffer and detour-fuel math this is a **correctness/safety issue**, not cosmetic: a station placed at a city centroid can be miles from the actual exit.
3. **Price freshness = one manual upload per day, one org.** The dispatcher uploads the Pilot email attachment (`PriceUploadCard`). There is no automated posted-retail baseline for any brand, and nothing at all for non-Pilot stations — the solver falls back to estimates there.
4. **Prices are tenant-coupled.** Today's only price row is Silvicom's *net* price. Posted retail (a global fact) and negotiated net (a per-carrier fact) are not yet separated in the data flow — the schema supports it (`posted_price` + `net_price` columns exist) but ingestion doesn't populate a shared posted layer.
5. **Ingestion runs inside the tenant app.** For many companies, station registry + posted prices must be ingested **once, centrally**, and served to all tenants; only the net/discount overlay is per-tenant.
6. **No licensing posture yet.** Scaling beyond Pilot's own email means either chain partner APIs or licensed aggregators; scraping is a legal dead end for a commercial multi-tenant product (see §2.5).

**Good news:** the hard architectural decisions were already made correctly — global station registry, per-org prices, brand-agnostic solver, price-age/confidence plumbing, discount-rule models. What's missing is **data acquisition + a central ingest layer**, not a redesign.

---

## 2. Data source research (verified July 2026)

### 2.1 Reality check on "real-time"

No commercial source offers true real-time pump-price telemetry. Pump prices change typically 1–2×/day; the best available cadences are: chain sites/APIs updated intra-day, Barchart "event-based" updates, TomTom 10-min *server* refresh (of an upstream that changes far less often), Fuelbook "multiple times daily from fuel-card transactions", and OPIS daily (90% of stations daily, 95% within 48h). **"Near-real-time" should be defined as: intra-day for major chains, ≤24h everywhere, with `observed_at` + TTL surfaced to the user** — which the system already models.

### 2.2 Tier A — Licensed aggregators (the long-tail backbone)

| Provider | Coverage | Products/fields | Cadence | Access | Redistribution |
|---|---|---|---|---|---|
| **OPIS** (Dow Jones) — [retail fuel prices](https://www.opis.com/product/pricing/retail-fuel-prices/), [Truckstop Spread Report](https://www.opis.com/product/pricing/retail-fuel-prices/truckstop-spread-report/) | ~9,000 US truckstops + **~400 Canadian** (their pages also say 6,000+ — clarify in sales call); 150k NA outlets overall | Retail diesel incl. ULSD/bio, taxes, margins; auto-adds new truckstops | Daily (90% daily / 95% 48h) | Daily files/FTP/email, custom feeds; API via [ICE developer portal](https://developer.ice.com/fixed-income-data-services/catalog/opis-oil-price-information-service) | **Proven**: powers Google, Waze, AAA. Negotiated enterprise license (expect 5–6 figures/yr) |
| **ProMiles** — [Fuel Finder](https://www.promiles.com/fuel-finder/), [FuelOpt](https://admin.promiles.com/FuelOpt/) | 18k+ locations along truck routes, trucking-native | Diesel **and DEF**; handles cost-plus/negotiated discount models | Daily "near real-time" | SOAP/REST web services ([docs](https://documentation.dev.promilesonline.com/)) | Licenses to TMSs in practice (TruckLogics etc.); terms unpublished — direct bizdev. Note: they are also a potential competitor (they sell fuel optimization) |
| **Barchart OnDemand** — [getFuelPrices](https://www.barchart.com/ondemand/api/getFuelPrices), [retail fuel prices](https://www.barchart.com/cmdty/data/retail-fuel-prices) | 6,000+ US travel centers (+Canada per API doc) | Station prices + **truckstop amenities (showers, truck spaces, DEF lanes, scales)**, history to 2019, national DEF index | Event-based/daily | Clean REST API | **Explicitly offers "software distribution or enterprise licensing"** — the most ISV-friendly published posture |

**DTN is not a fit** for pump prices (wholesale/rack only) — but rack data is useful later for validating cost-plus discount math.

### 2.3 Tier B — Chain-official data (free or partner-level; the precision layer for the majors)

| Chain | Locations | Prices | Machine path | Legal |
|---|---|---|---|---|
| **Pilot / Flying J / ONE9** (~875 sites incl. Canada) | [locations.pilotflyingj.com](https://locations.pilotflyingj.com/search) with **"Download All Locations"** (store #, exact lat/lng — fixes our centroid problem) | [pilotcompany.com/fuel-prices](https://pilotcompany.com/fuel-prices): public network-wide table **with "Download Fuel Prices" button** — diesel, DEF, bio blends | Public bulk downloads; **no developer program** (internal MuleSoft APIs only) | Public download buttons are an explicit channel for pulls; for redistribution get a written data license (bot-protected site, JS-rendered ToS) |
| **Love's** (~650 stops) | Per-store pages + search | Public per-store diesel + auto-diesel | ⭐ **Official partner API**: [developer.loves.com](https://developer.loves.com/) "Store & Fuel Prices" Experience API — **all stores + prices in one OAuth call**, filterable by product code. Access via request/sales rep | ToS **prohibits scraping**; the API is the sanctioned path — this is the single best chain opportunity |
| **TA/Petro** (BP; ~300 sites) | [Developer portal](https://www.ta-petro.com/developers/): Location & Amenities, Parking, Showers APIs (Swagger, token by request form) | Prices are public on server-rendered store pages (+ TruckSmart app) but **not in the API today** — ask BP/TA to add pricing to the token grant | REST APIs for locations; prices HTML-only for now | ToS prohibits robots/scraping incl. "manual process to monitor or copy" — go through the developer program |
| **Kwik Trip** | [HTML store table](https://www.kwiktrip.com/maps-downloads/store-list) with store#, lat/lng, diesel/DEF flags | No | Trivially parseable table | Friendly posture |
| **Road Ranger** | Public price pages, "updated at least daily" | Yes, public | Legacy HTML | No API |
| **Canada cardlocks** (Petro-Pass, Esso [140+ sites, **Excel download**](https://essocardlocks.ca/en/sites/), Cenovus/Husky, Flying J Cardlock) | Locations yes | **Never prices** — cardlock pricing is contractual | Locators/Excel | Canada posted-price coverage will structurally lag the US; net prices there come from card/contract data |

### 2.4 Tier C — Map platforms (display-only; NOT usable for our database)

- **Google Places API (New)** `fuelOptions` has `DIESEL`/`TRUCK_DIESEL` fields (OPIS-backed), **but** terms allow caching only lat/lng for max 30 days, prohibit building a stored/redistributed database, and the SKU pricing (~$25–40/1k requests) would be ~$2M/yr at polling scale. **Ruled out** ([terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)).
- **HERE Fuel Prices API** — schema actually models **Truck Diesel and US cash-price variants** ([API ref](https://docs.here.com/fuel-prices/reference/fuelstationssearch)) but coverage/cadence undocumented, contact-sales, resale-restricted. Worth one question in our existing HERE relationship, but don't plan on it.
- **TomTom Fuel Prices** — US/CA listed, 10-min refresh, but gated "automotive-only", not in PAYG. Ruled out.

### 2.5 Tier D — Crowdsourced / gray (avoid as foundation)

- **GasBuddy** (PDI): no public API in 2026, auto-island bias (truck-lane diesel differs by $0.30–$1.00+), scrapers violate ToS.
- **Trucker Path**: ToS bans scraping *and* "competing with Trucker Path" — a fleet fuel feature is squarely competitive. No data API.
- **Rootz Fuel Intel** (fuel.rootz.global): open REST API, 3,000+ stations attested every 4h — but it's **scraped chain data**; legally fragile upstream for a paid product. Useful as a free QA cross-check only.
- **Fuelbook**: 12k+ stops, prices from actual fuel-card transactions multiple times daily — methodologically excellent, **no API/licensing published**; worth a BD email.
- **OpenStreetMap**: usable as a *supplement* for independent-station existence; sparse `hgv`/diesel tags, no prices, and **ODbL share-alike** contaminates a blended proprietary DB — keep OSM-derived rows segregated and attributed if used at all.

### 2.6 Net (negotiated) prices — the per-carrier layer

Verified conclusion: **no central feed of per-carrier negotiated prices exists anywhere.** The industry patterns are:

1. **Per-tenant ingestion of the carrier's own daily price files/emails** (what we do for Silvicom/Pilot today) — this is exactly how ProMiles FuelOpt and Trimble Expert Fuel onboard each carrier's deals. Our model generalizes: one adapter per chain-format, per-tenant credentials/consent.
2. **Discount-rule computation**: `net = posted_retail − rule` (flat / retail-minus) or `cost_plus` off rack — our `fuel_discount_rules` table already models this; a global posted layer makes it work for any chain.
3. **Card-network transaction files** (WEX/EFS, Comdata → the Motive/Samsara/Fleetio pattern): carrier-authorized SFTP CSVs of *price paid* — retrospective, but a superb **observed-net QA layer** (we already ingest EFS). Note: "EFS PriceNet" does not exist; don't chase it.
4. **Partner deals with discount-card issuers** (precedent: TruckSmarter × TCS embedding stop-level net cost) — a possible future differentiator.

---

## 3. Target architecture: centralized fuel-data service

### 3.1 Two-layer price model (the key design decision)

```
GLOBAL (one copy, all tenants)                    PER-TENANT (each carrier)
┌─────────────────────────────────┐              ┌────────────────────────────────┐
│ fuel_stations   (registry)      │              │ fuel_discount_rules (deals)    │
│  brand, store#, EXACT lat/lng,  │              │ tenant price files (email/SFTP)│
│  state, exit, diesel/DEF, status│              │ EFS/Comdata observed net       │
├─────────────────────────────────┤              └───────────────┬────────────────┘
│ fuel_prices_posted (global)     │                              │
│  station, product, posted cash/ │       net price resolver:    │
│  credit, source, observed_at,   ├──► posted − rule │ tenant file │ observed ──► solver
│  confidence                     │      (best available, confidence-ranked)
└─────────────────────────────────┘
```

- **Posted retail is a global fact** → ingest once centrally, share across all orgs. New table `fuel_prices_posted` (global, RLS like `fuel_stations`: all orgs read, service-role writes), append-only with latest-per-station view.
- **Net is per-org** → existing `fuel_prices` becomes the tenant overlay; the resolver picks, per station, the best of: tenant's own file price (freshest, authoritative) → posted − discount rule → observed EFS median → brand/region estimate (existing fallback), and propagates the confidence tier the solver already displays.

### 3.2 Central ingest service

Extract ingestion out of the tenant request path into the existing **scheduler + jobs ledger** pattern, one `PriceSource`/`StationSource` adapter per feed (the Phase 8 seam, now real):

| Adapter | Kind | Cadence | Effort |
|---|---|---|---|
| `pilot_locations_export` | stations (exact lat/lng) | quarterly + on-demand | S — replaces centroid geocoding |
| `pilot_public_prices` | posted (diesel+DEF, ~875 sites) | 2–4×/day | S |
| `loves_api` | stations + posted | intra-day (their cadence) | M — OAuth partner onboarding |
| `ta_api` + `ta_prices` | stations now, prices when granted | daily+ | M |
| `aggregator` (OPIS / Barchart / ProMiles — pick after quotes) | posted, long tail incl. independents + Canada | daily / event-based | M — file/REST ingest |
| `chain_price_email` (per-tenant, per-chain format) | tenant net | daily | S per format (Pilot exists) |
| `efs_transactions` | observed net (QA) | daily | exists — add cross-check job |
| `osm_supplement` (optional, segregated) | independent-station existence | quarterly | S |

**Reliability machinery (reuse existing patterns):** per-source completeness/row-count checks (the Pilot-email pattern), freshness ledger + per-source SLA alerts, price-vs-EFS-actual reconciliation as a standing accuracy metric, station-closure detection (status flips are safety-critical), and cross-source disagreement flags (e.g., aggregator vs chain-site divergence > threshold → hold, don't publish).

### 3.3 Distribution to many companies

- Near term (same Supabase): global tables + RLS already give every org shared read of stations/posted prices with zero replication — **no new infra needed to onboard carrier #2**.
- Later (if the app is deployed per-customer or white-labeled): promote the ingest service + global tables to a standalone **Fuel Data Service** (dedicated Postgres + small API: `GET /stations?bbox`, `GET /prices?station_ids&product`, `GET /health/freshness`), with tenant apps caching latest-per-station locally. The schema doesn't change — only where it lives.
- **Licensing guardrail:** aggregator contracts will constrain redistribution (per-seat/per-app terms). Keep source-tagging on every price row so a feed can be contractually scoped, swapped, or removed per tenant without schema surgery.

### 3.4 Honest freshness semantics

Every price row keeps `source`, `observed_at`, `confidence`; the plan UI already shows price age and estimates. Define and display per-source SLAs: chain APIs/pages = intra-day; aggregator = ≤24–48h; tenant file = as-delivered; estimates = flagged. This is the defensible version of "near-real-time" and matches what the best competitors actually have.

---

## 4. Phased plan (dependency-ordered, each shippable)

**Phase A — Precision + automation on what's free (1–2 weeks of work)**
1. Ingest Pilot "Download All Locations" → exact lat/lng, store #, DEF flags; replace city-centroid coords (fixes a live correctness issue for Silvicom today).
2. Automate Pilot public "Download Fuel Prices" (diesel+DEF, whole network) → new global `fuel_prices_posted`; keep Silvicom's email as its net overlay. Add Kwik Trip + Road Ranger station loaders.
3. Ship the net-price resolver (tenant file → posted−rule → observed → estimate) + freshness ledger.
**Exit:** every Pilot-network station precisely placed with intra-day posted prices, architecture ready for any tenant.

**Phase B — Chain partner APIs (business development, in parallel)**
4. Apply for **Love's Store & Fuel Prices API** access (developer.loves.com / sales rep) — one OAuth call for all stores+prices; the highest-value single integration available.
5. Request **TA developer portal** token (locations/parking now); ask BP/TA about adding prices to the grant.
6. Open a data-license conversation with **Pilot** to put the downloads usage on contractual footing for redistribution.
**Exit:** the big three (~1,850 premium truckstops — where the large majority of OTR fueling happens) covered legitimately with fresh posted prices.

**Phase C — Aggregator license for the long tail (when a customer needs independents/Canada)**
7. Get quotes from **Barchart** (explicit software-distribution licensing; ask upstream source + Canada counts), **OPIS** (Truckstop Spread Report + custom feed; ask cash/credit fields, DEF, the 6k vs 9k number, embedding terms à la Google/AAA), **ProMiles** (DEF coverage, Canada, willingness to license to a potential competitor). Pick one; ingest as `aggregator` adapter.
**Exit:** ~8–18k locations incl. independents + ~400 Canadian truckstops, ≤24–48h freshness, contractually redistributable.

**Phase D — Multi-tenant net-price productization**
8. Generalize `chain_price_email` adapters (Love's/TA daily net files use different formats), per-tenant credentials via existing `integration_credentials`, discount-rule calibration against EFS actuals (auto-fit cents_off; flag drift).
9. Card-network observed-net at scale: per-tenant WEX/EFS + Comdata SFTP transaction feeds (the established ISV consent pattern) as the standing accuracy layer. **Check each tenant's MSA before any cross-tenant use of observed prices.**
10. If/when standalone deployments arrive: extract the Fuel Data Service (§3.3).

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Scraping temptation (Love's/TA/Trucker Path ToS explicitly prohibit; GasBuddy/Rootz legally fragile) | Only chain-official downloads/APIs + licensed aggregators; source tag on every row; kill-switch per source |
| Aggregator cost (5–6 figure/yr, contact-sales) | Phase B first — majors are free/partner-level; buy the long tail only when revenue justifies |
| Love's/TA API access is discretionary | Parallel-track all three chains + aggregator quotes; any one of OPIS/Barchart/ProMiles covers the majors too (redundancy) |
| Coordinate/registry drift (closures, new stores) | Quarterly location re-ingest, closure = safety-critical status flip, cross-source existence checks |
| Cash vs credit ambiguity (chains post one price; card networks hold the split) | Store `price_kind` on posted rows; treat tenant net files/EFS actuals as authoritative for what the carrier actually pays |
| ProMiles/Trimble competitive conflict | Prefer Barchart/OPIS for raw data; keep ProMiles as fallback |
| OSM ODbL share-alike contamination | Segregate OSM-derived rows; use only for existence hints, never blended silently |
| Canada posted prices structurally scarce (cardlock model) | Set expectations: Canada = locations + contract/observed net, not posted retail |

## 6. Bottom line

The system was architected for exactly this move — global station registry, per-org net overlay, source/confidence plumbing, adapter seams. The expansion is a **data-acquisition program, not a rewrite**: (A) automate Pilot's own public exports and fix coordinates now, (B) sign the Love's partner API and TA developer program, (C) license one aggregator (Barchart first call, OPIS the gold standard) for independents + Canada, (D) generalize the net-price overlay per tenant. "Near-real-time" is achievable and honest as intra-day for the majors and ≤24–48h for the long tail — the same or better than what ProMiles/Trimble-class products actually run on.

---

# Phase A — BUILT (2026-07-16)

**Verified against real files** (`data-samples/`): locations export 877/877 rows parsed (0 skipped, 0 unknown brands, 9 brands, 55 Canadian sites, 725 diesel / 653 DEF); public price .xlsx 875/875 stations → 1,719 diesel+DEF rows, all 87 Canadian rows flagged CAD/L; the JS-hydrated page save (25 rows) correctly FAILS the 700-row completeness gate. Typecheck / 741 tests / build green; new+modified files lint clean.

**Data spine (0063):** global `fuel_prices_posted` (posted retail = shared facts; all orgs read, service-role writes; currency+unit per row — Canadian sites quote CAD/L and are never naively compared), station precision columns (`address/city/zip/country/phone/parking_spaces/fuel_lane_count/shower_count/amenities`, `coord_source` exact_export|geocoded_city, `location_updated_at`), `route_fuel_settings.enabled_brands`.

**Shared (pure, tested):** `brands.ts` (name→brand map from the real export's 20 name variants; `PILOT_FAMILY_BRANDS`; unknown names flagged, never guessed), `pilotLocationsExport.ts`, `pilotPublicPrices.ts` (.xlsx + SSR-HTML parsers, one row shape), `effectivePrice.ts` (fresh tenant net → fresh posted−rule → history → brand median → none; CAD/L rejected; net≤0 rejected). `PriceBasis` gains `posted_discount`.

**API:** `pilotLocationsIngest` (match by store # FAMILY-WIDE, update in place — id/brand fixes preserve all price FKs; movedFar audit; missing-from-export reported, never auto-closed), `postedPriceIngest` (idempotent per source+observed_at; unmatched counted), `postedPriceFetch` + scheduler (`PILOT_POSTED_FETCH_HOURS`, default 6h; parse gate + ≥700-row completeness gate + $2–9 diesel-median sanity gate — a bad fetch writes NOTHING), routes `POST /fueling/locations`, `/posted-prices`, `/posted-prices/fetch`; planner filters stations to `enabled_brands` and prices via `resolveEffectivePrice`; `GET /stations` now lists the full enabled-network registry with price basis + coord precision. **Email ingest fixed:** resolves sites family-wide by store # (no more brand='pilot' duplicates) and never overwrites exact coordinates with centroids; only never-seen sites geocode.

**Web:** Truck stop networks checkboxes (settings, admin), StationDataCard on Import (locations .csv upload, posted .xlsx upload, Fetch now), Truck Stops page shows network filter, ≈ location precision badge, posted−disc. basis.

**Still open (Phase A tail):** confirm the SERVER-rendered fuel-prices HTML with a one-off curl sample (`data-samples/fuel_prices_server.html`) — the parser is structure-validated but the automated fetch stays gate-protected either way; first live `Fetch now` after `apply_0063.sql` is the acceptance test. Then: upload the locations export in Import to fix all coordinates.

# Phase B (regionals) — BUILT (2026-07-16)

**Kwik Trip / Kwik Star** (`kwik_trip`): store-list parser verified on the real page (936 rows, 0 skipped, exact coords). SAFETY FILTER: only the chain's official Truck-Friendly list ∩ sells-diesel enters the registry — **368 stations** (list shipped as versioned constant `kwikTripTruckFriendly.ts`, source PDF + extraction date recorded; 10 list entries not yet in the table are reported, never invented). Admin "Sync Kwik Trip" button; parse + ≥700-row completeness gates. No public prices (locations only, `coord_source='exact_export'`).

**Road Ranger** (`road_ranger`): prices-page parser verified on the real page (56 rows, "Data last updated" Central-time stamp → ISO). Stations keyed by deterministic address slug (page has no store numbers; zero collisions on the real network), geocoded at ADDRESS level via the shared cache (`coord_source='geocoded_address'`). Prices are **truck-diesel CASH** → `fuel_prices_posted.price_kind='cash'` (migration 0064) so cash and card quotes are never blended silently. Runs on the posted-price scheduler tick (independent failure domains) + admin fetch button; parse/≥40-row/median gates.

`PILOT_FAMILY_BRANDS` decoupled from the brand catalog (fixed list) so non-Pilot networks can never be matched into the Pilot numbering space. Both networks appear in the settings toggles (off by default for existing orgs — `enabled_brands` default stays pilot/flying_j/one9). Verified: typecheck, 631 shared+API+web tests, build, E2E on the full real files.

**Follow-up (small):** surface `price_kind` as a "cash" badge on the Truck Stops page and in plan stop rows; consider a weekly auto-sync for Kwik Trip locations.
