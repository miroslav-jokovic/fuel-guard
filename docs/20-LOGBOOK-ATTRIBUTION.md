# 20 — Logbook-Based Fill Attribution (WP-ATTR)

## Problem

`cumulative_overfuel` false-fired when a driver changed trucks: fills get their vehicle from the unit
number typed at the pump (or a stale card mapping), and a habit-typed OLD unit books the new truck's
fuel into the old truck's 48h window — gallons pile up while that truck's odometer barely moves, the
ceiling blows, false alert. Misattribution also poisons the previous-fill chain, the MPG baseline, and
the per-fill tank rules (a fill judged against a truck it never went into).

## Design — verify attribution against the ELD logbook

Samsara HOS log entries carry the **vehicle** they were recorded in. We already fetched them and
dropped that field. Three layers:

**1. Capture (migration 0120).** `parseHosLogs` carries the per-log vehicle; `hos_duty_segments` gains
`samsara_vehicle_id` + resolved `vehicle_id`. The segments become a queryable driver→truck timeline.
Diff-before-write and never-unlink semantics preserved; unresolved raw ids are kept for late linking.

**2. Verify (`packages/shared/src/fillAttribution.ts`).** At scoring time,
`verifyFillAttribution(attributedVehicle, fuelInstant, driverSegments)` classifies every fill:

- **confirmed** — some logbook segment within ±2h (`ATTRIBUTION_TIME_BUFFER_MS`) shows the attributed
  truck. Mid-switch ambiguity never accuses: EITHER truck in the buffer confirms (covers ELD login lag
  at shift start).
- **suspect** — the logbook has in-buffer vehicle coverage and NONE of it is the attributed truck.
- **unknown** — no driver on the fill, no reliable fueling instant (date-only rows are never checked
  against a noon sentinel), or no in-buffer coverage. Unknown never changes behavior.

Persisted per fill (`fuel_transactions.attribution_verdict`, `logbook_vehicle_id`) so the UI can show
why detection was limited. The deliberate posture: the logbook alone is a strong signal (~90–95%), not
an absolute — team drivers, hostlers, login lag are real. So:

- **suspect alone** → data-quality: the fill is excluded from the math (below), never called theft.
- **suspect + GPS corroboration** (`shouldReattribute`: telematics places the attributed truck AWAY
  from the station, `samsaraLocationMatched === false`) → the record is wrong with near-certainty:
  **auto-re-attribute** the fill to the logbook truck, audit-logged
  (`transaction.reattribute_vehicle`), then re-score ONCE under the correct vehicle with fresh
  reconciliation (recursion-guarded via `ScoreOpts.reattributed`).

**3. Harden the math.** For window rules, `loadConsumptionContext` now: excludes suspect fills from
`windowGallons`/`windowMiles` (reporting `windowSuspectGallons` for evidence); excludes suspect fills
from the previous-fill chain and the MPG baseline. And when THIS fill is suspect, `runAllRules`
suppresses every **vehicle-relative** rule (odometer, capacity, tank-space, top-off, over-fuel, MPG,
fill-short, rapid-repeat, reefer) — its gallons/odometer may belong to another truck, so judging the
attributed truck with them produced exactly the false criticals we're killing. Vehicle-independent
checks (cost outlier, off-hours, card-on-multiple-vehicles, driver-home) stay alive.

## Expected impact

Kills the truck-swap `cumulative_overfuel` false-alert class on ELD-covered drivers, and modestly
improves recall: corroborated re-attributions land fuel in the RIGHT truck's window where a real
overage becomes visible. Fills without an attributed driver stay `unknown` (unchanged behavior) —
attribution coverage is therefore a data-quality dimension worth surfacing next to sensor coverage.

## Rollout

1. Deploy migration `0120_logbook_attribution.sql`.
2. Next `hos_sync` runs populate segment vehicles (7-day trailing window; deeper history via the
   manual `sinceDays` backfill).
3. Rules rebuild → verdicts persist, suspect fills drop out of windows, corroborated misattributions
   self-heal (visible in `audit_logs`).

McLeod (when live) adds an independent driver↔truck assignment source that can feed the same verifier.
