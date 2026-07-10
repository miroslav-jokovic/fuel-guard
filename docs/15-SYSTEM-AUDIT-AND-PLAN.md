# 15 — System Audit & Precision Plan

_Date: 2026-07-10 · Scope: idle-tracking feature, fuel-fraud detection precision, data reliability, tenant isolation, plus the Idling-page UI redesign and the manual-APU feature._

This document is deliverable #1 of the "report → plan → build" sequence you approved. **Part A** is the audit (severity-ranked findings, each with the exact code location, why it matters, and the fix). **Part B** is the research-backed standard we should hold ourselves to, with sources. **Part C** is the concrete implementation plan and recommended execution order. Nothing has been changed yet.

Two headline claims below were verified directly against the code, not just asserted:
- `learnObservedMaxFill`'s "p95 drops the top ~5%" is **false at our sample sizes** — at n=12 it returns the maximum. (`anomalyRules.ts:179`)
- Trucks are missing from the capability table because `syncIdleCapabilities` **never writes** a row for any truck it can't classify, and the UI then filters nulls out. (`idleCapabilitySync.ts:45`, `useIdleCapabilities.ts` `.not("idle_capability","is",null)`)

---

## Part A — Audit findings

### A1. Idle feature

**A1.1 — HIGH — "Why are only some trucks in the capability table?" (root cause).**
`syncIdleCapabilities` builds park sessions from Samsara `engineStates`, calls `learnIdleCapability`, and at `idleCapabilitySync.ts:45` does `if (cap.capability === "unknown") continue;` — so any truck it cannot classify gets **no row written at all** (its `idle_capability` stays NULL). The Idling page then queries with `.not("idle_capability","is",null)`, so those trucks are invisible. A truck is only classified when it produces **≥ 4 park sessions of ≥ 30 min each** inside the 14-day window (`learnIdleCapability` `minSessions=4`; `buildIdleSessions` `minSessionSec=1800`).
Compounding this: session boundaries are split on "driving," and driving is detected as `state !== "Off" && speedMph > 5` using the GPS speed decorated at the **instant of an engine-state change** (`idleSessions.ts`). An engine-start event fires while the truck is still stationary (speed ≈ 0), so driving is rarely detected, sessions rarely split, the whole window collapses toward one merged session, `sessions.length < 4`, and the truck is dropped. **This is the dominant reason the table is sparse**, and it means the trucks that _do_ appear are a biased subset (the ones that happened to trip the split logic), not a random one.
_Fix:_ (a) always upsert a row — write `unknown` with a sample/among-window count instead of skipping — so the UI can honestly show "not enough data yet" rather than hiding the truck; (b) stop trusting transition-instant speed for motion — split sessions using trip/GPS-distance history (`fetchAssetGpsHistory` already exists) or interpolated movement.
_Verification SQL (run to confirm the split):_
```sql
select
  count(*)                                            as total_vehicles,
  count(*) filter (where samsara_vehicle_id is not null) as with_samsara_id,
  count(*) filter (where idle_capability is not null)    as classified,
  count(*) filter (where idle_capability = 'unknown')    as unknown_written
from vehicles where org_id = auth_org_id();
```
Expect `classified` ≪ `with_samsara_id`, and `unknown_written = 0` (proving insufficient-data trucks are dropped, not labeled).

**A1.2 — HIGH — The learned "APU" label is behavioral, not equipment, and is unsafe as-is.**
`learnIdleCapability` labels `apu` when the engine was **Off ≥ 60%** of parked time. A driver who simply shuts the truck down overnight (no APU at all) satisfies this — so `apu` does **not** imply APU hardware (false positive). Worse, a truck that genuinely **has** an APU but whose driver keeps the main engine running never accumulates off-time → labeled `continuous_only` → `topAvoidableIdles` marks it `avoidable = false` → **the single biggest waste case the feature exists to catch is hidden** (false negative). This is exactly why your decision to make APU a **manual, admin-set flag** is correct — see Part B §2. The learned label should be demoted to an advisory cross-check.

