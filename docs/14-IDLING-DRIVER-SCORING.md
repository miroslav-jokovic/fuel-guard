# 14 — Idle Tracking & Driver Fuel Scoring (analysis + plan)

Goal: track truck idling precisely, classify it (wasteful vs justified vs optimized), and score drivers so the
fleet can cut idle fuel spend. This is the plan; nothing is built yet.

## 1. What Samsara gives us (so we don't reinvent it)

Samsara already classifies idle server-side. The key source is the **Idling Events API**:

- **`GET /idling/events`** (scope: *Read Idling*, data from 2024-01-01) — discrete idle events per asset with
  **duration, PTO state, air temperature, geofence, fuel used, and estimated cost**, already filterable to
  "unproductive" idle. Filters: `startTime`/`endTime`, `assetIds`, `operatorIds`, `ptoState`,
  `minDurationMilliseconds` (2 min–24 hr), air-temp bounds. **This is our primary feed.**
- **`GET /fleet/reports/vehicle/idling`** (legacy) — for pre-2024 history if needed.
- **Vehicle Stats API** (`/fleet/vehicles/stats/history`, ≤3 `types`/call) for RAW signals when we need to
  compute or refine: `engineStates` (Off/On/**Idle**), `idlingDurationMilliseconds` (cumulative),
  `fuelConsumedMilliliters` (cumulative), `engineRpm`, `engineLoadPercent`, `batteryMilliVolts`,
  `ambientAirTemperatureMilliC`, `engineCoolantTemperatureMilliC`. PTO is exposed via `ptoState` on idle events
  (and `auxInput*`).

**Samsara's idle definition** (we mirror it): engine on + not moving **> 2 minutes**, excluding PTO/aux. It has
configurable "Unproductive Idling Rules" (min duration, air-temp exemption for cab climate, PTO exemption).

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

### 2b. "Is the truck using OPTIMIZED IDLE?" (the custom, higher-precision layer)
"Optimized idle" has two real meanings; we detect both from `engineStates` over each parked period:
- **Continuous manual idle** — one long engine-**On/Idle** block while `speed = 0`. Wasteful.
- **ECU Optimized Idle** — engine **On↔Off cycling** while parked (auto start/stop to hold battery/temp),
  corroborated by `batteryMilliVolts` restarts near ~12.2 V and temperature swings. Efficient → good.
- **APU / engine-off** — engine **Off** while parked in climate-demanding weather (long parked, engine off) →
  APU likely carrying hotel load. Best → no main-engine idle.

So each parked period gets an **idle mode**: `continuous` (bad) / `optimized_cycling` (good) / `apu_or_off`
(best). This is the "is it *really* wasteful" precision the fleet cares about — a truck that cycles or runs an
APU should NOT score the same as one burning fuel in a 3-hour continuous idle. (Phase 2 — needs the stats pull.)

### 2c. Driver fuel score (the leaderboard)
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

## 7. Open questions before building
1. **Do your trucks have APUs and/or ECU Optimized Idle** enabled? (Determines how much weight to give the
   optimized-idle classification, and whether "engine off while parked" is expected.)
2. **Fuel price + idle burn rate** to use for the $ math (default $/gal from EFS actuals; 0.8 gal/hr idle)?
3. **Idle threshold + climate band** for "discretionary" (default: >5 min, comfort band 20–85°F)?
4. **Score target** the drivers are held to (e.g., discretionary idle <10% of engine-on time)?
5. Confirm the Samsara token has the **Read Idling** scope (needed for `/idling/events`).
