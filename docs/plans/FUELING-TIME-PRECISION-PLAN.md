# Fueling-Time Precision + Odometer/Location Audit — Build Plan
**Date:** 2026-07-06 · Analysis + plan only, no code changed. Follows the drawer-audit report.
**How we work this:** one chunk per response; each self-contained, verified (typecheck + tests + lint), left **uncommitted**. No new infra.

---

## The problem, precisely
The fueling **time** on an EFS report is a settlement/authorization timestamp — it can differ from when fuel actually entered the truck by minutes to hours, and late-night fills can post on the next day. Our reconciliation currently disambiguates *which* Samsara stop was the fueling stop by picking the stop **nearest the reported time**. That's circular: if the report time is wrong, the anchor is wrong — which then makes the recovered **odometer**, **location**, and **"actual" time** all point at the wrong stop on multi-stop days. Tolerances (±10 mi odometer, whole-day state check) hide most of this, but it's the last real precision gap.

## The fix (research-backed)
Anchor the fueling event on the **tank-level rise** — the moment Samsara's fuel % steps up by ~the billed gallons. This is *physically* the fueling event and is independent of the EFS clock. Samsara documents this exact before/after technique for fraud detection, and the `stats/history` `fuelPercents` series is raw (not median-smoothed), so the step is detectable. One anchor fix cascades to all three signals: correct **time**, correct **odometer** (interpolated at that instant — flat because parked), correct **observed location** (the stop's address).

**Confidence ladder (graceful degradation):**
| Basis | How | Confidence |
|---|---|---|
| `tank_confirmed` | A fuel-% rise ≈ billed gallons at a stop in the EFS state/city | highest — time is physical |
| `stop_estimated` | No usable tank rise → current logic: nearest in-state stop to the reported time | medium |
| `reported` | No telematics coverage → the EFS time as-is | low (flagged) |
| `date_only` | EFS had no time at all → tank rise if available, else noon sentinel | low unless tank_confirmed |

~185/188 trucks report a fuel level, so `tank_confirmed` should cover the large majority; the ladder keeps the rest working exactly as today.

---

## Chunk A — Tank-rise fueling-event solver (shared, pure + tested)  ☑ (2026-07-06, uncommitted)
The core algorithm, isolated and unit-tested before it touches recon.
- **`findFuelingEvent(samples, fuelReadings, efs, opts)`** in `packages/shared` returns
  `{ at, odometerMiles, observed: {state, city, address}, basis, riseGalObserved, expectedGal, pctBefore, pctAfter }`.
- **Rise detection:** scan `fuelReadings` for a sustained low→high step (before-low stable, after-high stable, Δ ≥ min%); expected rise = `gallons / tankCapacityGal * 100` when tank known. Rank candidate rises by magnitude-match to expected, then by a nearby stop, then by EFS-state/city match, then — only as a weak tiebreaker — proximity to the reported time.
- **Anchor instant** = the last "before" reading (arrival), corroborated by a `speed ≤ stoppedMph` sample; odometer via `odometerAtTime` at that instant; observed location from that stop's address.
- **Fallbacks** produce `stop_estimated` / `reported` / `date_only` per the ladder, so callers always get an answer.
- **Edge cases covered by tests:** two fills same day (magnitude picks the right one), sensor noise (min-Δ + sustained), missing tank capacity (use largest clear rise), no fuel sensor (fall back), DEF/partial fills, date-only.
- **Verify:** shared vitest (heavy on this function); typecheck; lint.

## Chunk B — Wire the solver into reconciliation + persist  ☑ (2026-07-06, uncommitted)
- **`samsaraRecon`** calls `findFuelingEvent` first; uses its `at` as `matchedAt`, its odometer as `crossSourceOdometer`, its observed location as evidence, and its `basis` for time confidence. Keeps the existing location-confidence + veto logic on top.
- **Migration `0028`** (+ reconcile_schema): add to `fuel_transactions` — `samsara_observed_city`, `samsara_observed_state`, `samsara_observed_address`, `samsara_fuel_pct_after`, `fueling_time_basis` (text). These make the audit tab exact for *every* fill, not just mismatches.
- **`scoring.ts`** persists them; `eventAt` / `timeConfirmed` derive from `fueling_time_basis` (`tank_confirmed` ⇒ confirmed; `reported`/`date_only`-without-rise ⇒ not confirmed → time-of-day rules stay suppressed, as today). `fueled_at` (business time) is still never overwritten (migration 0026).
- **Verify:** shared/api tests; api typecheck; lint. Manual note for the user: run Re-sync to backfill the new columns.

## Chunk C — "Odometer & Location audit" tab in the anomaly drawer  ☑ (2026-07-06, uncommitted)
- **`useTransaction`** selects the `samsara_*` columns it currently omits (`samsara_odometer`, `samsara_recon_at`, `samsara_location_confidence`, `station_lat/lng`, plus the new observed-location + basis + pct fields).
- **New drawer tab** showing three panels:
  1. **Odometer** — driver-entered vs telematics, the **signed raw diff for every fill** (even under the ±10 alert threshold), applied per-vehicle offset, and tolerance.
  2. **Time** — reported (EFS) time vs actual fueling time (telematics), the delta, and a **basis badge** (`tank_confirmed` / `stop_estimated` / …). Date-only rows labeled, not shown as "12:00 PM".
  3. **Location** — EFS station vs Samsara-observed place + confidence tier.
- **Times rendered in the org timezone** (not the browser's), with explicit labels.
- **Nulls handled** ("not reconciled — run Re-sync from Settings → Data & Sync").
- **Verify:** web typecheck; lint.

## Chunk D — Fleet-wide odometer-accuracy audit (optional)  ☐
- A filterable list (page or report) of all fills with entered-vs-telematics odometer diff, time basis, and location confidence — the "are drivers entering correct odometers?" tool, beyond single-case review. Builds on the same columns; no new detection.
- **Verify:** web typecheck; lint.

---

## Suggested order
A → B are one coherent change set (the precision fix). C is the visible payoff. D optional. Recommend A+B first (correctness), then C.

## What this does NOT change
- `fueled_at` stays the business timestamp (day bucketing / dedup — migration 0026).
- Detection thresholds and the multi-signal model are untouched; this only makes the *inputs* (time/odometer/location) more precise and *surfaces* them.
- No new infrastructure; all in-process.

## Decisions (locked 2026-07-06)
1. Observed location stored as **text + coordinates** (`samsara_observed_city/state/address` + `samsara_observed_lat/lng`) — readable now, map-pin ready later.
2. Minimum tank-rise Δ to trust a `tank_confirmed` anchor = **6%** (tunable per org later).
3. Scope = **A + B + C**. Chunk **D** (fleet-wide audit) deferred — decide after A–C ship.

## Research references
- Samsara — *Fuel Card Integration* (documents fuel level before/after a transaction for fraud detection).
- Samsara — *Historical stats* `GET /fleet/vehicles/stats/history` (`fuelPercents`; history readings are not median-smoothed).
- Samsara — *Fuel Level Tracking* (KB).
- EFS/WEX — Merchant Policies & transaction/settlement reporting (report time is settlement/authorization-oriented; exact field semantics not publicly documented → do not treat as ground truth).
