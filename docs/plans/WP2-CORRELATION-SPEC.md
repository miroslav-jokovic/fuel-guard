# WP2 — Correlation & Visibility: Decisions + Implementation Record

**Status:** implemented · **Date:** 2026-07-24 · **Predecessor:** WP1 (docs/plans/WP1-DECLINES-SPEC.md)

WP2 resolves the three correlation-layer findings from the alerts audit: the weight-55 invisibility of
Odometer Regression, the >5,000-mi suppression evasion vector, and the invisible hard-coded
correlation thresholds — plus the read-only Cards UI carried over from WP1.

---

## Decision A — Odometer Regression stays weight 55 (deliberate, now visible)

A lone regression is usually a driver-entry typo; raising it to review-alone (≥60) would flood the
queue and erode reviewer trust — the opposite of the precision-first goal. Instead of raising the
weight, WP2 removes the real problem: **invisibility**. Every scored fill now persists its correlation
outcome — `fuel_transactions.case_level / case_score / case_signals` (migration 0080) — including
CLEAR fills, so a fired-but-sub-threshold regression shows on the Fuel Log as a "weak signal" chip
with the full threshold math in plain language (`explainCaseOutcome`). The decision is recorded in
`catalog.yaml` (note on `odometer_regression`) and should be revisited against real disposition data
once the WP9 calibration report exists.

## Decision B — The >5,000-mi evasion vector is closed where telematics exists

Before: any fill with `odometer_mismatch`/`odometer_entry_suspect` suppressed the three miles-derived
consumption rules (P-1) — so entering a wildly wrong odometer (weight-0 data-quality) silenced
`mpg_deviation`, `implausible_topoff`, and `expected_odometer_band` for free.

Fix: `milesSinceLast` already prefers the OBD span, which is **independent of the entered odometer**.
P-1 suppression now applies **only when the miles actually came from the entered odometer**
(`milesSinceLastSourced` exposes the basis). With both fills on OBD, a garbage entry no longer buys
silence — verified by a golden test where a 250,000-mi entry (entry_suspect) coexists with a live
`mpg_deviation` on the OBD-span miles. Trucks with no OBD span keep the suppression: there is no
trustworthy miles source to fall back to, and staying silent is the correct precision-first behavior
(this residual is inherent, not a bug — coverage for it comes from the tank/cumulative rules and the
WP6 coverage surfacing).

## Decision C — Correlation thresholds stay fixed constants, now exported and explained

Org-tunable thresholds were considered and **rejected**: letting an org detune the theft model
silently degrades detection (per-rule sensitivity already has a proper home in the thresholds table
and `disabledRules`). Instead the constants are exported (`CORRELATION_THRESHOLDS` = overwhelming 85 /
review 60 / alert 110) and surfaced:

- `explainCaseOutcome(level, score, signals)` — one plain-language sentence for ANY outcome,
  including clear ("strongest weight 55 < 60 … score 55 < 110").
- Fuel Log: "N weak signals" chip on clear fills with fired sub-threshold signals (tooltip = the
  explanation). Flagged fills keep explaining themselves on the Alerts page.
- Anomaly case banner now shows the threshold legend under the correlation bar.

## Cards UI (carried from WP1 decision 3)

Read-only "Cards" panel on the Rejections page (SlideOver): learned card→truck assignments with
masked card numbers (never a full PAN in the UI), assigned unit, and source (learned/manual), plus an
explanation of the learning rules. Data comes straight from `fuel_cards` under RLS.

## Changes

| Area | File(s) |
|---|---|
| Thresholds + explain | `packages/shared/src/anomalyRules/cases.ts` (CORRELATION_THRESHOLDS, explainCaseOutcome) |
| P-1 basis fix | `anomalyRules/helpers.ts` (milesSinceLastSourced), `anomalyRules/rules.ts` (basis-aware P-1) |
| Decision record | `anomalyRules/catalog.yaml` notes (generated file verified byte-identical) |
| Persisted outcome | `apps/api/src/services/scoring/scoreTransaction.ts`, migration `0080_case_outcome_on_fill.sql` |
| Fuel Log chip | `apps/web/src/features/fuel/useFuelLog.ts`, `apps/web/src/pages/FuelLogPage.vue`, `packages/shared/src/fuel.ts` |
| Case banner legend | `apps/web/src/features/anomalies/AnomalyDetail.vue` |
| Cards panel | `apps/web/src/features/fueling/useCardAssignments.ts`, `apps/web/src/pages/RejectionsPage.vue` |

## Verification

760 shared / 132 api / 19 web tests pass (7 new: OBD-basis P-1 golden tests, explainCaseOutcome for
all levels, threshold-drift guard). Workspace typecheck clean; eslint 0 errors; feature boundaries
clean; `catalog.generated.ts` byte-identical after regen; `rules.ts` kept under the 500-line budget.

## Deploy

1. Run `supabase/_deploy/apply_0080.sql` (additive) BEFORE deploying — the web fuel-log query now
   selects the new columns.
2. Deploy API + web.
3. Case outcomes populate as fills are scored; run a Rebuild (rules-only) to backfill `case_*` onto
   recent history so the chips appear immediately.

## Known debt (pre-existing, out of WP2 scope)

`lint:filesize` still fails on `apps/api/src/routes/fueling.ts` (546) and
`apps/api/src/services/scoring/scoreTransaction.ts` (515; was 511 before WP2's +4 lines) — both over
budget before this work. Recommend a dedicated split task (module pattern) alongside WP4.
