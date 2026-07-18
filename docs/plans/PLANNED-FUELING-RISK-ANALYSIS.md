# Planned Fueling — Risk, Assumption & Gap Analysis

**Companion to** `PLANNED-FUELING-PLAN.md`. Method: two independent adversarial reviews (an internal-logic red-team of the spec + an external-facts verification against Samsara/FMCSA/HERE docs, July 2026). Every regulatory/API claim below is cited in the source plan's §13 or noted UNVERIFIED.

## Verdict

The architecture is sound and cheap, but **as written the plan is not yet safe to trust** — it contains one hard safety contradiction, several stranding paths, and it makes the correctness-measurement loop optional. None of the issues is fatal to the design; all are fixable. Two items need a **business decision from you** (reefer scope; price basis + discount granularity). The single most important process change: **the accuracy/measurement loop must be a launch gate, not "optional, ships last"** — without it we cannot know in production whether the feature is giving bad advice until a truck runs dry.

**Fix priority:** resolve the 5 Critical items and confirm the 1 hard dependency before writing solver code; the High items before the dry-run; Medium before general rollout.

---

## 0. The one hard dependency to verify FIRST (before any build)

**Does this fleet actually populate Samsara Routes, and does a route's last stop equal the real load destination?** Routes are optional dispatch objects a fleet must create (manually, via TMS, or driver self-dispatch); a fleet can use Samsara purely for GPS + ELD and **never create a route**. If so, `GET /fleet/routes` returns nothing and the whole feature has no trigger. Also, Samsara has no first-class "order/destination" entity — the true destination sometimes lives in a stop's free-text `notes`, and routes get reassigned mid-trip. 
**Action:** call `GET /fleet/routes` on the real token and inspect actual payloads before building. If routes are sparse or destinations unreliable, we need a fallback trigger (e.g., plan from current GPS + a manually/e-provided destination) or the feature scope changes. **This is assumption #1 and it is currently unproven.**

---

## 1. CRITICAL — can strand a truck or is a safety contradiction

**C1 — The 50-gal emergency cap can violate the "never below reserve" rule.**
Rule 1 says safety is non-negotiable and overrides the caps; the emergency rule says fills are "capped at 50 gallons." These contradict. 50 gal ≈ 300 mi. In a sparse corridor (I-80 Wyoming, US-95 Nevada, west Texas) where the next preferred station is 380 mi away, a capped fill leaves the truck 80 mi short — a cost cap silently overrode safety.
**Fix:** emergency fill must be sized to **reach the next reachable station + reserve**. The 50-gal number is a *soft cost preference*, explicitly subordinate to Rule 1. (Corrected in plan §8.1.)

**C2 — No defined behavior when NO station (preferred or emergency) is reachable before reserve.**
The edge-case list covers no-fuel-data and no-preferred-reachable, but not "nothing of any brand is reachable." The solver would emit an unreachable least-bad stop or garbage.
**Fix:** add a loud **INFEASIBLE — no reachable fuel, act now** alert state (not a quiet low-confidence badge). This is the most important missing edge case for a safety feature. (Added to plan §8.)

**C3 — Range is built on one baseline MPG; real burn is not miles-only.**
Diesel use swings 30–50% with grade, gross weight, headwind, cold — and **idling and reefer burn gallons while adding zero miles**, which breaks the miles×MPG model outright. An unquantified "conservative safety factor" is not a defense. Winter Rockies + 9 h overnight idle can turn a predicted 22%-arrival into an 8% strand.
**Fix:** (a) quantify the safety factor and calibrate it against observed EFS-vs-predicted error, not a guess; (b) model idle burn (gal/hr × idle hours) and reefer burn separately; (c) auto-widen reserve in mountain/winter corridors. (Flagged in plan §8.2; idle/reefer depends on the reefer scope decision, §Decisions.)

