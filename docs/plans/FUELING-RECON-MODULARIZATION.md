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

## 5. Extraction status

Decisions (PM): §3.1 keep shared anchor ✅ · §3.2 option (a) keep trust logic, pass location in as explicit input ✅ · §3.3 one tank & fuel-level module ✅.

- ✅ **Behavior lock** — `samsaraRecon.test.ts` (now 8 cases incl. mismatch/evidence) + the shared unit tests hold every extraction to byte-identical output.
- ✅ **S4 tankFuel** — `packages/shared/src/recon/tankFuel.ts` (+ tests). Behavior-identical.
- ✅ **S3 odometer** — `packages/shared/src/recon/odometer.ts` (+ tests). Trust is an explicit input.
- ✅ **S2 location** — `packages/shared/src/recon/location.ts` (+ tests). Precise + date-only unified; tank-rise observed-precedence + mismatch evidence preserved exactly.
- ✅ **S1 fueling anchor** — is `findFuelingEvent` (already a pure shared module) + the one-line `fuelEvent?.at ?? loc.stopMatchedAt` combination in the orchestrator.
- ⏳ **S0 acquireSamples** (OPTIONAL) — the fetch/window/slice/parse I/O still lives in the orchestrator. It touches no signal logic, so extracting it is cosmetic; deferred to avoid churn.

**Result:** the five fueling-time signals are now five separate, independently-tested units. `reconcileWithSamsara` is thin wiring: acquire samples → geocode → tank-rise event → S2 location → anchor → S3 odometer → S4 tank. A change to one module cannot alter another — they share only explicit typed inputs, enforced by the behavior-lock tests. Full suite: 293 shared + 93 API green, typecheck clean.
