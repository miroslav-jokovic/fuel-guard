# 14 — Idle Tracking & Driver Fuel Scoring (analysis + plan)

Goal: track truck idling precisely, classify it (wasteful vs justified vs optimized), and score drivers so the
fleet can cut idle fuel spend. This is the plan; nothing is built yet.

## 1. What Samsara gives us (exact, SDK-verified fields)

### `GET /idling/events` — the primary feed (scope: Read Idling; data from 2024-01-01; 5 req/s; cursor `after`/`endCursor`; `limit` 1–200)
Request params: `startTime`/`endTime` (RFC3339, required), `assetIds`, `operatorIds`, `ptoState`
(`active|inactive`), `minAirTemperatureMillicelsius`/`maxAirTemperatureMillicelsius` (−20000..50000),
`minDurationMilliseconds`/`maxDurationMilliseconds` (120000..86400000 = 2 min–24 h), `tagIds`.

Per-event response fields (exact):
- `eventUuid` — the event id (no `id`).
- `startTime` (RFC3339); **`durationMilliseconds`** — there is **no `endTime`** (compute end = start + duration).
- `asset.id` — Samsara **vehicle** id; `operator.id` — Samsara **driver** id (present only when a driver was
  assigned; else resolve via `/fleet/driver-vehicle-assignments` for that vehicle+time).
- `ptoState` (`active`/`inactive`); `airTemperatureMillicelsius`; `fuelConsumedMilliliters`;
  `fuelCost` `{amount, currency}` (usd…); `latitude`/`longitude`; `address` `{id, addressTypes[]}` where
  addressTypes includes **`yard`, `customerSite`, `vendor`, `workforceSite`** (great for "at a shipper / in the
  yard" context).

### `GET /fleet/vehicles/stats/history` (+ `/feed` for real-time) — RAW signals for the optimized-idle layer
Scope: Read Vehicle Statistics. **Max 3 `types`, max 2 `decorations`** per call. Fields + units:
`engineStates` (**enum `Off` | `On` | `Idle`** — the key signal), `batteryMilliVolts`,
`ambientAirTemperatureMilliC` (milli-°C), `engineCoolantTemperatureMilliC`, `obdEngineSeconds` (cumulative s),
`idlingDurationMilliseconds` (cumulative ms), `fuelConsumedMilliliters` (cumulative mL), `engineRpm`,
`engineLoadPercent`, `ecuSpeedMph`, `gps`, and `auxInput1`–`auxInput13` (where a PTO or an **auxiliary engine /
APU** is wired, it shows up here — dashboard-labeled). Feed: cursor-driven, poll ≥5 s apart.

**No dedicated APU field and no engine-start counter exist** — we derive optimized-idle cycling ourselves from
`engineStates` transitions (`On/Idle → Off → On/Idle`) plus `batteryMilliVolts`, and read `auxInput*` when an
APU is wired.

**Samsara's idle definition** (we mirror it): engine on + not moving **> 2 minutes**, excluding PTO/aux.

**Benchmarks** (for the $ math and targets): Class-8 idle burns **~0.8 gal/hr** (APU ~0.2–0.5); ~**$3.20/idle
hour** at $4/gal; a long-haul truck idles ~1,800 hr/yr ≈ ~1,500 gal ≈ **$4–6k/truck/yr**. Fleet average idle is
~**25%** of operating time; good <15%, best <10%. So this feature has real, quantifiable savings.

## 2. What WE build

We don't have any idle data or driver scoring today (we only fetch gps/fuel/odometer, and there's no driver
score table). So the feature is net-new but bounded.

### 2a. "Is the truck REALLY idling?" (precise determination)
Samsara's event feed already applies engine-on + stationary + >2 min + PTO exclusion. We add our own
classification so a driver isn't penalized for justified idle:

For each idle event, classify (pure, testable `classifyIdleEvent`):
- **Productive** — `ptoState = active` (equipment/PTO work). Excluded from the driver penalty.
- **Justified (climate)** — air temperature outside a comfort band (default `< 20°F` or `> 85°F`): cab
  heating/cooling is legitimate. Down-weighted, not penalized as waste.
- **Discretionary (wasteful)** — engine on, no PTO, moderate temperature, sustained beyond the threshold. **This
  is what we score against.**
