# 12 — Precision & Reliability Design (Fuel-Fraud Reconciliation)

**Goal:** zero false alarms, defensible alerts. Every alert we raise must be one we can stand behind.
This document takes what we've been fixing piecemeal (single-source odometer, despiking, the
`tankSensorReliable` gate, the trusted-anchor tank gate) and turns it into one coherent, industry-aligned
design — with concrete tolerances drawn from how Samsara, Geotab, Motive, WEX and Fleetcor/Comdata actually
do this. Nothing here is implemented yet; it's for review before we build.

---

## 0. The one principle everything follows

Real fraud systems converge on the same posture, and the research is unanimous: **design for precision, not
recall.** In fraud, a false decline / false accusation costs more than a missed catch — analyst time (~70% of
it is spent clearing false alerts), trust, and alert fatigue that buries the real thing. Geotab literally
labels its outputs "data anomalies for further investigation… not determinative of fraud." We adopt the same
stance: **suppress on weak/low-quality data, only escalate when multiple independent signals agree, and always
show why.**

The practical mechanism the whole industry uses — and the backbone of this design — is a **data-quality /
confidence gate that runs *upstream* of the fraud logic.** If GPS is missing, the timestamp is imprecise, the
sensor is uncalibrated, or the fill is too small to measure, the transaction routes to a *data-quality* path
(unverified / not-judgeable), **not** a fraud alert. This is exactly the pattern that separates the low-false-
positive systems from the noisy ones.

---

## 1. What we already do right (validated by the research)

These recent changes match industry best practice — keep them:

- **Single-source odometer** (OBD-only when present, never blended with GPS-odometer). Samsara does exactly
  this: prefer ECU/OBD, fall back to GPS-derived only when ECU is unavailable — *one source per vehicle, never
  blended*, because the two baselines differ by thousands of miles (the GPS device only counts from its install
  date; the ECU shows lifetime miles). Our recent fix is the correct model.
- **Despiking the odometer series** (monotonic non-decreasing, reject implausible jumps). Vendors describe the
  same symptoms (source-switch "spikes," multi-vehicle "drop-offs") and correct them rather than trust the jump.
  No vendor publishes exact filter constants — ours is a reasonable formalization.
- **`tankSensorReliable` gate on per-fill tank/volume/MPG rules.** The research is explicit that **per-fill
  volume-delta matching is the fragile signal** and should be gated behind a minimum fill size and a per-vehicle
  reliability flag; the *robust* signals are location match and capacity-exceeded (which only needs the ceiling).
  We're gating the right rules.
- **Trusted-anchor gate on `pctBefore`** (the fix from this session). Correct: the tank-space check is only valid
  when we know the true fill moment.
- **Correlation / multi-signal score** instead of firing on any single signal. This is the UEBA / weighted-risk-
  score pattern the whole field uses.

**Takeaway:** we're on the right architecture. The upgrades below are about *formalizing* the confidence gate,
adding a few high-value learned parameters, and aligning tolerances with published benchmarks.

---

## 2. Concrete upgrades (ranked by impact on false positives)

Each item: the problem → the real-world benchmark → the proposed logic → where it lives in our code.

### A. Formalize a single Data-Quality / Confidence gate  *(highest leverage; ties everything together)*

**Problem.** Our confidence gating is currently spread across rules ad hoc (`tankSensorReliable`, trusted anchor,
`crossSourceOdometerSource === "obd"`, location `unknown`). It works but it's implicit and easy to regress.

**Benchmark.** The lowest-false-positive systems "explicitly separate communication/data-integrity diagnostics
from the anomaly analysis" and "generate a data-quality alert (not a fraud alert) when input quality is bad."
SEON: excessive low-fidelity data *increases* false positives; prioritize verified high-signal inputs and make
each signal's contribution visible.

**Proposed logic.** Introduce one explicit per-fill **confidence object** computed in recon, consumed by every
rule:

```
FillConfidence {
  timeBasis:      "tank_confirmed" | "stop_estimated" | "reported" | "date_only"
  locationConf:   "gps_confirmed" | "in_state" | "unknown"
  odoSource:      "obd" | "gps" | "reconstructed" | null
  tankSensor:     "reliable" | "unreliable" | "unknown"
  fillSize:       "measurable" | "too_small"    // see (C)
  gpsCoverage:    "dense" | "sparse" | "none"
}
```