**A1.3 — HIGH — The capability label is never actually used in the driver score.**
Migration 0043 states the label exists "so we don't penalize idle the truck couldn't avoid," but `classifyIdleEvent` / `aggregateDriverIdle` take **no capability input**; the score is purely temperature/PTO-based. So today the capability system only drives the cosmetic `avoidable` flag in the long-idle list. Either wire capability (soon: the manual APU flag) into scoring, or stop describing the score as capability-fair. _Fix folded into Part C Phase B._

**A1.4 — HIGH (verify) — `costUsd` from Samsara is trusted without unit/currency checks.**
`parseIdlingEvents` does `costUsd: Number(e.fuelCost.amount)` with no currency check and no minor-unit normalization, and this measured value **overrides** our own fuel×price estimate. If Samsara returns cents or a non-USD currency, every "wasted $" figure and the leaderboard sort is corrupted. `Number("…")→NaN` is also unguarded.
_Fix:_ you already specified the costing model you want — **0.8 gal/hr × actual EFS $/gal**. Prefer our own deterministic estimate over Samsara's `fuelCost`, and only use Samsara's value if we confirm it is USD dollars. This removes the risk entirely.

**A1.5 — MEDIUM — Unattributed idle is unmeasured and can dominate the leaderboard.**
Many idle events carry no `operator` (idle happens parked/off-duty), and any driver missing from our `drivers` table falls through to `driver_id = null`. All of these collapse into one "Unattributed" row that can top the "wasted $" list, with **no metric** on how large that bucket is. _Fix:_ expose attributed-vs-unattributed counts in the sync result and on the page; back-fill the driver from the vehicle's assignment at the event timestamp where possible.

**A1.6 — MEDIUM — Learned comfort-band suggestion is fed unfiltered events and can collapse to a 5°F band.**
`syncIdleEvents` feeds every temp-bearing event (including sub-threshold "brief" ones) into `learnComfortBand`, which can emit a band only one 5°F bin wide (e.g. 60–65°F). It's only a suggestion (never auto-applied), but an admin who adopted it would make nearly all idle "discretionary." _Fix:_ filter to scored events, enforce a minimum band width, reject a valley sitting on an edge bin.

**A1.7 — MEDIUM — `optimizedPct` overstates optimization and is statistically noisy.** It credits 100% of a session's parked time as "optimized" even when 40% of it was idle, and rests on as few as 4 sessions. Present it as a coarse indicator, not a precise percentage — or suppress it until it's built on a real park/idle split.

**A1.8 — LOW — Two different "long idle" definitions** (`aggregateDriverIdle` uses ≥ 1 h; `topAvoidableIdles` uses ≥ 2 h). Harmless but inconsistent; unify the language on the page.

### A2. Fuel-fraud detection precision

**A2.1 — HIGH — `learnObservedMaxFill` does not trim outliers at our sample sizes, and can mask fraud.**
Verified: `idx = ceil(0.95·n) − 1`. At n = 12 that is index 11 = the **maximum**; even at the full 30-fill window it drops only the single largest value. Because `effectiveCapacityGal` only ever **raises** capacity from this learned value, one erroneous or fraudulent oversized fill (e.g. a 300-gal typo) becomes the truck's learned capacity and then **suppresses** `exceeds_tank_capacity`, `tank_space_exceeded`, and `cumulative_overfuel` for that truck. There is no physical upper bound and no requirement that ≥ 2 fills corroborate the estimate.
_Fix:_ use a genuinely trimmed estimate (e.g. drop the top 10% with a floor, or take the 2nd-highest when n is small), require ≥ 2 fills near the learned value, and cap it at a physical multiple of nameplate capacity (Part B §3 supports a capacity-anchored ceiling).

**A2.2 — HIGH (biggest false-alarm source) — Tank-sensor reliability is decided on too few samples.**
`learnTankSensorReliability` uses `minSamples = 4`. A dual-tank truck that logs 4 single-tank fills early is marked `reliable = true`, which **enables** the weight-90 `tank_space_exceeded` rule (plus `implausible_topoff`, `mpg_deviation`), and then false-fires on every subsequent both-tank fill. The short-fill tail check added last session helps but doesn't fully cover 4 clean partials. _Fix:_ raise the floor to ~8 and require the observed rise/billed ratios not be bimodal (dual-tank signature) before declaring reliable. This is the highest-leverage false-alarm reduction available.

