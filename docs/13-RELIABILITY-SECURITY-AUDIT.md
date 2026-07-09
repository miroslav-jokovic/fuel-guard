# 13 — Reliability, Precision & Security Audit

A read-only audit of the system beyond the six precision phases (docs/12), run while the post-deploy re-check
was in progress. Three independent reviewers covered (A) reliability & data integrity, (B) remaining detection
precision, and (C) security & tenant isolation. Findings are severity-ranked with file references and a
one-line fix each. Nothing here has been changed yet — this is for triage.

**Headline:** Security posture is strong (no critical/high — details in §C). The highest-impact items are in
reliability and precision, and two of them are gaps in the phases we just shipped (P-2 and P-6b) that I should
close first.

---

## A. Reliability & data integrity

### High

**R-1 — Schema-drift check is stale; a missing column silently breaks ALL scoring.**
`scoring.ts` now selects `samsara_nearest_station_miles` (migration 0040) and `observed_max_fill_gal` (0039),
but `schemaCheck.ts` only validates through 0038. If either column is absent, the whole PostgREST select fails
and every transaction scores with no vehicle/recon context — org-wide, with no boot warning.
*Fix: add both columns to `schemaCheck` CHECKS; assert every `FTXN_COLS` column is covered.* (You've run the
SQL, so you're fine now — this protects against future drift.)

**R-2 — Non-deterministic window ordering breaks rebuild idempotency.**
The cumulative-window query orders only by `fueled_at` with no tiebreaker; date-only rows share the noon
sentinel, so same-day fills return in arbitrary order and feed `robustWindowMiles`' regression check → the same
rebuild can produce different `cumulative_overfuel` results. (The previous-fill query already adds
`created_at,id` tiebreakers; this one and the systematic-offset sample don't.)
*Fix: append `.order("created_at").order("id")` to the window and station-offset queries.* Directly affects the
Phase 3 determinism.

**R-3 — Two-pass learning: rebuild isn't a fixed point.**
Learned vehicle values (offset, tank reliability, observed-max-fill, baseline MPG) are read at the start of a
fill's scoring and written at the end, so the triggering fill is scored against the OLD value; new values apply
only on later fills / the next rebuild. One rebuild vs two yields different anomalies.
*Fix: converge learned values in a pre-pass (or re-score a vehicle until stable) before emitting anomalies.*

### Medium

**R-4 — Transient geocode failures poison a 30-day negative cache.** A 429/503/timeout is upserted as
`resolved:false` and suppressed for 30 days, dropping those stations to coarse state-level matching for a month.
*Fix: only negative-cache genuine empty results; short-TTL or skip on network/5xx/429.*

**R-5 — Lost-update race on vehicles learned fields.** Read-modify-write of learned fields is non-atomic;
different job kinds (efs_ingest cascade, nightly_reconcile, live cascade) can score the same vehicle
concurrently and drop each other's learned values. *Fix: serialize scoring per vehicle/org, or use a
conditional/RPC update for learned fields.*

**R-6 — Mid-backfill Samsara outage degrades silently.** The abort guard only fires while every attempt so far
has failed; once any early fetch succeeds, a later total outage never trips it, so a big re-sync can silently
under-reconcile. *Fix: track consecutive failures and abort on a run regardless of earlier successes.*

### Low
**R-7** `Number()`/`n()` lack an `isFinite` gate → a malformed numeric string becomes `NaN` in odometer/MPG
math. **R-8** best-effort `.catch(() => null)` (geocode, vehicle sync) hides systemic outages as "no data" —
add structured logging. **R-9** stats-history page cap (120) returns partial data silently if ever exceeded —
throw instead.

---

## B. Remaining detection precision

### Critical

**P-1 — A moderate driver-odometer typo poisons three axes → false theft alert.**
The per-fill miles/MPG chain reads only the driver-entered `txn.odometer`, never the clean OBD `samsara_odometer`
that Phase 3 already trusts for the window. So one under-entered odometer in the 10–5,000-mi band fires
`odometer_mismatch` (odometer axis 45) **and** corrupts miles → `mpg_deviation` (consumption 30) **and**
`implausible_topoff` (volume 50) = 125 across three axes ≥ ALERT_SCORE → a false theft alert from a pure
data-entry error. *Fix: compute per-fill miles/MPG from the OBD span when present, OR suppress the
consumption/volume per-fill rules on any fill where `odometer_mismatch`/`odometer_entry_suspect` fired.*

### High

**P-2 — `tank_space_exceeded` still uses the nameplate capacity, not the learned combined capacity.** *(gap in
Phase 2 — mine.)* `exceeds_tank_capacity` and `cumulative_overfuel` use `effectiveCapacityGal`, but
`tank_space_exceeded` still reads `vehicle.tankCapacityGal`, so an under-entered nameplate understates free
space → a false **critical** (weight 90, alerts on its own). *Fix: use `effectiveCapacityGal(vehicle)` there
too.*

**P-3 — `implausible_topoff` and `mpg_deviation` double-count one artifact across two axes.** "gallons >
1.3·miles/baseline" (volume 50) and "miles/gallons < 0.85·baseline" (consumption 30) are the same
gallons-vs-miles inequality; gated identically, they nearly always co-fire and inflate the correlation
review→alert. *Fix: put them on one axis, or treat the pair as a single signal.*

**P-4 — Tank %→gallons is treated as linear, but sensors aren't (especially near full).** `freeSpace =
cap·(1−pct/100)` and `observedRise` are linear; a near-full sensor reading optimistically high understates free
space → false critical `tank_space_exceeded`. `tankSensorReliable` validates the rise *ratio*, not the pre-fill
*linearity*. *Fix: widen the near-full tolerance, or learn a per-truck non-linear curve.*

### Medium

**P-5 — `implausible_topoff` assumes every fill is to-full**; a partial-then-full pattern legitimately dispenses
more than consumed since last. *Fix: require a low pre-fill tank %, or rely on `cumulative_overfuel`.*
**P-6b — `mpg_sustained_decline` never got the Phase 6 cold-weather derate** *(gap in Phase 6 — mine)*; a
legitimate fall→winter decline false-fires. *Fix: apply `coldWeatherDeratePct` to its threshold.*
**P-7 — Reefer classification is item-code-only** while fuel-type falls back to description; a reefer line with
an unknown item code but "reefer" in the text imports as a tractor fill and pollutes tractor math. *Fix: let the
description also drive `tank_type`.* (DEF is correctly excluded already.)
**P-8 — Learned values applied a pass late (cold-start)** — early historical fills keep cold-start false
positives until an unbounded rebuild. *Fix: re-score a vehicle's prior fills once a learn threshold flips.*
**P-9 — Off-hours uses one org-wide timezone**, misjudging fills near the 05:00/20:00 boundary on other coasts
(weight 20). *Fix: use the fueling state's timezone.*

### Low
**P-10** `cost_outlier` uses static global $/gal min/max (ignores region/date). **P-11** `robustWindowMiles`
entered-span fallback can be inflated by a high current-fill typo (minor false-negative).

---

## C. Security & tenant isolation

**Overall: strong.** Every route runs `requireAuth`; `org_id`/`role` come only from the verified JWT (never the
body); every service-role query filters by `org_id` or descends from an org-verified row; RLS is on for every
tenant table with default-deny on `integration_credentials`. SSRF is not possible (fixed hosts,
`encodeURIComponent`), AI prompts treat transaction text as untrusted data with Zod-validated tool output, and
no secret is logged or shipped to the web bundle. **No critical or high findings.**

### Medium
**S-1 — CSV formula injection in report exports.** `toCsv` escapes quotes/commas/newlines but not a leading
`= + - @`; untrusted EFS fields (driver name, location/station text) export verbatim, so a crafted name like
`=cmd|...` executes when the CSV is opened in Excel/Sheets. *Fix: prefix any cell starting with `= + - @ \t \r`
with `'`.*

### Low
**S-2 — Unescaped user data in notification email HTML** (`fuelEvents.ts` `notifyFuelDrop`) — HMAC-gated so only
Samsara can trigger; HTML-escape interpolated values. **S-3 — PII in logs** (invite emails, full error objects)
— tighten redaction for a fleet handling driver names + card refs. **S-4 — Defense-in-depth:** several scoring
queries are scoped by `vehicle_id`/`id` only (safe today via the org-verified entry point) — add `.eq("org_id",
orgId)` to be robust to future refactors. **S-5 — Single global Samsara webhook secret** across tenants (events
still route to the owning org by vehicle lookup) — consider per-org secrets.

---

## Recommended order of fixes

1. ~~**Quick completions of the phases just shipped:** P-2, P-6b, R-2, R-1.~~ **✅ DONE** (commit "audit bundle 1").
2. ~~**The one live false-positive path:** P-1, P-3.~~ **✅ DONE** (commit "audit bundle 2").
3. **Correctness/robustness (OPEN):** R-3/R-5/R-8 (determinism + learned-field race + visibility), R-4/R-6
   (external resilience).
4. **Security hardening:** ~~S-1 (CSV injection)~~ **✅ DONE**; S-2/S-3/S-4 still open.
5. **Longer-horizon precision (OPEN):** P-4 (non-linear tank curve), P-8 (re-score prior fills on learn-flip),
   P-5/P-7/P-9.

### Status legend
✅ Fixed & test-locked: **P-1, P-2, P-3, P-6b, R-1, R-2, S-1**.
◻ Open (recommended next): **R-3, R-5** (determinism/race), **R-4, R-6** (external resilience), **P-7** (reefer
description classification), **P-8** (re-score on learn-flip), **S-2/S-3/S-4** (hardening), then longer-horizon
**P-4/P-5/P-9**.