Then a small **rule-eligibility matrix** (one table, unit-tested) decides which rules may fire for a given
confidence. E.g. `tank_space_exceeded` requires `timeBasis ∈ {tank_confirmed, stop_estimated}` **and**
`tankSensor = reliable` **and** `fillSize = measurable`. This replaces scattered `if (x !== true) return none()`
guards with one auditable place, and lets the UI show "not judged because: date-only timestamp."

**Code.** New `packages/shared/src/recon/confidence.ts` (pure) + a `ruleEligibility(ruleId, conf)` table in
`anomalyRules.ts`. Recon already computes every input; this just names and centralizes it.

---

### B. Learned **combined** tank capacity from observed fills  *(the biggest dual-tank lever)*

**Problem.** Dual/saddle-tank tractors have one sensor reading one tank (or a blended value). Our capacity/
over-fuel checks use a single `tank_capacity_gal`. If that's a single tank's number, both-tank fills false-fire
"exceeds capacity" / "tank space exceeded"; even set to the total, the *sensor* still only sees one tank.

**Benchmark.** This is *the* documented fix. Motive derives tank size "from past refuel events"; Samsara
"estimates capacity from fuel-level data." A learned capacity converges to the observed max fill (i.e. the true
combined capacity of a dual-tank truck) instead of a nameplate single-tank figure. Both let you override.
Geotab flags only when volume exceeds capacity by **>110%**.

**Proposed logic.**
1. Learn `observedMaxFillGal` per vehicle = a high percentile (e.g. p95, to reject a bad pump reading) of
   single-transaction billed gallons over trailing history.
2. `effectiveCapacityGal = max(userEnteredCapacity, observedMaxFillGal)` — never below what the truck has
   demonstrably taken in one fill. Store it; show both entered and learned in the vehicle UI.