**C4 — California "cross on one tank" fails for long-CA, starts-in-CA, and multi-crossing routes.**
LA→Oregon on I-5 is ~800 mi entirely inside CA — longer than one tank, with no "last preferred station before the border." CA-domiciled trucks must fuel in CA to leave. I-15/Tahoe/border corridors cross the line repeatedly. The single-entry mechanism has no output for these.
**Fix:** define CA behavior for (1) in-CA distance exceeding one-tank range → planned in-CA fills, accept cost, don't strand; (2) origin inside CA; (3) N boundary crossings → per-segment logic. (Corrected in plan §8.1.)

**C5 — Optional accuracy loop = the feature can ship with zero correctness feedback.**
M10 (EFS reconciliation, prediction-error, adherence) is "optional, ships last." That means no way to detect systematic bad advice until a strand happens.
**Fix:** make measurement a **launch gate**. Required monitored signals: predicted-vs-actual arrival fuel% (from the next `fuelPercents` reading), emergency-fill rate, near-reserve-breach rate, and suggested-station-not-passed rate. (Corrected in plan §10 + §12.)

**C6 — Verification tests the math, not the physics; "provably optimal" is misapplied.**
Property tests validate the solver against its own inputs; they cannot catch stranding from wrong inputs (optimistic MPG, biased sensor, closed/missing station). Also, the Khuller/Lin optimum assumes **variable** purchase amounts — Rule 4 forces full fills, so full-fill is *not* that optimum and "adding a cheaper station never raises cost" may not hold.
**Fix:** add end-to-end tests with adversarial physical inputs (biased MPG, +10% sensor, fuel-desert, closed station); golden routes must include CA and fuel-desert cases; correct the optimality language. (Corrected in plan §8.3 + §10.)

**HOS correctness (critical, from FMCSA + Samsara docs) — using `driveRemaining` alone is wrong.**
Legal remaining driving is the **minimum of the 11-h drive, 14-h shift, and 60/70-h cycle clocks** — whichever binds. `driveRemainingDurationMs` alone overstates range whenever shift or cycle binds → an illegal/unreachable suggestion. The 30-min break is a **segmenting** constraint (forces a stop after `timeUntilBreak` of driving) and it consumes shift wall-clock. Don't rely on split-sleeper or the adverse-driving +2 h as available capacity. Short-haul/other rulesets return different/absent clocks — drive off the values Samsara returns, not hard-coded constants. Convert time→distance with a **conservative** average speed, reserve-padded.
**Fix:** `legalDriveTime = min(drive, shift, cycle)`; treat break as a mid-route segmenter; conservative speed. (Corrected in plan §8.)

---

## 2. HIGH — likely wrong/unsafe in realistic conditions