- Below the minimum duration (default 5 min for "significant" — configurable, ≥ Samsara's 2 min floor) → ignored
  as a normal short stop.

### 2b. The real target: REST / WAIT / LOAD sessions (where the money is)
The goal is behavioral: when a driver is **sleeping, loading/unloading, or waiting**, they should use the APU
or ECU optimized idle — **not** run the main engine. Overnight/long idle is the dominant cost, so we score at
the level of **stationary sessions**, not just individual 2-minute events.

Define a **park session** = the truck stationary (`ecuSpeedMph≈0` / `gps` speed 0) for ≥ a threshold (default
30 min), optionally anchored to a geofence (`address.addressTypes` = `yard`/`customerSite` → "at a shipper").
Across each session, from `engineStates` we measure: continuous main-engine idle time, engine-**Off** time, and
the On/Idle↔Off **cycling** pattern, then assign the session an **idle mode**:
- **`continuous`** (bad) — sustained engine `Idle`, few/no Off transitions → burning fuel to sleep/wait.
- **`optimized_cycling`** (good) — frequent `On/Idle → Off → On/Idle` cycling, battery-correlated → the ECU's
  auto start/stop is managing it.
- **`apu_or_off`** (best) — mostly engine `Off` during a long park in climate-demanding weather (APU carrying
  hotel load, or genuinely shut down).

A driver who runs a 10-hour continuous idle overnight (~8 gal, ~$32 wasted) must NOT score like one who used the
APU. This session-level idle-mode is the "is it *really* wasteful" precision. (Needs the stats pull — Phase 2.)

### 2c. Learned patterns (per your ask — set + learn, don't hard-guess)
- **Per-truck capability (mixed fleet):** we don't ask you to tag which trucks have an APU vs ECU optimized
  idle. We **learn it** from history — a truck whose park sessions routinely show On↔Off cycling has ECU
  optimized idle; one that sits engine-`Off` through long climate-demanding parks has an APU (or its aux-engine
  input fires). Store a learned `idle_capability` per vehicle so its drivers are scored against what the truck
  can actually do.
- **Temperature justification (learned band, not a blind guess):** start with a configurable comfort band, but
  **learn** the fleet's real one — the ambient-temp range in which drivers do NOT idle is the comfortable band;
  idle inside it is discretionary, idle well outside it (deep cold / high heat) is justified climate use. This
  adapts to your fleet/regions instead of a fixed 20–85°F guess.

### 2d. Driver fuel score (the leaderboard)
Per driver, over a period (7/30/90 d), aggregate: idle hours (total, discretionary, justified, productive),
idle **fuel gallons** and **$ cost**, **idle % of engine-on time**, count of long idles (>1 hr), and
**optimized-idle adoption %** (share of parked time that was cycling/APU vs continuous). Then a **score** and
**rank**:

- Primary score driver: **discretionary idle % of engine-on time**, normalized to the fleet, temperature- and
  PTO-exempt so it's fair. Target bands (green <10%, amber 10–20%, red >20%).
- Surface **$ wasted** and **$ savable** (discretionary idle gal × fuel price) so it's tied to money, and a
  fleet total "idle spend / potential savings."
- Pure, tested `scoreDriverIdle(events, opts)` → metrics + score; a ranked leaderboard on top.

## 3. Data model (proposed)
- **`idle_events`**: `org_id, vehicle_id, driver_id, started_at, ended_at, duration_sec, lat, lng, geofence,
  pto_active, air_temp_f, fuel_gal, cost_usd, classification, idle_mode, source ('samsara'), samsara_event_id`.
  Unique on `(org_id, samsara_event_id)` for idempotent sync.
- Driver/vehicle scores computed on read (or a small materialized summary) from `idle_events` — no need to
  persist scores initially.
- Config in `anomaly_thresholds` (or a new `idle_settings`): `min_idle_minutes`, `climate_low_f`,
  `climate_high_f`, `idle_gal_per_hour` (default 0.8), `fuel_price_per_gal`.

## 4. Ingestion
- New Samsara fetchers: `makeSamsaraIdlingEventFetcher` (`/idling/events`, windowed + paginated) and (Phase 2)
  reuse the stats fetcher for `engineStates`+`batteryMilliVolts`+temps.
- New service `syncIdleEvents(admin, env, orgId)`: pull events since the last sync, map `assetId→vehicle` and
  `operatorId→driver` (fall back to our driver-assignment/attribution), classify, upsert. Runs on the Samsara
  scheduler (~daily) + on demand. **Token needs the *Read Idling* (and *Read Fuel & Energy*) scope.**

## 5. UI
- New **Idling** page (under Analysis): a **driver leaderboard** (rank, driver, idle %, discretionary idle hrs,
  $ wasted, optimized-idle %, score) using the standard `TableToolbar`; a fleet summary (total idle hrs, idle
  spend, potential savings, fleet idle %); per-truck idle; and a driver drill-down. Read-only, like Coverage.

## 6. Phasing
1. **Phase 1 (core value):** `/idling/events` sync + `idle_events` table + classify (productive/justified/
   discretionary) + driver leaderboard + fleet $ summary. Delivers the money view fast.
2. **Phase 2 (precision):** optimized-idle detection (continuous vs cycling vs APU) from `engineStates` — the
   "really wasteful?" layer + optimized-idle adoption in the score.
3. **Phase 3:** targets, trends over time, and an idle alert (long discretionary idle) — optional.

## 7. Decisions (from the fleet) — locked
1. **Mixed fleet:** some trucks APU, some ECU Optimized Idle → we **learn `idle_capability` per truck** (§2c),
   no manual tagging.
2. **Temperature:** configurable band **plus learned** fleet comfort band (§2c).
3. **$ math:** fuel price = **actual EFS $/gal**; idle burn **0.8 gal/hr** (override per truck if we learn a
   better rate from `fuelConsumedMilliliters` during idle).
4. **Behavioral goal:** during **sleep / load-unload / wait** sessions, drivers should use APU or optimized
   idle, not continuous main-engine idle. Score = discretionary continuous-idle time/$ per session, rewarding
   APU/optimized use; leaderboard to drive the behavior.
5. **Token:** full-access (Read Idling + Vehicle Statistics + Fuel & Energy present). ✓

## 8. Build order (proposed)
- **Phase 1 — money view:** `syncIdleEvents` off `/idling/events` (windowed, cursor, driver via `operator.id`
  → our drivers, incl. the new auto-provisioned ones) → `idle_events` table → classify productive/justified/
  discretionary → driver leaderboard + fleet idle-$ summary + Idling page. Ships the dollar visibility fast.
- **Phase 2 — precision:** park-session builder from `engineStates`(+`gps`,`batteryMilliVolts`,temp) → per-
  session idle-mode (continuous / optimized_cycling / apu_or_off) + learned per-truck `idle_capability` →
  fold "optimized-idle adoption" into the score so cycling/APU trucks aren't penalized.
- **Phase 3 — learned temp band + alerts + trends** (optional): learned comfort band, long-continuous-idle
  alert, week-over-week driver trend.
