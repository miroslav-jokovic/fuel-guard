# Idling Data — Plan to Reach >95% Confidence

**Prepared for:** Miki
**Date:** July 13, 2026
**Goal:** raise every dimension of the idling system to >95% confidence in *reliable and precise* data — and, just as important, make that confidence **measured by the system**, not asserted by a person.

---

## 1. The core idea: measure confidence, don't guess it

Right now I can only *estimate* confidence (~82% once rolled out) because the system doesn't report its own data quality. The single most valuable change is a **Data Confidence panel** that surfaces the coverage numbers that actually determine reliability:

- % of idle events attributed to a real driver
- % of trucks with equipment recorded (APU / optimized idle)
- % of idle dollars from **measured** fuel vs estimated
- % of idle events with a temperature reading (native or backfilled)
- % of trucks with a learned capability, and how often learned agrees with recorded
- agreement between Samsara idle events and our own engine-state idle measure

Once these are on screen, "are we above 95%?" stops being my opinion and becomes a number you can read. Everything below either **raises** one of these coverage figures or **tightens** a precision estimate — and the panel proves it moved.

---

## 2. Where each dimension stands, and what lifts it over 95%

| Dimension | Now | Target | The lever | Type |
|---|---|---|---|---|
| Measuring real idling | 95% | 98% | Cross-check Samsara idle events against our own engine-state idle measure | Code |
| Classifying avoidable vs excused | 78% | 95% | Backfill missing temperature; guard against null-temp; adopt the learned comfort band | Code + 1 setting |
| Cost / gallons precision | 72% | 95% | Use measured fuel everywhere it exists; learn a per-truck idle burn rate; temperature-adjust the estimate | Code |
| Driver attribution | 60–90% | 95%* | Fall back to the truck's assigned driver (by time) when Samsara has no operator on the event | Code + Samsara data |
| APU / Optimized-Idle fairness | 90% | 97% | Bulk CSV marking + VIN/model suggestions + the cross-check you already have | Code + marking |
| Learned cross-check | 70% | 88% | Auto-tune its thresholds against the now-recorded ground truth | Code |
| Code correctness | 92% | 97% | End-to-end test of the sync → classify → store → report pipeline | Code |

\* Attribution is the one dimension with a genuine external dependency — see §4.

---

## 3. The workstreams (grouped by payoff, quick wins first)

### A. Temperature backfill + null-temp guardrail  → classification 78%→95%
**Problem (verified in code):** `classifyIdleEvent` only excuses extreme-weather idle when Samsara returns an ambient temperature. When that field is null, the event silently falls through to **avoidable** — so genuinely cold/hot idle with a missing reading is over-counted as waste. This is the biggest *logic* soft spot.

**Fix:**
1. When Samsara's `airTemperature` is null, **backfill** it from a historical-weather lookup using the event's lat/lng + start time (we already store all three on every idle event, and already have a geocode service to build on).
2. If temperature is still unknown after backfill, classify as **`undetermined`** (tracked, not counted as waste) instead of defaulting to discretionary.
3. Add the "% of events with a temperature reading" figure to the confidence panel.

**Lift:** removes the systematic over-counting; classification becomes temperature-fair on essentially every event.

### B. Per-truck idle burn rate + measured-fuel coverage  → cost 72%→95%
**Problem (verified):** when Samsara doesn't measure fuel for an event, we estimate at a flat **0.8 gal/hr**. Industry data (US DOE/AFDC) puts real main-engine idle at **0.6–1.5 gal/hr** — the spread is driven mostly by A/C load and RPM, so a flat rate can be off by 30–50% on a hot-weather overnight idle.

**Fix:**
1. **Prefer measured fuel** (already done) — and **report** what share of idle dollars come from measured vs estimated fuel, so cost precision is visible.
2. **Learn a per-truck idle burn rate** from that truck's own measured events (and/or from `stats/history` cumulative-fuel deltas across idle segments — Samsara added this), falling back to a fleet-learned rate, then to 0.8.
3. **Temperature-adjust** the estimate when unmeasured (nudge toward ~1.2–1.5 gal/hr in extreme heat/cold where A/C or heat runs), grounded in the DOE range.

