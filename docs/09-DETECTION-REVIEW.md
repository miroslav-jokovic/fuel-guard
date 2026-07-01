# FuelGuard — Detection Logic Review & Pre-Deploy Polish Plan

> Pre-Phase-9 hardening pass. Goal: the most precise, reliable theft detection we can build on the
> data we actually have, with **deterministic math in our system** and **AI only for audit/verification**.
> Based on an independent code audit + industry research (2026).

---

## 1. Headline findings

Our deterministic core is clean and explainable, but two of the customer's headline requirements are
**not yet truly met**, and there are **correctness blockers** that would cause both false positives
and silent misses in production.

1. **Odometer checks verify *self-consistency*, not *correctness*.** Today we catch regression
   (went backwards), stale (unchanged), missing, and implausible jumps. None of these confirms the
   driver entered the *right* number. There is **no ±5-mile check anywhere yet.**
2. **Detection is per-fill, per-vehicle only.** No cumulative ("split fills"), no card-level
   correlation, no slow-siphon reconciliation — so the most common real theft patterns slip through.
3. **EFS date-only timestamps poison every time-based rule** (off-hours, rapid-repeat, implausible
   jump) — because we anchor imports at noon UTC. These rules silently mis-fire on imported data.
4. **No per-vehicle scoring lock** → concurrent fill-ups/imports can double-insert anomalies and
   compute baselines from mid-flight state.

---

## 2. The ±5-mile odometer check — what's actually possible

Industry systems validate the driver-entered odometer against an **independent measurement** —
typically the **GPS/telematics odometer**, with a tolerance around **2%** (not a flat ±5). FuelGuard
has **no GPS** (out of scope), so we need a different independent reference.

A literal **±5-mile** tolerance is only honest when comparing **two recordings of the *same* fueling
event** — because two humans/systems writing the *same* odometer should match almost exactly. The
candidate references, and whether ±5 is realistic:

| Reference for "expected odometer" | ±5 realistic? | Notes |
|-----------------------------------|---------------|-------|
| **Cross-source: manual app entry vs EFS pump entry** (same event) | ✅ **Yes** | The only true ±5 check. Driver can't fudge one number — the other source catches it. **Not implemented.** |
| Previous reading + gallons × baseline MPG | ❌ No | Fuel-economy noise alone is ±10–20% → tens of miles. Good for a *wide* plausibility band, not ±5. |
| Previous reading + elapsed time × speed | ❌ No | Too coarse; only catches gross teleportation. |
| GPS odometer (2% tolerance) | n/a | We have no GPS. |

**Conclusion:** the precise ±5 driver-accuracy check requires **cross-source reconciliation** —
linking a manual fill-up to its EFS import line for the same vehicle/time and flagging when the two
odometers differ by more than 5 miles. This is genuinely strong anti-fraud: the EFS pump reading is
captured independently of the app. For drift/padding where only one source exists, we add a separate
**percentage-band** expected-odometer check (not ±5). **This requires confirming your workflow — see
the question at the end.**

---

## 3. Theft patterns that currently slip through (and the fix)

| Pattern | Why it's missed today | Planned detector |
|---------|----------------------|------------------|
| **Fuel into a container** (under tank capacity) | capacity rule only fires on a single over-tank fill; top-off rule uses the static seeded MPG and dies on missing/regressed odometer | `cumulative_volume_vs_capacity` (rolling window per vehicle **and per card**) + use rolling baseline in top-off |
| **Split fills** (2×40 gal vs 1×80) | per-fill thresholds; rapid-repeat is per-vehicle and broken on EFS timestamps | cumulative-volume rule over 24–48h |
| **Card sharing / one card, two trucks** | card identity is discarded before scoring | `card_multi_vehicle`, `card_geo_impossible` (city/state distance vs elapsed days) |
| **Slow siphoning** (few gal/fill) | stays under 15% MPG drop; sustained-decline rule needs 7 clean fills | monthly **gallons-purchased vs miles/baseline** reconciliation report |
| **Odometer padding/drift** (conceals theft) | padding *raises* MPG and *inflates* expected consumption → rewarded by current logic | `expected_odometer_band` (% band) + cross-source ±5 |
| **Leaving odometer blank to dodge scrutiny** | downgrades a critical signal to a medium nudge; disables MPG/top-off | treat missing odometer on a fuel vehicle as higher severity; don't strip volume checks |
| **Unattributed EFS fills** (likely theft) | synthetic "other" vehicle gates out capacity/MPG | resolve unit→tank size where possible; never strip volume checks for unattributed |

