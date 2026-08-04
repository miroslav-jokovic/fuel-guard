# Handoff — Assignments board rewire + driver current location (telematics-sourced)

**Audience:** a fresh implementation chat. **Bar:** enterprise-grade, verify-before-you-build, assume nothing.
**Repo:** `/Users/miroslavjokovic/Projects/FuelGuard` (pnpm monorepo: `apps/api`, `apps/web`, `packages/shared`).

---

## 0. What this is and where it sits

FuelGuard is a fuel-card + telematics anomaly/fleet app for a trucking fleet (~192 trucks, ~336 active
Samsara drivers). This handoff covers the **last two pieces** of a larger HOS/telematics effort:

1. **Rewire the Assignments board** to be sourced from Samsara telematics (driver↔truck assignments + HOS),
   instead of the in-app "driver shift" feature the fleet does not use.
2. **Add driver current *city* location** to the Drivers page (today it shows current *truck* unit).

Everything else in the HOS effort is already built and (as of writing) committed. Don't redo it — build ON it.

### Already shipped / committed (verify with `git log`)
- `sync_hos` job pulls **`/fleet/hos/logs`** → `hos_duty_segments` (historical duty timeline) and, in the same
  job, **`/fleet/hos/clocks`** → stamps `drivers.current_hos_status` / `current_hos_vehicle` / `current_hos_at`.
- Shared parsers: `parseHosLogs`, `parseHosClocks`, `normalizeHosStatus`, `hosOverlapSeconds` in
  `packages/shared/src/hos.ts` (all tested in `hos.test.ts`).
- Samsara fetchers in `apps/api/src/lib/samsara.ts`: `makeSamsaraHosLogsFetcher`, `makeSamsaraHosClocksFetcher`.
- Drivers page already shows **HOS status** (badge) + **Current truck** (replaced Employee ID column).
- Idle sync chunked into 7-day windows + deduped by eventUuid (fixed Samsara 500/504 timeouts).
- MPG baseline training guard (2–15 MPG) fixed the false cumulative_overfuel/topoff/mpg alerts.
- Driver merge/reconcile, deactivation reconcile, trailer GPS co-location pairing (all trailers, not just reefers).
- **Migrations applied through `0111`** (`0111_driver_current_hos.sql` added `current_hos_*` to `drivers`).
- Samsara **diagnostics** endpoint + a "Run diagnostics" button on Settings → Data & Sync that returns the raw
  response **shape** of every Samsara endpoint (incl. HOS). Use it to re-confirm any shape.

---

## 1. Confirmed Samsara response shapes (from the fleet's LIVE diagnostics — do not re-guess these)

These were captured from the org's real Samsara via the diagnostics probe. All scopes returned 200.

**`GET /fleet/driver-vehicle-assignments`** (`assignments`, rawCount ~50):
```json
{ "startTime":"2026-08-03T19:14:40.060Z", "endTime":"2026-08-03T19:38:45.268Z",
  "isPassenger":false, "assignedAtTime":"", "assignmentType":"HOS",
  "driver":{ "id":"57168899", "name":"MICHAEL KENT" },
  "vehicle":{ "id":"212014918176378", "name":"556", "externalIds":{...} } }
```
Note: these are historical assignment *intervals* (start/end), assignmentType "HOS". The CURRENT truck per
driver is more reliably taken from **`/fleet/hos/clocks` → `currentVehicle`** (already synced to
`drivers.current_hos_vehicle`). Treat the assignment feed as corroboration / the "who's paired now" list.

**`GET /fleet/hos/clocks`** (`hosClocks`, rawCount ~500):
```json
{ "driver":{ "id":"...","name":"..." },
  "currentVehicle":{ "id":"...","name":"556" },
  "currentDutyStatus":{ "hosStatusType":"driving" },
  "clocks":{ "break":{"timeUntilBreakDurationMs":n}, "drive":{"driveRemainingDurationMs":n},
             "shift":{"shiftRemainingDurationMs":n},
             "cycle":{"cycleStartedAtTime":"...","cycleRemainingDurationMs":n,"cycleTomorrowDurationMs":n} } }
```
Duty-status enum (Samsara `hosStatusType`): `offDuty | sleeperBed | driving | onDuty | yardMove | personalConveyance`.
`normalizeHosStatus()` already maps these → `off_duty|sleeper|driving|on_duty|yard_move|personal_conveyance|unknown`.

**`GET /fleet/hos/logs`** (`hosLogs`, rawCount ~502) — already parsed; each entry has
`hosStatusType`, `logStartTime`, `logEndTime`, and `logRecordedLocation:{latitude,longitude}` (← useful for
location fallback), under a **`hosLogs`** array (NOT `logs`).

**`GET /fleet/vehicles/stats`** sample carries `fuelPercent`, `obdOdometerMeters`; diagnostics reported
`withGpsOdometer: 13`. GPS availability per truck must be VERIFIED (see audit item G1) — do not assume every
truck reports live GPS.

---