- **H1 Detour fuel not in the reserve check.** Detour miles are computed for display; the round-trip to the pump must be subtracted from range/reserve, or a "reachable" station drops the truck below reserve on arrival.
- **H2 Full-fill can exceed legal gross/axle weight.** Topping ~300 gal adds ~1,000+ lb; a truck near 80,000 lb GVW could go over. Cap fills to stay legal — needs **load weight** input (not currently modeled).
- **H3 Price basis unconfirmed + single org-wide discount.** The most load-bearing pricing fact is a CONFIRM-LATER. Real Pilot deals are often per-site/volume/tier. If the email is posted retail and a flat cents-off is applied, true net can invert two stations' ranking → truck routed to the wrong "cheaper" site. Model discount at **station granularity, calibrated per-station against EFS**, with a fallback for stations lacking EFS history.
- **H4 HOS staleness → illegal/unreachable suggestions.** Offline tablet can leave `driveRemaining` hours stale. Gate HOS-dependent suggestions on GPS-timestamp liveness; when stale, assume break/limit due soon and flag hard.
- **H5 Wrong-highway divergence detected too late.** "Top few candidates" only helps for two stations on the *same* road; when HERE picks I-80 and the driver takes I-90, the whole candidate set is off-route, and deviation confirmation (N min/M mi) burns fuel before recompute fires. Detect ambiguous highway choices at plan time (flag low route-confidence / show both corridors); shorten the deviation window when fuel is low.
- **H6 Station-registry errors from OSM (missing / closed / mis-branded / wrong diesel flag).** Each is high-impact: a missing Pilot fabricates a fuel gap; a still-listed closed station can strand a low truck (up to a quarter until refresh); a ONE9 mislabeled as Pilot silently breaks the avoid-ONE9 rule; a false `has_diesel` sends a truck to a site it can't fuel at. Cross-validate OSM against the Pilot official export **and** the daily price email (a station that stops appearing in the email is likely closed); verify brand via Wikidata + name; treat closures and `has_diesel` as safety-critical with tighter-than-quarterly refresh.
- **H7 Store-number matching (OSM ↔ email ↔ EFS) is fragile.** If IDs don't join, the cheapest corridor station gets no price row and is dropped or mispriced. Define a canonical key + fuzzy (lat/lng + name) fallback + a monitored unmatched-rate; define explicit behavior for "in-corridor station with no price row."
- **H8 Partial email-parse failures won't trip the staleness warning.** Age-based TTL won't catch silently dropped rows (format drift). Validate expected row count / completeness per email and alert on drops.
- **H9 Fuel% fallback (last EFS fill) can badly overestimate.** It stacks a consumption guess on the same suspect MPG. Cap how far back an EFS-fill fallback is trusted; below that, **abstain** rather than emit a plan a driver might follow.
- **H10 Reefer/idle burn not modeled.** For refrigerated fleets the reefer burns ~0.5–1 gal/h independent of miles (separate or shared tank). A miles-only model is structurally wrong for reefers. **Scope decision required.**

---

## 3. MEDIUM

- **M1 Unit-conversion minefield** — HERE wants kg/cm; US specs are lb/in/ft; tanks gal; distances meters vs miles. One slip = plausible-but-wrong result, no crash. Centralize typed units + round-trip tests + range asserts.
- **M2 `plannedDistanceMeters` vs HERE distance** — spec "cross-checks" but defines no authoritative source or divergence alert threshold.
- **M3 Opposite-side / wrong-direction candidates** — a station across a divided highway is within 2.5 mi but not practically reachable; check access side, not just proximity.
- **M4 Route created inside the 10-min poll gap** — first leg may have no plan and pass the cheap station before the plan exists. Add a fast first-plan path / assignment trigger.
- **M5 Post-fill 60-min distrust window** — spec doesn't say what value substitutes; assuming "full" overestimates on a partial fill. Specify the conservative substitute.
- **M6 Team/multi-driver HOS** — two drivers ≈ double drive time; using one clock is over-conservative or (wrong driver) illegal. Detect team assignments.
- **M7 Cross-border Canada** — only the CA state line is handled; a Canada route hits no Pilot coverage + L/CAD + taxes. Scope out explicitly or handle.
- **M8 Time zones** — break due-points, HOS windows, RFC3339 route windows, "daily" email timing are TZ-sensitive. Standardize UTC internally; test a TZ-spanning route.
- **M9 Layered percentages** — usable 95%, reserve "20% of usable," sensor ±5–10%: write the exact gallons-on-hand + reserve formula and confirm the sensor margin *reduces* the estimate.
- **M10 DEF not planned** — `product=def` exists in schema but the algorithm ignores DEF; running out limp-modes the truck. Plan DEF or state clearly it's the driver's responsibility.

---

## 4. Assumptions register (explicit — each must hold or be handled)

1. The fleet **creates Samsara routes** with meaningful destinations. *(Unproven — §0.)*
2. Trucks report **`fuelPercents`** with usable coverage/accuracy (varies by make; Hino/Isuzu etc. may not). *(Per-truck audit needed.)*
3. `vehicles.tank_capacity_gal` is **accurate and represents usable** capacity per truck.
4. **`baseline_mpg`** is representative; a safety factor covers variance. *(C3 — weakest assumption.)*
5. Drivers run **Samsara ELD** so HOS clocks exist and are fresh. *(H4.)*
6. The **daily Pilot email** is machine-parseable, per-location, complete, and its price basis is known. *(H3/H8 — unconfirmed.)*
7. **OSM** station data is complete, correctly branded, and diesel-lane accurate. *(H6.)*
8. **HERE truck route ≈ Samsara's driven route** on fueling legs. *(H5 — holds on interstates, not always regionally.)*
9. Per-truck **vehicle dimensions/weight** exist for HERE (and for weight-legal fill caps, H2).
10. **One chain, one discount** adequately models cost. *(H3.)*
11. Fleet is **diesel tractors, US-only, single-driver** unless scoped otherwise. *(reefer/team/Canada/DEF gaps.)*