**A2.3 — HIGH — `tank_space_exceeded` fires from a single, possibly stale, pre-fill sensor sample.**
It reconciles a fill against one `tankPctBefore` reading; a stale reading that says 70% when the tank was really 20% overstates the overfill and fires a weight-90 (overwhelming, can-alert-alone) anomaly. _Fix:_ require the pre-fill sample to be fresh (close in time to the fill), gate on a measurable fill size (see A2.4), and/or prevent it from raising a lone critical without corroboration.

**A2.4 — MEDIUM — `fillSize` confidence is computed but never used.**
`computeFillConfidence` produces a `fillSize` signal (`tiny`/`measurable`) that `ruleEligible` ignores, so tiny partial fills are still reconciled against a coarse J1939 sensor — a needless false-positive generator for `tank_space_exceeded` / `tank_fill_short` / `mpg_deviation`. _Fix:_ gate those per-fill sensor rules on `fillSize === "measurable"`. Low risk — real siphoning still shows up on measurable fills and in the cumulative window.

**A2.5 — MEDIUM/HIGH — Non-deterministic learner queries → phantom alarms across rebuilds.**
The three learner queries in `learnVehicleValues` (odometer-offset `limit(10)`, tank-reliability `limit(12)`, observed-max-fill `limit(30)`) and the `current_odometer` pick order only by `fueled_at` with **no `created_at`/`id` tiebreaker**. EFS date-only rows share the noon sentinel timestamp, so which rows fall inside the limit is non-deterministic — two rebuilds can learn different values and therefore emit different anomalies. The codebase already fixed this exact class in its window/prev/station queries but missed the learner queries. _Fix:_ add `created_at, id` tiebreakers (zero detection cost, removes "appears/vanishes" alarms).

**A2.6 — MEDIUM — Fixed thresholds that should be reviewed or learned:** `tank_space_exceeded` tolerance `max(12, cap·0.1)`, `odometer_mismatch` tolerance 10 mi, `implausible_topoff` factor 1.3, `expected_odometer_band` factor 2, `mpg_deviation` 15%. Research (Part B §3) supports specific values for several of these — notably overfill at **>110% of capacity** and location at **>1 km over a ±3 h window**.

### A3. Cross-cutting / tenant isolation

**A3.1 — MEDIUM — `geocode_cache` is a global, cross-tenant, poisonable detection input.**
It has no `org_id`; learned "site" pump coordinates written by one org's telematics become a `location_mismatch` / `isSystematicStationOffset` input for **every** org. Not an RLS read-leak (service-role only), but a shared, corruptible detection input. _Fix:_ org-scope learned coordinates (keep the generic city/geocode cache shared, but store learned per-pump coordinates per org).

**A3.2 — OK — RLS posture is sound.** All main tables (`fuel_transactions`, `vehicles`, `drivers`, `anomalies`, `trailers`, `efs_transactions`, `anomaly_thresholds`) enable RLS, gate reads by `org_id = auth_org_id()`, and role-gate writes. No main table is missing RLS. `anomalies` has no user insert/delete policy by design (engine writes via service role).

---

## Part B — The standard we should hold to (researched, sourced)

Full citations in the research appendix at the end. Key take-aways that shape the plan:

**§1 Idle detection.** Idle = engine on + stationary, with PTO/AUX subtracted; neither Geotab nor Samsara ships a native "comfort vs discretionary" split — **we build that** from geofence + ambient temp + duration, all of which Samsara's `/idling/events` gives per event. Duration floors in the field: Geotab > 200 s, Samsara > 2 min. Class-8 main-engine idle burn is **~0.8 gal/hr (envelope 0.6–1.5)** — our 0.8 gal/hr assumption is on the money. Weather-justified warm-up guidance: < 0 °F ≈ 7 min, 0–50 °F ≈ 3–5 min, > 50 °F ≈ 1–2 min.