## 2. Audit FIRST — verify each of these in code before writing a line (assume nothing)

| # | Question to answer from the code | Where to look |
|---|---|---|
| A1 | Exact query behind the Assignments board + what each column renders | `listAssignments` in `apps/api/src/services/dispatchLoads/queries.ts`; `assignmentRowSchema`/`AssignmentRow` in `packages/shared/src/dispatchContract.ts`; page `apps/web/src/pages/AssignmentsPage.vue`; `apps/web/src/features/dispatch/useAssignments.ts`; route `apps/api/src/routes/dispatch.ts` (`/assignments`, `/assignments/:driverId/end`) |
| A2 | Is `driver_vehicle_assignments` a stored table, and who writes it? (idle sync derives intervals from idle-event operators — confirm whether the `/fleet/driver-vehicle-assignments` feed is persisted anywhere) | `grep -rn driver_vehicle_assignments supabase/migrations apps/api/src`; `apps/api/src/services/idleSync.ts` (`mergeOperatorAssignments`); `makeSamsaraAssignmentFetcher` in `lib/samsara.ts` |
| A3 | Current trailer per truck: is `trailers.assigned_vehicle_id` populated + its `pairing_source`? | `apps/api/src/services/reeferPairing.ts` (now pairs ALL gateway trailers), `apps/web/src/features/fleet/useTrailers.ts` |
| A4 | Does the board's "End shift" action make sense without in-app shifts? (likely hide it) | `AssignmentsPage.vue` + `useEndShift` |
| G1 | Do we persist per-vehicle CURRENT GPS (lat/lng)? The stats sync pulls `gps`/`gpsOdometerMeters` — confirm if lat/lng is STORED on `vehicles` or only odometer/fuel | `apps/api/src/services/samsaraVehicleSync.ts` (`syncVehicleStatsFromSamsara`), `vehicles` migrations, `makeSamsaraOdometerFetcher`/stats fetchers in `lib/samsara.ts` |
| G2 | Reverse geocoding (lat/lng → city): does it exist, or is geocoding forward-only? | `geocode_cache` table + `apps/api/src/services/*geocode*`/`lib/*geocode*`; station geocoding (`station_geocode_learned`); any Open-Meteo/Nominatim/Mapbox client |
| G3 | Fuel-planning already reads HOS clocks per **vehicle** — reuse its plumbing, don't duplicate | `apps/api/src/services/fuelPlanning.ts` (`makeSamsaraHosFetcher`) |

Only after A1–A4 / G1–G3 are answered from the code should you design the writes. If a source is missing
(e.g. no stored GPS), the feature DEGRADES to what's available (truck unit), it does not fabricate.

---

## 3. Feature 1 — Assignments board, telematics-sourced

**Goal:** the board shows, per active driver: **duty status**, **how long in it**, **current truck**,
**current trailer**, and (optional) **current load** — from telematics, not the unused in-app shift.

