# WP6 — MPG/Baseline Integrity: Decisions + Implementation Record

**Status:** implemented · **Date:** 2026-07-24 · **Predecessors:** WP1–WP5

## 1. Sustained theft can no longer train the baseline (self-normalizing drift closed)

The rolling MPG baseline (median of recent per-fill MPGs) learned from ALL fills — so consistent
skimming slowly dragged the baseline down until its own deviations stopped firing. New
`contaminatesBaseline` (shared, pure): a fill with **physical volume-axis evidence**
(exceeds-capacity, tank-space, top-off, cumulative-overfuel, tank-fill-short) or a full
**alert-level case** is excluded from `recentTxns` and therefore from the learned baseline and
auto-derived `baseline_mpg`.

Deliberate boundary: a lone consumption-axis deviation (`mpg_deviation` itself) does **not**
contaminate — excluding those would ratchet the baseline (a legitimate efficiency loss fires once,
gets excluded, baseline never adapts, alert storm). Gradual legitimate decline is
`mpg_sustained_decline`'s job; the median absorbs one-off noise. The prev-fill odometer exclusion also
now reads the persisted `case_signals` (WP2) in addition to legacy per-rule anomaly rows — the old
anomalies-table check had quietly stopped matching after the correlation refactor (only `theft_case`
rows are written now); both sources are checked.

## 2. Real weather drives the cold derate (calendar becomes the floor)

`coldWeatherDeratePct(fueledAt, ambientTempF?)`: with a real temperature, ≤20°F → +10 pts, ≤32°F →
+5 pts, else 0 — **max'd with the calendar-month fallback**. Consequences: a genuine October cold
snap now earns its allowance (previously nothing), and a warm January day keeps the old leniency —
the derate **only ever widens** tolerance vs pre-WP6, so this change cannot create a new false alarm
by construction (locked by tests).

Temperature source: `backfillFillWeather` (new service) reuses the idle-events Open-Meteo machinery +
`weather_cache` to fill `fuel_transactions.ambient_temp_f` for recent fills nightly (migration 0081).
Only fills with coordinates AND a reliable instant get a temperature — a date-only noon sentinel never
gets a guessed temp (falls back to calendar). Best-effort; failures leave rows null.

## 3. Limited detection is visible on the fill (honest absence)

`summarizeFillGates` (shared) captures per-fill confidence gating — tank-sensor reliability, odometer
source, fill size, and the exact list of **ineligible rules** — persisted as
`fuel_transactions.case_gates` (migration 0081). The Fuel Log "why" surface (WP2) now includes it:
fills with gated-off checks show the ⓘ marker, and the tooltip says e.g. "Checks limited on this fill
(tank sensor not learned-reliable): More Fuel Than Tank Could Hold, Tank Fill Short, MPG Deviation …
did not run." An EFS-only fleet finally *sees* that its MPG detection is off, instead of reading
silence as safety. (Fleet-level view remains the Coverage page.)

## Structural

`scoreTransaction.ts` was over budget again — `learnVehicleValues` extracted to
`scoring/learnVehicle.ts` (re-exported; import paths unchanged). Only pre-existing debt left:
`routes/fueling.ts` (546).

## Verification

800 shared / 132 api / 19 web tests (12 new: temp-derate matrix incl. the only-widens guarantee,
contamination boundary cases, gates summaries for unreliable-sensor / GPS-odometer / full-coverage
fills). Typecheck clean, eslint 0 errors, boundaries clean, catalog byte-identical.

## Deploy

1. Run `supabase/_deploy/apply_0081.sql` (additive) before deploying.
2. Deploy API + web.
3. Temps backfill on the next nightly reconcile (~30 days back); MPG rules use them as rows fill in.
4. A Rebuild re-scores with contamination-aware baselines — trucks under sustained skimming may show
   NEW mpg deviations as their baseline recovers to the true value. That is the fix working.