**§2 APU.** A diesel APU is a separate engine **not on the truck's J1939 bus**, so its runtime/fuel are invisible to the truck ECU — **APU presence is not reliably inferable and requires a manual asset attribute.** The only telematics cross-check is weak and probabilistic: battery-voltage trend (engine off + long overnight park + voltage holding/charging ~13.5–14 V suggests an APU or shore power; steadily declining voltage suggests battery-HVAC or a fuel-fired heater). Diesel-APU burn ≈ 0.25 gal/hr vs ~0.8 for main-engine idle. **Conclusion: manual `has_apu` flag = source of truth; telematics = confirm/contradict only.** This directly validates the approved design.

**§3 Fuel reconciliation.** Prefer **capacity-based and consumption-based** checks over tank-level checks on single-sensor dual-tank trucks (single OEM float sender carries 10–20% error). Concrete low-false-positive thresholds from production systems: overfill at **> 110% of recorded capacity**; location mismatch at **> 1 km (0.6 mi)** over a **± 3 h** window (tight distance, loose time — most mismatches are wrong timestamps, not fraud); attribution by VIN → serial → plate → description; require a **data window + driven-distance confirmation** before trusting a fill. Governance: **every flag is a review trigger, not proof of fraud.**

**§4 Data quality.** Odometer source-of-truth order: **OBD/ECU → GPS-derived distance → manual** (matches our verified 99.9% OBD finding). GPS validity gates worth adopting: reject fixes with < 4 satellites, PDOP > 6, accuracy > 30 m, or an impossible **speed jump > 30 km/h** vs the previous point. Minimum-sample precedent: Geotab needs ≥ 0.5 km to confirm an odometer increment and ≥ 5 km to validate the source; and n < 20 makes a learned standard deviation an unreliable estimator — justification for raising our learner sample floors (A2.1, A2.2).

---

## Part C — Implementation plan

Organized into four phases. Each item notes risk and whether it needs a migration + Supabase SQL (you run those manually). Phases are independent enough to reorder.

### Phase A — Idling page redesign (pure UI, low risk)
1. **Tabbed layout.** Move the three tables into tabs: **Driver scorecard** · **Avoidable idles** · **Truck capability**. Fleet money-summary cards stay pinned above the tabs.
2. **Filtering on each tab.** Reuse `TableToolbar` (already used elsewhere) so each tab has search + relevant filters (driver, truck, capability, avoidable-only).
3. **Remove the top explanation paragraph**; relocate the definitions into a small "How idle is scored" info popover so the page opens on data, not prose.
4. Unify the "long idle" wording (A1.8).
_No migration. Ships independently._

### Phase B — Manual APU flag as source of truth (the reliability fix)
1. **Migration:** `vehicles.has_apu boolean` (nullable = unset/unknown) + optional `apu_type text` (`diesel_apu` / `battery_hvac` / `fuel_heater` / `none`). Supabase SQL provided when built.
2. **Vehicles page:** admin/fleet-manager-editable **Has APU** control per truck (source of truth).
3. **Wire into idle logic:** the `avoidable` flag in `topAvoidableIdles` and the fairness in scoring use **`has_apu`**, not the learned label. APU-equipped truck idling the main engine overnight → **avoidable** (the case A1.2 currently hides). No-APU truck idling for climate in extreme temp → **justified**.
4. **Demote learned capability to an advisory cross-check:** keep computing it, show it next to `has_apu`, and **flag disagreements** ("telematics suggests APU but truck marked no-APU — review"). This is the "learned as check" half of your decision.
5. **Always write a capability row** (A1.1) incl. `unknown` + sample count, so the tab shows every truck with an honest data-sufficiency state.
_Migration required. Depends on nothing in Phase A._

### Phase C — Idle data-reliability fixes
1. **Costing:** switch idle $ to our deterministic **0.8 gal/hr × EFS $/gal**, use Samsara `fuelCost` only if verified USD (A1.4). Guard `NaN`.
2. **Session/driving detection:** stop trusting transition-instant speed; split park sessions using GPS-distance/trip history so the capability sync stops collapsing to one session (A1.1).
3. **Unattributed metric:** surface attributed vs unattributed idle counts; back-fill driver from vehicle assignment where possible (A1.5).
4. **Comfort-band learner:** filter to scored events, min band width, no edge-bin valley (A1.6).

