# Fueling-Time Reconciliation — Modularization Plan (enterprise-grade, zero-assumption)

**Purpose:** split the five fueling-time signals — now entangled in one 200-line function — into five independent, pure, individually-tested modules so a change to one physically cannot alter another. Grounded line-by-line in the current `apps/api/src/services/samsaraRecon.ts` (read in full; no assumptions).

## 1. Current structure (exact, with line refs)

`reconcileWithSamsara(admin, env, orgId, input, fetcherOverride?, geocodeOverride?, extra?)` → `ReconResult | null` does everything inline:

| Step | Lines | What it does | Produces |
|---|---|---|---|
| A. Guard + window + fetch/slice | 140-177 | samsaraVehicleId guard; compute ±18/30h window; fetch or reuse prefetched raw; slice to window | `samples`, `vehicleRaw` |
| B. Geocode + proximity | 182-198 | geocode station (cache-only optional); site proximity; any-precision `nearMiles`; build `mismatchVeto` | `stationCoords`, `proximityMiles`, `nearMiles` |
| C. Fill-moment anchor | 200-217 | `findFuelingEvent` (tank-rise) → `fuelEvent`; `observedFor` + `basisFor` helpers | `fuelEvent`, `at` (later) |
| D. Precise branch | 222-267 | `matchFuelingStop` + `resolveLocationConfidence`; anchor `at`; odometer trust gate + `odometerAtTimeSourced`; `computeTankFill`; assemble result | `ReconResult` |
| E. Date-only branch | 269-304 | `matchFuelingMoment`; `nearStation`; anchor `at`; odometer; `computeTankFill`; assemble (never mismatch) | `ReconResult` |
| F. computeTankFill | 320-341 | before %/after-peak %/short gal via `reconcileTankFill` | tank fields |

**The coupling (why fixes ripple):** the anchor `at` (227 precise / 280 date-only) is a single shared value feeding odometer (233), tank (238), and time (259). Location (224) gates odometer trust (232). D and E are near-duplicate assembly blocks. Windowing (A) and geocode (B) are shared inputs to everything. There are no seams — every concern reads the same locals.

## 2. Target architecture — a typed pipeline of pure stages

One thin orchestrator, five pure modules, each in its own file with its own test. Data flows one way; no shared mutable state.

```
                         ┌─────────────────────────────────────────────┐
raw stats ─> [S0 samples] ─> { samples, fuelReadings }                  │
                         └──────────────┬──────────────────────────────┘
                                        ▼
efs + samples + fuelReadings ─> [S1 fuelingMoment] ─> { at, basis, tankRiseEvent | null }
                                        │  (the ONE shared anchor — explicit output)
        ┌───────────────────────────────┼───────────────────────────────┐
        ▼                               ▼                                ▼
samples+geocode+efs        samples + at + locationConfidence      fuelReadings + at + gallons + cap
   [S2 location]                 [S3 odometer]                        [S4 tankFuel]
 {matched,confidence,          {miles, at, source}                {pctBefore,pctAfter,
  evidence,observed*}                                              observedRiseGal,shortGal}
```

**Module contracts (pure functions in `packages/shared`, except S0 I/O):**

- **S0 `acquireSamples`** (`apps/api/src/services/recon/samples.ts`) — the ONLY I/O: fetch/prefetch/slice/parse. Input: fetcher + window + raw. Output `{ samples: SamsaraSample[]; fuelReadings: TankReading[] }`. Owns `SamsaraUnavailableError`, prefetch, `sliceVehicleToWindow`.
- **S1 `resolveFuelingMoment`** (`packages/shared/src/recon/fuelingMoment.ts`) — Input `{ samples, fuelReadings, efs: {state,city,gallons,tankCapacityGal,reportedAtIso,preciseTime}, stop? }`. Output `{ at: string | null; basis: FuelingTimeBasis; tankRiseEvent: FuelingEvent | null }`. This is the single anchor authority.
- **S2 `resolveLocation`** (`packages/shared/src/recon/location.ts`) — Input `{ samples, geocode: {stationCoords, proximityMiles, nearMiles}, efs, preciseTime }`. Output `{ matched, confidence, evidence, observed* }`. Wraps `matchFuelingStop`/`matchFuelingMoment` + `resolveLocationConfidence` + veto. **Precise vs date-only lives HERE only.**
- **S3 `resolveOdometer`** (`packages/shared/src/recon/odometer.ts`) — Input `{ samples, at, trust: {tankRise:boolean; inCityStop:boolean; gpsConfirmed:boolean} }`. Output `{ miles, at, source } | null`. Owns the trust gate + `odometerAtTimeSourced`.
- **S4 `resolveTankFuel`** (`packages/shared/src/recon/tankFuel.ts`) — Input `{ fuelReadings, at, gallons, tankCapacityGal, tankRiseEvent }`. Output `{ pctBefore, pctAfter, observedRiseGal, shortGal }`. Owns `computeTankFill` + the post-fill plateau window + `tankPctAfter` = `tankRiseEvent.pctAfter ?? plateau`.

**Orchestrator** `reconcileWithSamsara` becomes ~30 lines: S0 → geocode → S1 → S2 → S3 → S4 → assemble `ReconResult`. No signal logic remains in it.

## 3. Design decisions that need YOUR call (not assumed)

1. **Keep the shared anchor?** The odometer, tank, and time are read at ONE physical instant (the tank-rise, else the matched stop). Recommendation: **keep it shared** as S1's single explicit output — reading them at different moments would be wrong — but make it the only place the anchor is decided. (Confirm.)
2. **Should odometer trust depend on location?** Today the odometer is trusted when `gps_confirmed` (a location result) OR tank-rise OR in-city stop (line 232). That's a real cross-signal dependency. Options: (a) keep it, passed as an explicit `trust` input to S3 (modular but still dependent); (b) decouple — S3 trusts ONLY a tank-rise/OBD anchor, never location. (a) preserves current behavior; (b) is cleaner separation but changes what gets an odometer. **Your call.**
3. **Fuel-level vs tank-fill:** merge into one S4 module (they share `pctBefore/After`)? Recommendation: **yes** — one "tank & fuel level" module. (Confirm, since you listed them as two of the five.)

## 4. Behavior-preservation guarantee (how we avoid a new regression)

Before moving any code: build a **golden-fixture harness** — capture the current `ReconResult` for a set of representative fills (≥20: precise/date-only, tank-confirmed, in_state, mismatch, gps_confirmed, no-coverage, OBD/GPS odometer, dual-tank, missing-fuel-data). Refactor module by module; after each extraction the harness must produce **byte-identical** `ReconResult` (unless the change is a decision from §3, which gets its own updated golden). This turns "did I break another signal?" into a failing test, not a production surprise.

## 5. Incremental extraction order (each step: tests green, one commit)

1. Land the golden-fixture harness against today's function (locks current behavior).
2. Extract **S4 tankFuel** (most self-contained; your active concern) — prove identical.
3. Extract **S3 odometer** (trust gate as explicit input).
4. Extract **S2 location** (folds the precise/date-only duplication into one module).
5. Extract **S1 fuelingMoment** (the anchor authority).
6. Extract **S0 acquireSamples**; orchestrator shrinks to wiring.
7. Delete the old inline blocks; each module now owns its tests.

No behavior changes in steps 1-7 except the explicitly-approved §3 decisions. After this, every future fix touches exactly one module with its own test suite.