3. `exceeds_tank_capacity` fires only at `> effectiveCapacityGal × 1.10` (adopt Geotab's 110%).
4. Cold-start: until N≥? fills are seen, treat capacity as `unknown` → capacity rules suppressed (don't guess).

**Why it kills the false alarms.** A truck that regularly fills ~200 gal across two tanks learns a ~200-gal
effective capacity; a legitimate both-tank fill no longer trips the ceiling, while a genuine >220-gal phantom
still does.

**Code.** Learn in `scoring.ts` (same place we learn offset / reliability), store on `vehicles`, plumb into
`VehicleView.effectiveCapacityGal`; `ruleExceedsTankCapacity` / `ruleCumulativeOverfuel` read it.

---

### C. Minimum fill-size floor before any per-fill tank reconciliation

**Problem.** Small/partial fills don't move a coarse sensor enough to measure a rise, so any "billed vs observed
rise" comparison on them is noise → false shortfalls / false space-exceeded.

**Benchmark.** Geotab explicitly warns "small/partial fill-ups are not detected because the fuel-level change is
not noticeable." Standard J1939 fuel level (SPN 96) is coarse (0.4%/bit). The rule that emerges everywhere: only
reconcile fills large enough to clear sensor noise.

**Proposed logic.** `fillSize = "measurable"` only when billed gallons ≥ `max(15 gal, 8% of effectiveCapacity)`
*and* the expected level rise ≥ ~2 sensor steps. Below that → `too_small` → per-fill tank checks suppressed
(the fill still counts toward the *cumulative* window, which is robust). Feeds the confidence object in (A).

**Code.** `recon/tankFuel.ts` computes it; eligibility matrix in (A) enforces it.

---

### D. Two-tier time anchoring with distance-minimization for imprecise stamps

**Problem.** Date-only / timezone-shifted EFS stamps. We already anchor on the tank-rise event when present
(gold), but the fallback needs to be principled.

**Benchmark.** Geotab searches a **±3-hour window** around the card timestamp and picks the vehicle position
**closest to the station**, "for when the wrong timestamps are provided." WEX verifies within **0.5 mi on the
same day**. Samsara uses a tight **100 m / ±10 min** when the feed is real-time/trusted. I.e. **two tiers:**
tight when the stamp is precise, wide + resolve-by-distance when it isn't.

**Proposed logic.** When there's no tank-rise event:
- Precise stamp → keep the tight stop-match (current behavior).
- Date-only / suspect → search ±3 h (or same-day) and choose the stop **nearest the station** as the anchor;
  mark `timeBasis = "stop_estimated"`. If no in-radius stop exists in the window → `date_only`, and the tank/
  odometer point checks stay suppressed (we already do the right thing by not fabricating a noon reading).

**Code.** `recon/location.ts` / `findFuelingEvent` — add the distance-minimizing window search for the
imprecise branch.

---

### E. Align location tolerances with published benchmarks (0.5 mi verify)

**Problem.** Make our confirmed/mismatch radii match reality so we neither miss nor over-flag.

**Benchmark.** WEX "Verified" = GPS within **0.5 mi**, same day. Geotab "location mismatch" = **> ~0.6 mi
(1 km)** within ±3 h. WEX documents that a *consistent* miles-away offset means the **station coordinates are
wrong** (fix the pin), and a *consistent ~2-hour* offset is a **timezone** issue — neither is fraud.

**Proposed logic.**
- `gps_confirmed` when a ping is within **0.5 mi** of the station in-window.
- `location_mismatch` (theft candidate) only when GPS is *dense* that day **and** the truck was never within
  **1 mi** of the station — never on sparse/missing GPS (that's `unknown`, suppress).
- **Auto-detect systematic offsets:** if a vehicle/station pair is *consistently* ~same-distance off or
  ~constant-time off, flag it as a **calibration** issue (wrong station coordinate / timezone), not fraud —
  route to a data-quality list. (WEX's exact documented pitfall.)

**Code.** `recon/location.ts` tolerances; a small offline "systematic offset" detector over history.

---

### F. Explicit odometer offset model (Raw × Factor + Offset), waypoint-style

**Problem.** Our per-truck offset is a learned median; it's the right idea but under-specified, and the display
showed `-1` while a fill read +27k (the offset never captured a real constant baseline gap).

**Benchmark.** Geotab's exact model: `Odometer = Raw × Factor + Offset`, back-solved from a known dash value and
stored. WEX supports periodic "odometer waypoints" that recompute a correction factor between waypoints. GPS
straight-line odometer is typically **<1%** off true distance.

**Proposed logic.**
- Keep single-source (F is about the *offset*, built on the clean OBD series).
- Learn `offset` as the robust median of `(entered − obdAtFill)` over OBD-anchored fills; require ≥ N clustered
  samples or leave `offset = unknown` → the absolute odometer-mismatch rule stays display-only.
- Treat a single huge deviation (e.g. |diff| > 5,000 mi) as a **data-quality** flag ("check this entry"), not a
  theft signal — real odometer fraud is hundreds of miles, not tens of thousands (this is the 27k-row class).

**Code.** `scoring.ts` offset learning; `ruleOdometerMismatch` severity/eligibility.

---

### G. Robust over-fueling window (stop inheriting the noisy entered odometer)

**Problem.** `cumulative_overfuel` computes `windowMiles` from the **driver-entered** odometer span
(`scoring.ts:437`) — the same noisy value we've been fighting. One bad/duplicate entry collapses the miles →
false over-fuel.

**Benchmark.** Over-fuel = purchases exceeding **(miles ÷ baseline MPG) + one tank** of slack; a common hard
threshold is **>10 gal net-unaccounted**. MPG per txn = Δodometer ÷ gallons — but computed on *verified*
odometer. Double-swipe window ~**2 h**.

**Proposed logic.**
- Compute `windowMiles` from the **clean Samsara odometer span** (now single-source + despiked) when available;
  fall back to entered only when both endpoints are OBD-anchored and pass the despike.
- If `windowMiles` is not trustworthy (gaps, non-monotonic, <2 anchored points) → `cumulative_overfuel`
  suppressed for that window (data-quality, not fraud).
- Use `effectiveCapacityGal` (B) for the "+ one tank" slack, and require the overage to exceed **max(10 gal,
  tolerance)** so tiny excesses don't fire.
- Add the **double-swipe** check explicitly: two fills same card ≤ 2 h summing near capacity.

**Code.** `scoring.ts` window computation; `ruleCumulativeOverfuel`.

---

### H. Per-vehicle rolling MPG baseline + environmental derate + cold-start

**Problem.** A fixed/loosely-learned MPG baseline false-fires on cold weather, terrain, load, idling, and early
history.

**Benchmark.** Systems track **30 / 90 / 365-day rolling per-vehicle** MPG (compare each truck to itself),
alert at **10–15% below** its own baseline, and derate for environment: diesel highway **5–10%** worse in severe
cold, **~1%/hr** of idle, tire/aero losses in cold. Seed from up to 12 months of history to avoid cold-start.

**Proposed logic.**
- `baselineMpg` = rolling median (robust) over trailing 90 days of *valid full-fill-to-full-fill* pairs, per
  vehicle.
- Widen the deviation band by a seasonal derate (a simple month/temperature factor) before firing
  `mpg_deviation` / `mpg_sustained_decline` — still gated on `tankSensorReliable`.
- Cold-start: require ≥ N valid pairs before the MPG rules are eligible; until then `unknown` → suppressed.

**Code.** `scoring.ts` baseline learning; the two MPG rules already gated in this session.

---

### I. Separate reefer / DEF product from tractor MPG & volume math

**Problem.** Reefer diesel and DEF are non-propulsion volumes; counting them wrecks MPG and inflates over-fuel.

**Benchmark.** Cards carry a product code; the universal mitigation is to **split by product** and exclude
reefer/DEF from tractor-propulsion math. We already special-case `tankType: "reefer"`; extend to DEF and ensure
the cumulative window sums *tractor diesel only* (it already filters `tank_type = "tractor"` — verify DEF is
excluded upstream at import).

**Code.** import/normalization (product code → `tankType`/`isDef`); confirm `scoring.ts` window filter.

---

### J. Cold-start rule: don't judge a vehicle until it has a baseline

**Benchmark.** Adaptive-baseline systems "require N confirmed-normal events before flagging" and update the
profile from inliers. Prevents the classic new-truck / newly-integrated false-positive burst.

**Proposed logic.** Every learned parameter (capacity, offset, reliability, MPG baseline) has an explicit
`unknown` state until enough clustered history exists; in `unknown`, the dependent rules are ineligible (not
firing). This falls out naturally from (A)+(B)+(F)+(H).

---

## 3. Reference tolerance table (from the research, for our config)

| Parameter | Value to adopt | Source benchmark |
|---|---|---|
| Location "confirmed" radius | **0.5 mi**, same-day / in-window | WEX Telematics |
| Location "mismatch" radius | **> 1 mi**, only on dense GPS | Geotab ~0.6 mi (1 km) |
| Imprecise-stamp search window | **±3 h**, resolve by min distance | Geotab |
| Precise-stamp match | **100 m / ±10 min** | Samsara |
| Tank capacity exceeded | **> 110%** of *effective* capacity | Geotab |
| Min measurable fill | **≥ 15 gal or 8% of capacity** | Geotab (partial-fill limit), J1939 coarseness |
| Fuel-level smoothing | rolling **median of ~7** points | Samsara |
| Sudden-drop (siphon) alert | **≥ 5%** drop, engine-off + no distance | Samsara |
| Over-fuel net-unaccounted | **> 10 gal** over (miles/MPG + 1 tank) | fuel-loss patents / vendor practice |
| MPG deviation | **10–15% below** per-vehicle rolling baseline | fleet analytics |
| MPG baseline windows | **30 / 90 / 365-day** rolling median | fleet analytics |
| Double-swipe | two fills ≤ **2 h** near capacity | fuel-card controls |
| Cold-weather derate (diesel) | **5–10%** | fueleconomy.gov / Element |
| Huge-odometer-diff = data-quality | **> 5,000 mi** → not theft | (our rule; fraud is hundreds of mi) |

---

## 4. Suggested rollout (each phase independently shippable, behavior-locked by tests)

1. **Phase 1 — Confidence gate (A) + fill-size floor (C).** Refactor the scattered guards into one matrix +
   confidence object. No behavior change intended except cleaner suppression; lock with golden tests. *This is
   the foundation and immediately makes the remaining items small.*
2. **Phase 2 — Learned combined capacity (B).** The biggest dual-tank false-alarm killer. Learn + store +
   `effectiveCapacityGal`, adopt 110%.
3. **Phase 3 — Robust over-fuel window (G) + double-swipe.** Switch `windowMiles` to the clean Samsara span;
   suppress on untrustworthy windows.
4. **Phase 4 — Location tolerances + systematic-offset detector (D, E).** Adopt 0.5/1 mi, ±3 h distance-min;
   auto-classify constant offsets as calibration, not fraud.
5. **Phase 5 — Odometer offset model + huge-diff downgrade (F).** Tighten offset learning; reclassify >5k-mi
   diffs as data-quality.
6. **Phase 6 — MPG rolling baseline + environmental derate + cold-start (H, J).** Precision on the consumption
   axis.
7. **Phase 7 — Reefer/DEF product separation hardening (I).**

Everything stays **read-only and precision-first**: when in doubt, we mark a fill *unverified / not-judgeable*
and show the reason — never a fraud alert on data we can't stand behind.

---

## 5. Sources

Primary/production (concrete mechanics & tolerances):
- Geotab — Fuel Transactions (±3 h window, ~0.6 mi/1 km mismatch, >110% capacity, fuel-type match; "not
  determinative of fraud"): https://support.geotab.com/help/mygeotab/energy-and-sustainability/fuel/fuel-transactions
- Geotab — Fuel Fill-Ups (slosh, partial-fill limit, matching, window-of-data): https://support.geotab.com/mygeotab/doc/fuel-fill-ups
- Geotab — Odometer/Factor/Offset model: https://community.geotab.com/s/article/What-are-the-definitions-of-Odometer-Odometer-Factor-Adjustment-Offset-and-Raw-Odometer-and-how-do-they-work
- Samsara — Fuel Purchases Report (100 m / ±10 min verification): https://kb.samsara.com/hc/en-us/articles/360043272731-Fuel-Purchases-Report
- Samsara — Fuel Level Tracking (7-point rolling median): https://kb.samsara.com/hc/en-us/articles/360037502312-Fuel-Level-Tracking
- Samsara — Advanced Fuel Insights (capacity alerts, 5% sudden-drop): https://www.samsara.com/blog/announcing-advanced-fuel-insights
- Samsara — Odometer Management (prefer ECU, fall back to GPS; not blended): https://kb.samsara.com/hc/en-us/articles/115005273667-Odometer-Management-for-Vehicle-Gateways
- Samsara — Fuel Card Integration (dev docs): https://developers.samsara.com/docs/fuel-card-integration
- Motive — Fraud Detection (location/fuel-type/level mismatch, auto-decline, >90% accuracy): https://gomotive.com/products/features/fraud-detection/
- Motive — Fuel Level and Spend Mismatch (capacity from past refuels): https://helpcenter.gomotive.com/hc/en-us/articles/18269694656669-Fuel-Level-and-Spend-Mismatch
- WEX Telematics — Fuel Card Transactions report (0.5 mi verify, station-pin & timezone false-positive causes): https://help.wextelematics.com/docs/about-reports/using-the-fuel-card-transactions-report/
- WEX — how devices report odometer (install-time baseline, waypoints, source-switch spikes): https://help.wextelematics.com/deep-dive/how-does-my-device-report-odometer-values/
- Comdata/Fleetcor Enhanced Authorization Controls; skimming = 75% of fuel fraud (CCJ): https://www.ccjdigital.com/technology/article/15667329/technology-fuels-the-fight-against-fuel-fraud
- J1939 PGN/SPN reference (SPN 245 0.16 km/bit; PGN 65217 5 m/bit; SPN 96 fuel level): https://www.csselectronics.com/pages/j1939-pgn-list

Sensor calibration / dual-tank:
- Technoton — fuel tank monitoring (CAN coarseness, non-linearity, temperature, multi-sensor networking): https://jv-technoton.com/tasks/fuel-tank-monitoring/
- Digital Matter — non-linear analogue mapping + analogue-differential theft alert: https://support.digitalmatter.com/fuel-monitoring-in-telematics-guru
- Navixy — multi-sensor for split tanks: https://navixy.com/docs/expert-center/vehicle-telematics-technology/fuel-management/installation-and-initial-configuration-of-fuel-control-devices/fuel-level-sensors/types-of-fuel-level-sensors

False-positive / confidence-gating best practice:
- SEON — human-in-the-loop, high-signal inputs reduce FPs: https://seon.io/resources/human-in-the-loop-fraud-detection-and-prevention/
- Exabeam — UEBA adaptive per-entity baselines & risk scoring: https://www.exabeam.com/explainers/ueba/behavior-anomaly-detection-techniques-and-best-practices/
- FluxForce — ~70% of fraud-team time on false alerts: https://www.fluxforce.ai/blog/why-your-fraud-team-spends-70-of-their-time-on-false-alerts-1
- Kount — precision-first fraud metrics: https://kount.com/blog/precision-recall-when-conventional-fraud-metrics-fall-short
- Environmental MPG effects: https://www.fueleconomy.gov/feg/coldweather.shtml ; https://www.fleetowner.com/fleets-explained/article/55293519/

*Secondary/marketing-grade numbers (95–98% accuracy, 3–5% false-alarm, 2–5 mi radii) were treated as
directional only and are not adopted as tolerances above.*
