# WP4 — Odometer Rules Hardening: Decisions + Implementation Record

**Status:** implemented · **Date:** 2026-07-24 · **Predecessors:** WP1–WP3

## 1. Regression: tolerance + OBD arbitration

Before: `entered < previous` fired "high" with **zero tolerance** — a 1-mile-lower entry flagged — and
OBD was never consulted to decide *which* reading was wrong.

Now (`ruleOdometerRegression`):
- A drop within `odometerToleranceMiles` (org-tunable, default 10) is entry noise → silent.
- **OBD arbitration:** if THIS fill's entry agrees with its own OBD reading (offset-adjusted), the
  regression means the PREVIOUS entry was inflated — a prev-fill data issue, not evidence against this
  fill → silent. If this fill's entry contradicts OBD, `odometer_mismatch`/`entry_suspect` classify the
  defect and `runAllRules` drops the redundant regression signal (same axis, same root cause — never
  double-shown).
- Net: regression fires only when it's a real >tolerance drop with no OBD to explain it — exactly the
  case a human should look at.

## 2. Implausible jump / daily cap are now ENTERED-basis checks (team drivers fixed)

Both rules exist to catch implausible **entered** odometers. When the miles basis is the OBD span, the
distance was *really driven* — flagging a telematics-verified team running 1,200 mi/day was a pure
false positive. Both rules are now gated to the entered basis (`milesSinceLastSourced`); a bad entry on
an OBD-covered truck still surfaces via `odometer_mismatch`. Non-telematics team fleets remain on the
1,000 mi/day default — deliberately kept (weight 30, invisible alone) with the tuning path documented
in the catalog note (`maxDailyMiles` in settings).

## 3. Chronic stale/missing odometer escalates (the "leave it blank" dodge)

Per-fill missing/stale stay suppressed data-quality flags — correct. New `computeOdometerHygiene`
(shared, pure): per-driver aggregation over the digest window; a driver with **≥3 bad entries AND ≥50%
of their fills bad** (blank, or repeating the vehicle's previous reading) escalates into the weekly
digest with their name: "skipped/repeated N of M fills — blank/repeated odometers disable the MPG &
consumption checks." Stale is detected per-vehicle (consecutive identical entries) and attributed to
the repeating driver; reefer fills excluded (no odometer expected at a reefer pump).

## 4. Vanishing gallons fixed (skipped fills' fuel now counted)

`previousTxn` selection skips fills with a blank/flagged odometer — but their fuel WAS burned inside
the odometer span, and omitting it **inflated per-fill MPG**, masking deviations right after a
blank-odometer fill (a free evasion: skip the odometer once, then the next fill's MPG looks great).
Fix: `sumIntermediateGallons` (scorer) collects fuel from fills strictly between the chosen previous
fill and this one; `computedMpg`, `implausible_topoff`, and `expected_odometer_band` all now run on the
full span fuel (`ctx.intermediateGallons`), and the persisted `computed_mpg` uses it too. Golden test:
a 60-gal skipped fill turns a clean-looking 6.67 MPG into its true 4.0 and fires `mpg_deviation`.

## Verification

788 shared / 132 api / 19 web tests (15 new: tolerance boundary, both arbitration directions,
OBD-basis suppression incl. a 1,200 mi/day team span, span-gallons golden pair, hygiene clustering
matrix). Typecheck clean, eslint 0 errors, boundaries clean, catalog byte-identical,
`scoreTransaction.ts` kept at the 500-line budget. Remaining pre-existing debt: `routes/fueling.ts` (546).

## Deploy

No migration. Deploy API (digest + scorer) — then a Rebuild re-scores history with the new odometer
logic; expect fewer lone regressions (typos rerouted) and some new MPG deviations where skipped-fill
fuel was hiding them.