### Phase D — Detection-precision fixes (fewer false alarms, no lost fraud)
1. **`learnObservedMaxFill`** — trim properly, require ≥ 2 corroborating fills, cap at a physical multiple of nameplate (A2.1). _Highest correctness impact — currently can mask fraud._
2. **`learnTankSensorReliability`** — raise floor to ~8 + bimodal/spread guard (A2.2). _Highest false-alarm reduction._
3. **`ruleEligible`** — gate per-fill sensor rules on `fillSize === "measurable"` (A2.4).
4. **Learner-query determinism** — add `created_at, id` tiebreakers (A2.5).
5. **`tank_space_exceeded`** — pre-fill sensor freshness guard + no lone-critical without corroboration (A2.3).
6. **`geocode_cache`** — org-scope learned pump coordinates (A3.1).
7. **Adopt researched thresholds** where they beat ours — overfill > 110% of capacity, location > 1 km / ± 3 h (A2.6, Part B §3).
_Each is a small, independently-testable change with a unit test. Migration only for D6._

### Recommended execution order (efficient + precise)
- **First, Phase D1–D2 + D4** — these are the correctness/false-alarm fixes that directly serve "we can't have unreliable data," they're small and test-backed, and D1 currently _masks real fraud_. Ship as one tested commit; you Rebuild to see the effect.
- **Then Phase A** — visible UI win, zero backend risk, no migration.
- **Then Phase B** — the APU source-of-truth (one migration + Vehicles UI + idle wiring); this is the structural reliability upgrade for the idle feature.
- **Then Phase C + remaining D** — the deeper idle data-flow fixes and the rest of the precision hardening.

I'll pause here for your review of this report and plan. On your go-ahead I'll start with the recommended order (or whatever order you prefer), building and testing each phase and giving you the Supabase SQL for any migration.

---

## Research appendix — sources

Idle detection & fuel burn: Geotab True/Operational idling (https://www.geotab.com/blog/detect-stop-true-fleet-idling/), Geotab idling report thresholds (https://support.geotab.com/help/mygeotab/reports/safety-reports/idling-time), Samsara PTO/AUX/Idle (https://kb.samsara.com/hc/en-us/articles/360062066772-PTO-AUX-Idle-Time), Samsara `/idling/events` (https://developers.samsara.com/reference/getidlingevents), Argonne/DOE HDV idling ~0.8 gal/hr (https://afdc.energy.gov/files/u/publication/hdv_idling_2015.pdf), EPA SmartWay idle reduction (https://www.epa.gov/smartway/idle-reduction), J1939 SPNs (https://www.csselectronics.com/pages/j1939-pgn-list).

APU: EPA idle-reduction technologies (https://www.epa.gov/verified-diesel-tech/learn-about-idling-reduction-technologies-irts-trucks-and-school-buses), NACFE diesel APUs ~0.25 gal/hr (https://nacfe.org/research/technology/idle-reduction/diesel-apus/), Thermo King TriPac (own telematics) (https://www.thermoking.com/na/en/newsroom/high-efficiency-apus.html), Samsara aux input (https://kb.samsara.com/hc/en-us/articles/19757622859661-Configure-an-Auxiliary-Input).

Fuel reconciliation thresholds: Geotab Fuel Transactions (https://support.geotab.com/help/mygeotab/energy-and-sustainability/fuel/fuel-transactions), Geotab fuel fill-ups (https://support.geotab.com/mygeotab/doc/fuel-fill-ups), fuel-level sensor error (https://navixy.com/docs/expert-center/vehicle-telematics-technology/fuel-management/installation-and-initial-configuration-of-fuel-control-devices/fuel-level-sensors/types-of-fuel-level-sensors), Samsara fuel-fraud overview (https://www.samsara.com/blog/the-high-cost-of-fuel-fraud-and-how-public-fleets-can-prevent-it).

Data quality: Geotab GO logging / RDP curve (https://geotab.github.io/sdk/software/guides/go-device-logging/), Geotab GPS validity gates (https://support.geotab.com/en-GB/mygeotab/doc/gps-summary), Samsara distance-traveled guide (https://developers.samsara.com/docs/calculating-distance-traveled-guide), GPS.gov accuracy (https://www.gps.gov/systems/gps/performance/accuracy/).
