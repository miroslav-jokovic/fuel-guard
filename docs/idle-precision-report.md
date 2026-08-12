# Idle precision report

Run: 2026-08-12T20:23:25.923Z
Window: 2026-07-13 through 2026-08-12 (page default; 31 observed calendar days)
Cost basis: 0.8 gal/hour × $5.012/gal

## Executive result

The live page computation reconciles to **65 confident trucks**, **13 rows with displayed avoidable hours**, **538.6 avoidable hours**, and **$2,160** on the rounded fleet card. The other confident trucks are either alternative=none (continuous-only or admin-confirmed no equipment, so idle is unavoidable) or equipped trucks whose managed/rest or grace/uncertain buckets leave zero displayed avoidable hours.

## Invariant results

- **PASS** — 1a rollup engine seconds tie to vehicle_engine_days
- **PASS** — 1b rollup managed/continuous seconds tie to park sessions
- **PASS** — 1c rollup HOS buckets tie to recomputed session evidence
- **PASS** — 1d rollup HOS buckets tie to stored session evidence
- **PASS** — 2a per-session HOS bucket algebra
- **PASS** — 2b per-rollup nonnegative and classified-idle algebra
- **PASS** — 5 freshness (<26h)
- **PASS** — 3 verdict algebra (Silvicom Inc)
- **PASS** — 4 card/table consistency (Silvicom Inc)

## Funnel

| Stage | Trucks |
| --- | ---: |
| Total with rollup data | 177 |
| Covered (coverage ≥ 50%) | 165 |
| Judgeable (known alternative/envelope) | 74 |
| Confident (duty-evidenced share ≥ 80%) | 65 |

Equipment census note: **91 trucks await admin equipment confirmation**. Learned APU/optimized patterns do not grant avoidability; they remain display evidence only.

## Three worked examples

### Unit 754 — equipped-and-wasting

Raw rollup sums: drive **609894s**, idle **707791s**, off **1248096s**, coverage **2565781s**; managed sessions **50715s**, continuous sessions **533158s**.
HOS buckets: rest **684779s**, work **6235s**, unknown **244s**, ambiguous **0s**, grace **6231s**.
Capability: has_apu=true, has_optimized_idle=true, learned=apu; resolved alternative **apu**.
Verdict: managed **50715s**, continuous **533158s**, avoidable **532014s**, unavoidable **0s**, justified **0s**, uncertain **244s**, grace **900s**; confident **true**.
Displayed: avoidable **147.8h**, unavoidable **0.0h**, uncertain **0.1h**, managed **14.1h**; dollars **$592.55**.

### Unit 649 — continuous-only-unavoidable

Raw rollup sums: drive **604864s**, idle **814920s**, off **358393s**, coverage **1778177s**; managed sessions **8875s**, continuous sessions **651145s**.
HOS buckets: rest **923767s**, work **14600s**, unknown **359s**, ambiguous **0s**, grace **12033s**.
Capability: has_apu=null, has_optimized_idle=null, learned=continuous_only; resolved alternative **none**.
Verdict: managed **8875s**, continuous **651145s**, avoidable **0s**, unavoidable **649886s**, justified **0s**, uncertain **359s**, grace **900s**; confident **true**.
Displayed: avoidable **0.0h**, unavoidable **180.5h**, uncertain **0.1h**, managed **2.5h**; dollars **$0.00**.

### Unit 697 — below-80-percent-duty-bar

Raw rollup sums: drive **560709s**, idle **702523s**, off **1305606s**, coverage **2568838s**; managed sessions **26559s**, continuous sessions **606418s**.
HOS buckets: rest **598676s**, work **7296s**, unknown **1135s**, ambiguous **123433s**, grace **5726s**.
Capability: has_apu=null, has_optimized_idle=null, learned=apu; resolved alternative **unknown**.
Verdict: managed **26559s**, continuous **606418s**, avoidable **0s**, unavoidable **480950s**, justified **0s**, uncertain **124568s**, grace **900s**; confident **false**.
Displayed: avoidable **0.0h**, unavoidable **133.6h**, uncertain **34.6h**, managed **7.4h**; dollars **$0.00**.

## Provenance

- Raw facts: `vehicle_engine_days`, `idle_park_sessions`, `hos_duty_segments`, and `idle_events`.
- Derived page input: `idle_rollup_days`.
- Verdict math: `packages/shared/src/idleAvoidable.ts` imported directly by the verifier.
- Page aggregation: `sumRollupByVehicle` and the same default-range/cost rounding as `useIdleBreakdown`.