**Design (reuse the already-synced data — no new pull):**
- **Duty status** ← `drivers.current_hos_status` (already synced from clocks).
- **"On duty for" / time-in-status** ← derive from `hos_duty_segments` (latest segment's `started_at`) OR from
  a clocks-provided timestamp. Verify which is cleaner in A1/§1 before choosing; add a pure helper + test.
- **Current truck** ← `drivers.current_hos_vehicle` (already synced).
- **Current trailer** ← the truck's paired trailer (`trailers.assigned_vehicle_id` = the vehicle) → trailer unit.
- **Current load** ← keep the existing `loads` join if present; else "—".
- Rewrite `listAssignments` to build rows from drivers + current_hos_* + trailer pairing, instead of
  `driver_duty_sessions`. Keep `AssignmentRow` shape stable for the web (extend, don't break).
- **Degrade explicitly:** a driver with no HOS snapshot shows status "—" / "no ELD data", never a blank/broken
  row. Only include active drivers.
- **"End shift" action:** in-app shifts aren't used → hide the action (or gate it on an actual open
  `driver_duty_sessions` row). Confirm in A4.
- Board stays **read-only** + auto-refreshing (there's already a 30s ticker on the page).

**Files:** `dispatchLoads/queries.ts` (`listAssignments`), `dispatchContract.ts` (`AssignmentRow` if extended),
`AssignmentsPage.vue`, `useAssignments.ts`. Add pure helpers to `packages/shared` with tests.

---

## 4. Feature 2 — driver current *city* location

**Goal:** Drivers page shows the driver's current **city/area**, not just the truck unit.

**Design (pending G1/G2):**
- Source the truck's live GPS (from `vehicles` if stored per G1, else the latest `hos_duty_segments`
  `logRecordedLocation` lat/lng, else the vehicle stats GPS).
- **Reverse-geocode lat/lng → "City, ST"**, reusing existing geocode infra (per G2). If only forward geocoding
  exists, add a reverse call to the SAME provider + cache in `geocode_cache` (or a small rounded-coord cache).
- **Cache hard:** city changes slowly; round coords (e.g. ~0.1°) and cache; never geocode every sync or every
  page load. Reverse-geocode at most once per truck per sync tick.
- **Store** `drivers.current_location` (new column, migration `0112`) written by the same HOS sync alongside
  `current_hos_*`. Add a `schemaCheck` probe for it.
- **Degrade:** no GPS / geocoding down → fall back to the truck unit (already shown) or coords; never blank.
- Drivers page: add/relabel a **Current location** column (city) next to Current truck. Update
  `packages/shared/src/fleet.ts` `Driver`, `DRIVER_COLS` in `apps/web/src/composables/useDrivers.ts`, and the
  page cell.

**Cost/rate note:** reverse geocoding is an external call — respect the provider's rate limit, batch/cache, and
make it best-effort (`nonFatal`) so it can never fail the HOS sync.

---

## 5. Enterprise-grade requirements (hold to all)

- **Verify, don't assume:** confirm every table/column/endpoint against the code (audit §2) before use. Use the
  Samsara **diagnostics** button to re-confirm any live shape.
- **Reuse, don't duplicate:** one HOS sync already pulls clocks; extend it for location — no new Samsara feed.
- **Degrade explicitly + log:** every step where a feed can be absent shows a clear "—"/reason and logs; wrap
  external calls in the existing `nonFatal` pattern so they never break the parent sync.
- **Tests:** unit-test all pure logic (assignment-row assembly, time-in-status math, city resolution/caching,
  reverse-geocode parsing). Follow the existing fake-Supabase pattern in `idleSync.test.ts` / `hosSync.test.ts`
  for service tests.
- **Gates (must pass):** `node scripts/check-file-size.mjs` (≤500 lines/file), `node scripts/check-function-size.mjs`
  (≤200 lines/fn — extract helpers, do NOT grow grandfathered fns), `node scripts/check-feature-boundaries.mjs`,
  `tsc` on shared+api+web, `npx eslint <changed files>`.
- **Migrations:** next is `0112`. Follow the `0109/0111` style (idempotent `add column if not exists`, RLS
  mirrors `idle_events`, add a `schemaCheck` probe in `apps/api/src/services/schemaCheck.ts`).

---

## 6. Dev / test workflow in this environment (important gotchas)

- **All source lives on the device** at `/Users/miroslavjokovic/Projects/FuelGuard`, reached via
  `device_bash` / `device_stage_files` / `device_commit_files`. Edit there (python/heredoc via `device_bash`).
- **`tsc` and gate scripts run on the device** (node is there): `node node_modules/typescript/bin/tsc -p <proj>
  --noEmit`, `node scripts/check-*.mjs`. `web` tsc has TWO pre-existing `DataTableColumn` errors in
  `useIdlingPage.ts` + `useAnomaliesPage.ts` — ignore only those.
- **vitest does NOT run on the device** (rolldown native-binding failure). Tests run in the CLOUD:
  - shared → `/tmp/shtest` (copy changed `packages/shared/src/**` files in, then
    `node node_modules/vitest/vitest.mjs run [file]`).
  - api → `/tmp/fgws/apps/api` (copy changed api files + sync changed shared files into the linked copy at
    `/tmp/fgws/apps/api/node_modules/@fuelguard/shared/src/`). The api suite has ~9 pre-existing failures from a
    missing `@hazmat/data` workspace pkg in the sandbox — ignore ONLY those; all real tests pass.
- **`device_stage_files` has a stale-snapshot cache**: it sometimes returns an OLD copy of a file you just
  edited (same reported bytes but old content). WORKAROUND: `cp file.ts _uniquename.ts` on the device, stage the
  **uniquely-named** copy, use that, then `mv` the temp into `_to_delete/` (device_bash CANNOT `rm` — move to
  `_to_delete/`). Verify staged content with `grep -c <newsymbol>` before running tests.
- **Chaining gotcha:** `cd mnt/FuelGuard && … && cd mnt/FuelGuard && …` — the SECOND `cd` fails (already there)
  and aborts the rest under `&&`. Use ONE `cd` per command.
- **Deploy:** Railway builds web + runs api from `main` (see `railway.json`). Migrations are **manual** (apply
  in Supabase; there is no auto-migrate). Commit + push + apply migration, then Rebuild/Sync as needed.
- **Bridge is flaky** — it drops periodically. If it keeps dropping, the user can re-run the task **on their
  computer** (desktop app "Run this task" picker) to work with the folder directly.

---

## 7. Definition of done

- Assignments board shows live duty status + time-in-status + current truck + current trailer for active
  drivers, sourced from telematics, degrading cleanly; "End shift" hidden/gated.
- Drivers page shows current **city** location (with truck-unit fallback), synced by the existing HOS job.
- Migration `0112` (+ schemaCheck probe) for `drivers.current_location`.
- All new pure logic unit-tested; full shared + api suites green (minus the known sandbox-only failures); tsc,
  eslint, file/function-size, and boundary gates all pass.
- Nothing assumed — every source verified against the code or the diagnostics probe first.
