# 21 — Behavioral Rule Hardening (WP-BEH)

Tier-4 batch upgrade, building on WP-CAP (measured capacity, docs/19) and WP-ATTR (logbook
attribution, docs/20). Theme: replace strings and blankets with measurements the fleet already
produces. 29 rules after this WP (3 new).

## 1. Precision tank-short detection (the WP5 floor, closed where sensors allow)

- **`tank_fill_short`** ran a blanket tolerance of max(15 gal, 30% of billed) — a ~29-gal skim on a
  100-gal bill was invisible by design. The tolerance is now **per-truck**: 3σ of the truck's own
  observed÷billed ratio history (`learnTankSensorReliability.ratioSigma`, persisted as
  `vehicles.tank_residual_sigma`, migration 0121), clamped to 8–30%. Clean single-tank sensors drop to
  a ~9-gal floor on a 100-gal bill; noisy sensors keep 30%; unlearned trucks are unchanged.
- **`tank_chronic_short` (NEW, weight 65, volume axis)** — the sustained-small-skim detector. Sensor
  noise is symmetric, so the signed residual (billed − observed) summed across the trailing ≥6 measured
  fills should hover near zero; a persistent one-direction shortfall — every fill individually inside
  the per-fill band — is fuel repeatedly not entering the tank. Threshold max(25 gal, 1.5σ × window
  billed); gated on the learned-reliable sensor; suspect-attribution fills excluded from the window.

## 2. Distance replaces strings and states

- **`location_mismatch`** was a state-level comparison — blind to a card used 200 mi away inside Texas.
  Now distance-tiered: truck >25 mi from the station at a reliable instant fires (>100 mi = high
  severity). The systematic-offset (wrong station pin) suppression now also runs for the distance tier,
  so bad geocodes stay data-quality, not theft.
- **`rapid_repeat_fueling`** same-site check uses real pin distance (≤1 mi = one site) when both fills
  carry coordinates — string matching had wrongly exempted two different truck stops in one city AND
  wrongly split one station's name variants. Strings remain the fallback.
- **`impossible_travel` (NEW, weight 70, location axis)** — two fills ≥60 mi apart whose implied speed
  exceeds `maxPlausibleMph` (both instants reliable, gap ≤24h): one truck cannot have made both fills —
  near-proof of card sharing/cloning. Review-alone; alerts with one corroborating axis; supersedes
  `rapid_repeat_fueling` for the same pair.

## 3. Logbook: self-heal blanks + driver-not-working

- **Unattributed self-heal** (`healMissingAttribution`): a fill missing its VEHICLE (driver known) is
  filled from the driver's unique logbook truck covering the instant (then re-scored once); a fill
  missing its DRIVER (vehicle known) is filled from the unique driver logged into that truck. Ambiguity
  (team drivers/slip-seat) → no action. Audit-logged (`transaction.attribute_from_logbook`). Every
  rescued fill becomes visible to all other rules — the suppressed `unattributed_transaction` facts
  shrink instead of accumulating.
- **`fuel_while_driver_home`** generalizes to "driver demonstrably not working", fed by TMS home-time
  (as before) OR the ELD logbook: fill deep inside an off-duty/sleeper block ≥4h, ≥1h from both edges
  (`isDriverOffDutyAtFill`) — shift-start/-end fueling never flags. Still corroboration-only.

## 4. Cost integrity

- **`cost_line_mismatch` (NEW, weight 0, suppressed)** — `total_cost` vs `gallons × price/gal` beyond
  max($5, 2%): an import defect or a tampered receipt; surfaced on the transaction, never an alert.
- Market memoization already existed (per state+day). **Deferred**: station-EXACT posted-price
  comparison — needs station-identity resolution (its own WP; same pin problem as location).

## Deliberate limits

- Chronic-short and precision tolerance only help trucks with a learned-reliable sensor — same honest
  boundary as every tank rule; Coverage shows who's blind.
- `impossible_travel` weight 70 (not alert-alone): station pins can be geocoded centroids; the 60-mi
  floor plus corroboration requirement keeps precision first. Revisit against WP9 dispositions.
- Logbook self-heal fills BLANKS only; it never overwrites an existing attribution (that's the
  verify/re-attribute flow, docs/20).

## Post-implementation audit (same session)

Adversarial pass over the WP-BEH changes; verified interactions and two findings fixed:

- **Verified — `shortGal` is raw.** `reconcileTankFill` persists the un-gated shortfall (billed −
  observed, clamped at 0); the old 30% tolerance lives only in the rule. The precision-scaled
  tolerance therefore really does see smaller skims — no hidden pre-gate upstream.
- **Verified — distance-tier fires on the right population.** `matched=true` includes weak `in_state`
  matches, and `gps_confirmed` implies small distance by construction — so the >25 mi tier catches
  exactly the "in the right state but nowhere near the station" gap without contradicting a proximity-
  confirmed match. Suspect-attribution fills are already excluded from previous-fill selection, so
  `impossible_travel` can't pair against a misattributed fill.
- **FIXED — `cost_line_mismatch` was invisible.** It shipped as suppressed weight-0; suppressed rules
  are filtered out before persistence and (unlike `odometer_missing`) this fact has no other column —
  it would have surfaced nowhere. Now weight 10, unsuppressed: never a case alone (10 ≪ 60) but
  persisted in the `case_signals` why-surface.
- **FIXED — re-attribution ignored distance evidence.** `shouldReattribute` accepted only the
  state-level GPS contradiction; a logbook-suspect fill whose attributed truck was measured 40 mi from
  the station (same state) stayed suspect instead of self-healing. GPS contradiction now =
  state mismatch OR truck-vs-station > 25 mi (`REATTRIBUTE_DISTANCE_MILES`).

## Rollout

Deploy migration `0121`; run a rules rebuild (learns σ per truck, then re-scores). New rules appear in
the catalog automatically (`pnpm gen:rules` already committed). Watch dispositions on
`tank_chronic_short` and `impossible_travel` for the first weeks before considering weight changes.
