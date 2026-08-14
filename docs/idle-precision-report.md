# Idle precision report

Run: 2026-08-14T00:36:22.543Z
Window: 2026-07-15 through 2026-08-14 (page default; 30 observed calendar days)
Cost basis: 0.8 gal/hour × $5.109/gal

## Executive result

The live page computation reconciles to **82 confident trucks**, **32 rows with displayed avoidable hours**, **1681.1 avoidable hours**, and **$6,870** on the rounded fleet card. The other confident trucks are either alternative=none (continuous-only or admin-confirmed no equipment, so idle is unavoidable) or equipped trucks whose managed/rest or grace/uncertain buckets leave zero displayed avoidable hours.

## Invariant results

- **PASS** — 1a rollup engine seconds tie to vehicle_engine_days
- **PASS** — 1b rollup managed/continuous seconds tie to park sessions
- **PASS** — 1c rollup HOS buckets tie to recomputed session evidence
- **PASS** — 1d rollup HOS buckets tie to stored session evidence
- **PASS** — 2a per-session HOS bucket algebra
- **PASS** — 2b per-rollup nonnegative and classified-idle algebra
- **PASS** — 5 freshness (<26h)
- **PASS** — 6 identity hygiene (no active truck unlinked from Samsara beyond 14d grace)
- **PASS** — 7 rollup history depth (>= source window)
- **PASS** — 3 verdict algebra (Silvicom Inc)
- **PASS** — 4 card/table consistency (Silvicom Inc)

## Funnel

| Stage | Trucks |
| --- | ---: |
| Total with rollup data | 176 |
| Covered (coverage ≥ 50%) | 165 |
| Judgeable (known alternative/envelope) | 95 |
| Confident (duty-evidenced share ≥ 80%) | 82 |

Equipment census note: **88 trucks await admin equipment confirmation**. Learned APU/optimized patterns do not grant avoidability; they remain display evidence only.

## Three worked examples

### Unit 781 — equipped-and-wasting

Raw rollup sums: drive **537948s**, idle **1172469s**, off **119883s**, coverage **1830300s**; managed sessions **8169s**, continuous sessions **937774s**.
HOS buckets: rest **1062458s**, work **18895s**, unknown **7404s**, ambiguous **0s**, grace **13516s**.
Capability: has_apu=null, has_optimized_idle=true, learned=continuous_only; resolved alternative **optimized_idle**.
Verdict: managed **8169s**, continuous **937774s**, avoidable **698641s**, unavoidable **0s**, justified **218213s**, uncertain **7404s**, grace **13516s**; confident **true**.
Displayed: avoidable **194.1h**, unavoidable **0.0h**, uncertain **2.1h**, managed **2.3h**; dollars **$793.19**.

### Unit 674 — continuous-only-unavoidable

Raw rollup sums: drive **896724s**, idle **1343331s**, off **289926s**, coverage **2529981s**; managed sessions **16875s**, continuous sessions **1056703s**.
HOS buckets: rest **1327529s**, work **30888s**, unknown **227s**, ambiguous **0s**, grace **20556s**.
Capability: has_apu=null, has_optimized_idle=null, learned=continuous_only; resolved alternative **none**.
Verdict: managed **16875s**, continuous **1056703s**, avoidable **0s**, unavoidable **1035920s**, justified **0s**, uncertain **227s**, grace **20556s**; confident **true**.
Displayed: avoidable **0.0h**, unavoidable **287.8h**, uncertain **0.1h**, managed **4.7h**; dollars **$0.00**.

### Unit 555 — below-80-percent-duty-bar

Raw rollup sums: drive **212524s**, idle **285467s**, off **553416s**, coverage **1051407s**; managed sessions **9059s**, continuous sessions **236021s**.
HOS buckets: rest **216753s**, work **0s**, unknown **3440s**, ambiguous **47741s**, grace **0s**.
Capability: has_apu=false, has_optimized_idle=false, learned=apu; resolved alternative **none**.
Verdict: managed **9059s**, continuous **236021s**, avoidable **0s**, unavoidable **184840s**, justified **0s**, uncertain **51181s**, grace **0s**; confident **false**.
Displayed: avoidable **0.0h**, unavoidable **51.3h**, uncertain **14.2h**, managed **2.5h**; dollars **$0.00**.

## Provenance

- Raw facts: `vehicle_engine_days`, `idle_park_sessions`, `hos_duty_segments`, and `idle_events`.
- Derived page input: `idle_rollup_days`.
- Verdict math: `packages/shared/src/idleAvoidable.ts` imported directly by the verifier.
- Page aggregation: `sumRollupByVehicle` and the same default-range/cost rounding as `useIdleBreakdown`.