---

## 5. Decisions — RESOLVED 2026-07-08 (one item open)

1. **Reefer:** ✔ mixed reefer + dry van → model reefer/idle burn per trailer (C3/H10 addressed).
2. **Price basis:** ✔ daily email is **net**, flat discount → rank on net directly; EFS is QA only (H3 largely closed; keep discount model configurable for productization).
3. **Emergency sizing:** ✔ confirmed — safety-sized, 50 gal soft default (C1 fixed).
4. **Load weight:** ✔ 80,000 lb max → cap fills to ≤80k; conservative when live gross unknown (H2 addressed).
5. **Scope:** ✔ US + Canada (~99.9% US), **teams present**, **mostly hazmat**. → Team HOS required (M6); Canada as secondary mode incl. metric/CAD (M7); **hazmat is now a required HERE routing input** — a non-hazmat route diverges from the driver's actual restricted path, so this is a route-fidelity/safety item, not paperwork.
   - **STILL OPEN:** DEF — do we plan DEF stops or leave to the driver? (M10)

**New scope note (productization):** the fleet wants this sellable to other carriers. That converts every fleet-specific value into per-org config (networks, price sources, fuel cards, discount models, HOS rulesets, units/currency, telematics provider). Captured as plan §14. Design the seams now; implement only our adapters. Main added risk: multi-network/multi-provider adapters are real future work — don't let "productize" balloon the v1 build.

---

## 6. Revised trust / launch gates (what must be true before drivers rely on it)

**Data-quality gates** — per-truck `fuelPercents` coverage + empirical quantization audit; station registry cross-validated (OSM ∩ Pilot export ∩ daily email), closures pruned, `has_diesel` verified; price-email completeness check (row count) each morning; store-number match rate monitored.
**Engine-correctness gates** — solver never plans below reserve *including detour fuel* on adversarial inputs; HOS uses min-of-clocks + conservative speed and never emits an unreachable/illegal stop; INFEASIBLE state fires loudly; golden routes include CA-long, fuel-desert, and multi-crossing cases; correct the "provably optimal" claim.
**Integration/measurement gates (now required, not optional)** — a **dry-run period** where plans are displayed but labeled advisory, during which we log predicted-vs-actual arrival fuel%, emergency-fill rate, near-reserve breaches, and station-passed-vs-suggested mismatch. Ship to drivers only when predicted arrival-fuel error and mismatch rate are within target. Kill switches: per-org flag, provider circuit breakers (HERE, email parse), and an alert on any near-reserve breach.
**Backtest before launch** — replay historical routes + EFS actuals; report what the plan *would* have suggested and whether any truck would have stranded. This is the number that earns trust.

---

## 7. Corrections already applied to `PLANNED-FUELING-PLAN.md`

- Emergency fill sizing made subordinate to safety (C1); added INFEASIBLE state (C2).
- California logic extended for long-CA / starts-in-CA / multi-crossing (C4).
- HOS changed to `min(drive, shift, cycle)` + break as segmenter + conservative speed (HOS correctness).
- Detour fuel folded into the reserve/range check (H1).
- Measurement/accuracy loop promoted from optional to a launch gate with named metrics (C5); optimality language corrected and adversarial tests added (C6).
- Reefer/idle burn, DEF, team, Canada, units, and price-granularity flagged as explicit open items/decisions.

Items requiring your input (§5) and the route dependency (§0) are left as decisions, not silently assumed.