**Lift:** measured events are ~99% precise; estimated events tighten from ±30–50% to roughly ±10–15%. Blended precision clears 95% as long as measured-fuel coverage is decent (the panel will show it).

### C. Driver-assignment attribution fallback  → attribution 60–90%→95%*
**Problem (verified):** idle events are attributed **only** by the event's `operator.id`. Many events have no operator, so they land in "Unattributed" even when the truck clearly had a driver.

**Fix:**
1. Store **time-ranged driver↔vehicle assignments** (we already fetch a rolling window of them from Samsara for the vehicle sync — this just persists them).
2. When an idle event has no `operator.id`, attribute it to the driver **assigned to that truck at that time**, and mark the attribution **"inferred"** (vs "direct") so it's transparent.
3. Surface direct vs inferred vs unattributed on the confidence panel.

**Lift:** combining operator + assignment history typically attributes >95% of events **for fleets that assign drivers in Samsara** (see §4).

### D. Independent cross-validation of "real idling"  → 95%→98%
**Opportunity (verified):** we already pull `engineStates` and compute idle seconds per park session for capability learning. That's a **second, independent** idle measurement we're not using to check the first.

**Fix:** reconcile the Samsara idle-events total against the engine-state idle total per truck per period; flag material disagreements on the panel. Two independent signals agreeing is the strongest reliability evidence we can produce short of a fuel-flow meter.

### E. Fast + verifiable equipment marking  → capability 90%→97%
**Fix:**
1. Extend the existing vehicle-setup CSV to import `has_apu` / `apu_type` / `has_optimized_idle`, so all trucks can be marked in one upload instead of one-by-one.
2. Offer **suggested** equipment from make/model/year (e.g. a late-model Freightliner Cascadia → likely optimized idle) that an admin confirms — never auto-applied.
3. Lean on the cross-check you already have to catch mis-marks.

### F. Comfort band adoption  → part of classification
Make adopting the **learned** comfort band a one-click action (it's currently a suggestion an admin has to apply by hand), so classification runs on your fleet's real temperature behavior instead of the 20–85°F default.

### G. Pipeline integration test  → code 92%→97%
One end-to-end test that feeds a canned Samsara response through sync → classify → store → report and asserts the numbers, closing the gap that unit tests alone leave.

---

## 4. Honest ceilings — where code alone can't reach 95%

Two dimensions have a floor set by **input data**, not by our logic:

- **Driver attribution** depends on Samsara actually having a driver assigned (as operator on the event *or* as a vehicle assignment). The fallback in §C captures the assignment case, but if a fleet doesn't assign drivers in Samsara at all, no code can invent that link — the fix is operational (assign drivers/keypads in Samsara). The confidence panel will make this obvious by showing attributed % directly.
- **PTO / work idle** relies on Samsara reporting PTO/aux state. If a truck's PTO isn't wired to the harness, some working idle can't be told from waste. We can *measure and surface* PTO coverage, but raising it is a hardware/Samsara-config task.

For everything else (classification, cost, real-idling validation, capability, code), **>95% is achievable in code + the rollout steps.** The plan is built so the panel tells you exactly which trucks/events are dragging a number down, so the last mile is targeted, not guesswork.

---

## 5. Suggested sequence

Quick wins that move the biggest numbers first:

1. **Confidence panel** (keystone — makes everything measurable)
2. **Temperature backfill + guardrail** (biggest classification fix)
3. **Per-truck burn rate + measured-fuel coverage** (biggest cost fix)
4. **Attribution fallback** (biggest attribution fix)
5. **Bulk marking + suggestions** (unblocks capability coverage)
6. **engineStates cross-validation** (pushes real-idling to ~98%)
7. **Comfort-band one-click adopt** + **pipeline integration test** (polish)

Each is independently shippable, test-first, and ends with the confidence panel showing the number it moved. We'd run them as small phases exactly like the last five.

---

## 6. What I recommend we build first

If you want the fastest jump in *trustworthy* numbers: **items 1–3** (panel, temperature, cost). Those take classification and cost — the two weakest precision dimensions — over 95%, and give you a live readout of where the rest stands so we can target items 4–6 at whatever the panel shows is lowest.