---

## 4. Reliability / correctness fixes (independent of new features)

**P0 — block launch**
1. **Source-aware time rules.** Add `fueledAtPrecision: 'instant' | 'date'` to the engine context.
   For EFS (date-only) rows, **suppress** off-hours, rapid-repeat, and the time divisor in
   implausible-jump (or use a per-day mileage cap instead). Stops the noon-UTC false pos/neg.
2. **Per-vehicle advisory lock** around scoring + a unique index
   `anomalies(transaction_id, rule_id) where status <> 'superseded'` so the reconcile read-then-insert
   can't double-insert under concurrency.
3. **Exclude odometer-anomalous fills from the baseline / recent series** (the spec already requires
   this; the code doesn't do it) — stops baseline poisoning.
4. **Merge multi-line same-invoice EFS fills** before scoring (sum gallons/cost, one odometer) — stops
   false MPG/top-off/rapid-repeat/stale on DEF+diesel or two-pump invoices.
5. **Deterministic ordering**: secondary sort by `created_at, id` everywhere we order by `fueled_at`.

**P1 — strongly recommended**
6. Widen the **re-score cascade** to all following fills within the baseline window (≥5), not just one.
7. **Quarantine bad/missing dates and colliding `external_ref`** to review instead of stamping
   import-time / dropping legitimate rows.
8. Use `effectiveBaseline` (not the static seed) in `implausible_topoff`.
9. **Separate reefer (`ULSR`) fuel** from propulsion MPG so it doesn't depress economy / launder fuel.

**P2 — tuning**
10. Retune `mpg_sustained_decline` (slope + noise floor; ignore partial fills below a gallons floor).
11. Validate `operating_hours` JSON; derive EFS price from total/gallons for consistency.
12. Optimistic concurrency via the existing `version` column on edits/re-score.

---

## 5. Division of labor — deterministic vs AI (confirmed)

This matches your intent and we'll keep it strict:

- **Our system computes everything quantitative**, deterministically and explainably: miles, MPG,
  rolling baselines, capacity math, cumulative volumes, cross-source odometer deltas, card/geo
  distances, all thresholds and the ±5 reconciliation. Every flag states the exact numbers.
- **Claude audits and verifies** — it never computes the hard numbers. It reviews the assembled
  evidence (including the deterministic deltas), judges overall plausibility, explains *why* in plain
  language, prioritizes the queue, and flags patterns a single rule wouldn't (e.g., "this driver +
  this station, repeatedly"). Output is advisory, Zod-validated, and for human review.

---

## 6. Research sources

- [FleetRabbit — EFS variance detection & cross-checks](https://fleetrabbit.com/blogs/post/efs-fuel-card-integration-fleet-platform)
- [Geotab — fleet fuel management & telematics cross-checks](https://www.geotab.com/blog/fleet-fuel-telematics/)
- [oxmaint — fuel card reconciliation checklist (odometer within tolerance, match every txn to mileage)](https://oxmaint.com/industries/fleet-management/fleet-fuel-card-reconciliation-management-checklist)
- [SimplyFleet — fuel card fraud controls](https://www.simplyfleet.app/blog/fuel-card-policy-fraud-controls)
- [HVI — fuel theft prevention](https://heavyvehicleinspection.com/fleet-management/fuel-efficiency/fuel-theft-prevention)
