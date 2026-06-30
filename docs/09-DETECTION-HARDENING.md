# FleetGuard — Detection Hardening Analysis (pre-deploy)

> Goal: the most **precise and reliable** theft detection possible, deterministic in-system, with AI
> reserved for auditing/verification. Plus an explicit **±5-mile odometer-accuracy** check.
> Based on an adversarial review of the engine + 2026 industry research.

---

## 1. What the analysis found (the important parts)

**A. The MPG false positives are physics, not a seed artifact.**
Per-fill MPG = `miles_since_last / gallons` swings **±10–30%** because drivers top off partially — the
gallons at one fill pay for miles that belong to a different interval. Comparing two 3-point medians
with a 10% trigger (`mpg_sustained_decline`) therefore misfires by chance. Research confirms manual
fuel-card data is inherently noisy; the standard fix is **windowed cumulative MPG**
(`Σ miles / Σ gallons` over a trailing window), where intermediate tank levels telescope out and
random noise falls ~1/√n while a real siphon bias stays constant. **This is the single biggest
precision win** and the only reliable way to catch *slow chronic siphoning*.

**B. Odometer accuracy is foundational.** Manual odometer entry carries a **15–30% error rate**
(200–500 mi/month drift). A single bad reading corrupts two intervals *and* poisons the rolling
baseline for the next 5 fills. Industry standard: driver-entered odometer should agree with an
independent capture within a tight tolerance (telematics uses ~2%; you've specified **±5 miles**).

**C. The spec's baseline-exclusion was never implemented.** `02-DATA-MODEL.md §10.7–10.8` says
"exclude odometer-anomalous fills from the baseline," but `scoring.ts` loads recent fills with no such
filter — so a transposed odometer flows straight into the baseline.

**D. Biggest *missed* theft: container-on-a-non-empty-tank.** `exceeds_tank_capacity` only fires when a
*single dispense* beats the whole tank. Filling the truck **plus** a 30-gal jug, where the total still
"fits if the tank were empty," sails through. The correct bound is **headroom** = the space that
actually opened up since the last fill, not the full tank size.

**E. Inconsistencies & gaps:** `implausible_topoff` judges against the static seeded MPG while
`mpg_deviation` uses the rolling baseline (two different numbers); when odometer is missing, **all**
volume/MPG checks silently skip — leaving the riskiest rows unchecked; there is **no** odometer-
accuracy rule today.

---

## 2. The ±5-mile odometer check — three precise options

| Approach | How it works | Precision | Needs |
|----------|--------------|-----------|-------|
| **Two-source reconciliation** *(recommended)* | Match the **app manual entry** to its **EFS import** for the same fueling (vehicle + same org-local day + gallons within ε), then flag if the two driver-entered odometers differ by **> 5 mi**. | Highest — directly measures whether the driver entered the correct reading, using an independent second capture. | A link column `matched_txn_id`; a reconciliation pass; one new rule. |
| **Continuity / expected-odometer** | Project an expected odometer from the vehicle's typical daily mileage; flag readings implausibly far (either direction) — generalizes the speed check. | Good for **single-source** fills (no second capture). | Per-vehicle mileage profile; tolerance band. |
| **Transposition / typo classifier** | When an odometer rule fires, test small edits (digit swaps, ±10/100) to see if a correction restores continuity → annotate `likely_typo` + `corrected_value`. | Sharpens **triage** (honest fat-finger vs manipulation); never auto-corrects. | Pure function over one value + band. |

**Recommendation:** two-source reconciliation as the primary ±5-mile rule, continuity for single-source
fills, and the typo classifier as a triage annotation the AI auditor consumes.

> **Key dependency:** the two-source check only works if drivers record the odometer in **both** the
> app and at the EFS pump. If they only use one, we use the continuity + typo approach instead. (This
> is the decision below.)

---

## 3. Prioritized hardening plan (deterministic; AI audits only)

- **P0 — Trustworthy MPG.** Switch the trend signal to **windowed cumulative MPG**; confidence-gate all
  MPG rules (≥5 valid intervals AND ≥~750 cumulative miles, else skip); require the decline to beat both
  a % floor and the noise band; **exclude odometer-anomalous fills from the baseline**; unify the
  baseline source across `mpg_deviation` and `implausible_topoff`. → kills the false fires *and* enables
  slow-siphon detection.
- **P1 — ±5-mile odometer accuracy.** Reconciliation pass + `odometer_mismatch` rule (sibling
  `gallons_mismatch`), pending the data-flow decision.
- **P2 — Tank-headroom volume rule.** Track a running tank-level estimate; fire when
  `gallons > (capacity − estimated_remaining) × (1+tol)`. Catches the container-on-non-empty-tank case.
  Keep hard-capacity as a critical fallback.
- **P3 — Continuity + typo annotation** (covers single-source fills; sharpens triage).
- **P4 — Stop skipping risky rows.** On missing/regressed odometer, apply a capacity/headroom-only bound
  and **escalate `odometer_missing` to high when gallons are large**.
- **P5 — Robustness.** Multi-tank/reefer modeling (or `max_single_dispense`); optional "filled to full?"
  capture so MPG uses full-to-full intervals.

**Division of labor:** every item above is deterministic math in our system. Claude AI consumes these
signals + evidence for secondary judgment (typo vs manipulation, pattern-level review) — it never
recomputes the arithmetic. This matches the product principle "explainable over clever."

---

## Sources
- [HVI — Fuel theft detection & prevention](https://heavyvehicleinspection.com/blog/post/fuel-theft-in-fleets-how-to-detect-prevent-and-save)
- [P-Fleet — Fuel-card odometer tracking](https://www.pfleet.com/blog/fleet-fuel-card-odometer-tracking-reduce-operating-cost)
- [Intangles — Odometer reading & fleet MPG/IFTA accuracy](https://www.intangles.ai/blog/what-is-an-odometer-reading-why-it-matters-for-fleet-management/)
- [Oxmaint — Fuel-card reconciliation checklist](https://oxmaint.com/industries/fleet-management/fleet-fuel-card-reconciliation-management-checklist)
