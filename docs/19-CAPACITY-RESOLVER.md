# 19 — Capacity Resolver (WP-CAP)

## Problem

Every Tier-2 volume rule (`exceeds_tank_capacity`, `tank_space_exceeded`, `cumulative_overfuel`)
reconciled fills against `max(entered tank_capacity_gal, learned observed_max_fill_gal)`. Both sources
are weak: the entered nameplate is a human-typed field (the #1 root cause of false capacity criticals,
including the recurring "billed more than the tank holds" alerts on correctly-behaving trucks), and the
billed-gallons learner polices the very numbers it learns from — repeated same-size theft can train
itself invisible, and an OVER-entered capacity silently killed detection with no mechanism to ever
correct it downward.

## Design

**Measure capacity, don't trust claims.** Every reconciled fill with raw Samsara fuel-level
percentages gives `implied capacity = billed gallons ÷ (level-rise fraction)`. The robust median over
recent corroborated fills is the truck's sensor-MEASURED capacity.

### New learner — `learnSensorCapacity` (`packages/shared/src/anomalyRules/capacityResolve.ts`)

- Inputs: last 30 tractor fills with both `samsara_fuel_pct_before/_after` and billed gallons.
- Guards: rise ≥ 20 pts (small rises amplify sensor noise), fill ≥ 25 gal, per-fill implied capacity
  inside a 40–500 gal physical sanity band, ≥ 5 surviving samples, and a tight cluster (majority within
  ±15% of the median). A dual-INDEPENDENT-tank truck (sensor sees one tank) is bimodal → no verdict →
  legacy behavior. A theft fill implies an inflated capacity outside the cluster/band → discarded, so
  **billing alone can never train this value** (stolen gallons produce no rise).
- Persisted by `learnVehicleValues` to `vehicles.sensor_capacity_gal` / `sensor_capacity_samples`
  (migration 0118). NOT learned from `samsara_tank_observed_gal` — that column is derived FROM the
  entered capacity (circular).

### Resolver — `resolveCapacity`

Reconciles entered vs sensor-measured vs billed-history into one capacity + confidence:

| Situation | Capacity used | Confidence | Alert tolerance |
|---|---|---|---|
| Sensor agrees with entered (≤15% apart) | max(both) | high | org setting (default 5%) |
| Sensor contradicts entered (>15%) | **sensor** (physics wins), `divergent=true` | medium | ≥10% |
| Sensor only (entered unset — was silently dead) | sensor | medium | ≥10% |
| Entered / billed-history only | legacy `effectiveCapacityGal` | low | ≥15% |
| Nothing | 0 → rules off | none | — |

Divergent records are a DATA-QUALITY task, not a detection gap: alerts keep running on the sensor
value, and the truck is listed on the Coverage page + weekly digest ("entered 150, measured ~208 —
fix the entry").

### Rule changes

- `exceeds_tank_capacity` — fires above the confidence-tiered tolerance. Self-corroboration guard for
  UNVERIFIED records only: if THIS fill's own raw rise shows a physically plausible implied capacity
  (the fuel demonstrably went in), it's a record error → suppress and converge instead of alerting.
  A rise too small for the bill (implied capacity beyond any real tank) never suppresses — that IS the
  theft signature. Rise-shortfall is carried in evidence (`riseCorroborates`) for reviewers. Never
  applied to sensor-verified capacity (one fill can't outvote clustered physics history).
- `exceeds_capacity_unverified` (NEW, weight 60, volume axis) — review-grade companion covering the
  configured-tolerance…15% overage band on unverified records; disappears once the sensor verifies.
- `tank_space_exceeded` / `cumulative_overfuel` — free space and window ceiling now computed from the
  resolved capacity.

### Recovery semantics

A fill suppressed as record-suspect is not lost: once the sensor capacity converges (≈5 reconciled
fills), the nightly rules rebuild re-scores recent history against the verified capacity and re-flags
anything that was actually theft.

## Part 2 — the self-healing record (migration 0119)

Detection trusting the sensor left the Vehicles table itself wrong (and everything else that reads
`tank_capacity_gal` — fuel planning, range math — wrong with it). The learner now REWRITES the record
when the measurement is rock-solid:

- `decideCapacityAutoFix` (pure, `capacityResolve.ts`): requires ≥ `CAPACITY_AUTOFIX_MIN_SAMPLES` (8)
  clustered observations — stricter than the 5 needed for detection, because rewriting a record is a
  bigger action than widening a tolerance. Fires when the entered capacity is missing (fills the
  blank) or diverges > 15% from the measurement (corrects it, both directions). Inside the band it
  never touches the record — that's also the hysteresis against churn.
- Every correction sets `tank_capacity_source = 'auto'`, appends an `audit_logs` row
  (`vehicle.capacity_autofix`, meta = before/after/samples/reason), and shows up in the weekly digest
  ("✓ Tank capacity auto-corrected on truck 7132: 150→208 gal") — record changes are never silent.
- Human edits through the app (VehicleForm, CSV setup import) stamp `tank_capacity_source = 'manual'`.
  Provenance is transparency, not a veto: a manual value that contradicts solid physics by >15% is
  still corrected (policy: physics wins) — but the audit trail shows exactly what happened and when.
- After a fix, entered ≈ sensor → the resolver returns HIGH confidence → the tight 5% alert tolerance,
  and the divergence item clears from Coverage/digest automatically.

## Production incident + fix (2026-08): biased-low sensor capacity

First production run measured several 240-gal trucks at ~185 gal and the auto-fix wrote it through.
Root cause: the level sensor OVERSTATES the fill's rise — the stored post-fill percentage is the
plateau PEAK (slosh/slope spikes) and saddle-tank equalization lag peaks the sensed tank before fuel
settles — which understates implied capacity systematically enough to pass the cluster guard.
Three-part fix, all keyed to the same physical truth (a fill cannot bill more than the tank holds):

1. `learnSensorCapacity` — NO VERDICT when ≥2 window fills billed more than the would-be capacity
   (+5%). One contradicting fill could be theft and never blocks the verdict.
2. `resolveCapacity` — the corroborated observed-fill volume (`observedMaxFillGal`, 3+ fills) FLOORS
   the sensor value before any comparison. Physics wins in both directions.
3. `decideCapacityAutoFix` — same floor; a record can never be rewritten below what the truck
   demonstrably swallowed in single fills. (`learnVehicleValues` now learns observed fills BEFORE the
   sensor capacity so the floor is current at decision time.)

Remediation for affected fleets: restore original capacities from the `vehicle.capacity_autofix`
audit rows (downward rewrites only), null `sensor_capacity_gal`, deploy, rebuild.

## Deliberate limits

- Trucks with no Samsara fuel-level data stay on the legacy path at LOW confidence (15% alert
  tolerance + the review band). Sensor coverage is therefore a first-class data-quality metric.
- The EFS duplicate/split-transaction merge pre-check is DEFERRED (ingest-side, next iteration).
- Next recall upgrade (separate WP): J1939 total-fuel-used purchased-vs-burned reconciliation.
