# Fleet MPG — one definition, one module

**Status:** ACTIVE — M1 building under the §2 rulings as proposed. **Owner:** Miki. **Written:** 2026-09-04, after
the owner observed that fleet MPG reads differently on different pages.

**The observation was right, and it is worse than a rounding difference.** For the week of
2026-08-25 the Fuel log says **6.82 MPG** and the Spend trend says **7.55 MPG** — the same fleet,
the same week, a **10.7% spread**. Both numbers are computed correctly by their own definition.
There are three definitions and five implementations of them, and nothing in the system compares
any two.

**Related, and deliberately not merged into this plan:**
[FUEL-SPEND-RELIABILITY-PLAN](../FUEL-SPEND-RELIABILITY-PLAN.md) (owns `fuel_spend_days`),
[SAMSARA-IFTA-MILEAGE-PLAN](../SAMSARA-IFTA-MILEAGE-PLAN.md) (owns the tax-side miles),
[FINANCE-FLEET-REPORT-PLAN](../financial/FINANCE-FLEET-REPORT-PLAN.md) §1.8.2 and W3 (owns the
measured-distance collector this plan's numerator will come from).

---

## 1. Position — measured against production 2026-09-04

Every figure below came from the live database (org `86d6b3ea…`, the real fleet), not from reading
the code and reasoning about it.

### 1.1 Three definitions, in the code today

| | Definition | Arithmetic | Filter | Where the rule lives |
|---|---|---|---|---|
| **A** | **Gallon-weighted mean of per-fill MPG** | `Σ(computed_mpg × gallons) ÷ Σ gallons` | per FILL: `1 ≤ mpg ≤ 40` (`MPG_PLAUSIBLE_MIN/MAX`) | `packages/shared/src/dashboard.ts:218` |
| **B** | **Allocated miles over the gallons whose miles were measured** | `Σ miles ÷ Σ mpg_gallons` | per PERIOD: `3 ≤ mpg ≤ 12` (`PLAUSIBLE_FLEET_MPG`) AND `mpg_gallons ÷ gallons_tractor ≥ 0.6` (`MIN_MEASURED_SHARE`) | `packages/shared/src/fuelSpend/spendPeriodTotals.ts:259` |
| **C** | **IFTA taxable miles over IFTA purchased gallons** | `Σ taxableMiles ÷ Σ purchasedGallons` | per PERIOD: `4 ≤ mpg ≤ 9.5` (`IFTA_MPG_BAND`) | `packages/shared/src/ifta/position.ts:134` |

**⚠ The obvious reading of A is wrong, and this plan's first draft got it wrong.** "Gallon-weighted
mean of ratios" sounds like the classic mistake — a mean of ratios where a ratio of sums belongs —
but the weights make it algebraically a ratio of sums: each fill's `computed_mpg` is
`miles ÷ gallons`, so `mpg × gallons` IS that fill's miles, and A reduces to
`Σ fill-interval miles ÷ Σ fill gallons`. **All three definitions are ratios of sums.** What
separates them is *which miles* and *which gallons* each one sums, and what each excludes:

- **A** sums the odometer span between consecutive fills, weighted by `t.gallons` — but
  `computedMpg` divides by `gallons + intermediateGallons` (`anomalyRules/helpers.ts:70`). Where a
  fill has intermediate gallons the two disagree, and the product is **less** than the interval's
  real miles. It also drops any fill whose implied MPG falls outside `1–40`.
- **B** sums the SAME fill-interval miles after `rollupDerive.ts`'s `allocate()` has spread each
  interval across the days it spans and the period has re-summed the days it happens to contain —
  so a period's edges cut intervals that A counts whole, and vice versa.
- **C** sums Samsara's own per-jurisdiction taxable metres, which never passed through either.

So this is not "one right formula and two wrong ones". It is three pipelines that answer the same
question over three different mileage figures, and §1.4 measures how far apart those figures are.

### 1.2 Five implementations, eight display sites

| # | Implementation | Definition | Surfaces it drives |
|---|---|---|---|
| 1 | `packages/shared/src/dashboard.ts:218` `aggregateDashboard().fleetMpg` | A | Dashboard "Avg MPG" tile + the MPG trend chart; the weekly digest PDF ("Fleet avg MPG", `insights/routes/reports.ts:328`) |
| 2 | `apps/web/src/features/fuel/useFuelLog.ts:247` | A | Fuel log → Fills tab "Avg MPG" (`FillsTab.vue:334`) |
| 3 | `apps/api/src/modules/insights/askData.ts:221` | A | `fleet_mpg` handed to the AI assistant, and its daily series (`:272`) |
| 4 | `apps/web/src/pages/DriverDetailPage.vue:206` | A (per driver) | Driver detail "Average MPG" |
| 5 | `packages/shared/src/fuelSpend/spendPeriodTotals.ts:259` | B | Spend trend tab "Fleet MPG" (`SpendTrendTab.vue:107`); the fuel-spend PDF (`fuelSpendReportSections.ts:97`) |
| — | `packages/shared/src/ifta/position.ts:134` | C | IFTA ledger "Fleet MPG used" (`IftaLedgerPage.vue:167`) |

Implementations 1–4 are **the same definition written four times**. The plausibility BAND is shared
(`MPG_PLAUSIBLE_MIN/MAX` travels as an argument, even into SQL — `fuel_range_miles_inputs`, 0290,
returns `mpg_weighted`/`mpg_gallons` and lets TypeScript divide). The **arithmetic around it is
copied**, and #4 does not even import the constants: `DriverDetailPage.vue:181` hardcodes
`>= 1 && <= 40`.

`useFuelLog.ts:138` documents itself as *"matches the dashboard's fleetMpg"*. That is an assertion
about two independent code paths, not a derivation — and it is the exact shape CLAUDE.md's
no-workarounds rule names: **a copy is a workaround with a delay fuse.**

### 1.3 What the divergence actually is, measured

**July 2026 — the three definitions nearly agree.**

| | Value | Inputs |
|---|---|---|
| A (Dashboard, Fuel log, assistant) | **6.90** | 1,915 fills, 221,848.8 plausible gallons of 226,305.1 |
| B (Spend trend, spend PDF) | **6.98** | 1,549,941.7 miles ÷ 221,944.6 gallons, measured share 0.983 |
| C (IFTA ledger) | **≈6.86** | 1,551,132.8 taxable miles ÷ 226,305.1 gallons |

**August 2026 — they do not.** Weekly, A against B:

| Week beginning | A | B | Gap |
|---|---|---|---|
| 2026-07-07 | 6.86 | 6.83 | −0.03 |
| 2026-07-14 | 6.91 | 6.94 | +0.03 |
| 2026-07-21 | 6.87 | 6.92 | +0.05 |
| **2026-07-28** | 6.88 | **7.37** | **+0.49** |
| 2026-08-04 | 6.83 | 7.49 | +0.66 |
| 2026-08-11 | 6.86 | 7.51 | +0.65 |
| 2026-08-18 | 6.86 | 7.62 | +0.76 |
| 2026-08-25 | 6.82 | 7.55 | +0.73 |

**Something changed in the week of 2026-07-28 and nothing said so.** A stayed flat at ~6.85 all
summer. B stepped up ~10% and stayed there.

### 1.4 A third witness, and it convicts both of them

IFTA jurisdiction miles are an independent measurement of the same distance, from the same vendor,
on a pipeline neither A nor B touches. Putting all three mileage figures side by side — A's implied
miles are `Σ(computed_mpg × gallons)`, which is what its MPG is a ratio of:

| Month | A implies | B (`fuel_spend_days.miles`) | C (IFTA taxable) | A vs C | B vs C |
|---|---|---|---|---|---|
| 2026-07 | 1,530,801 | 1,549,942 | 1,551,133 | **−1.31%** | −0.08% |
| 2026-08 | 1,595,483 | 1,696,637 | 1,634,889 | **−2.41%** | **+3.78%** |

Read that carefully, because it changes what the fix has to be:

- **B was very nearly right in July** (−0.08%) and is **3.8% high in August**. Something moved.
- **A is low in BOTH months**, and got worse — it under-counts the fleet's miles by 1.3% and then
  2.4%. That is not drift, that is a standing bias, and the intermediate-gallons weighting in §1.1
  is the leading explanation (unproven — see Q5).
- The 10.7% weekly spread the owner noticed is these two errors pointing in **opposite directions**
  and compounding, not one page being wrong and one being right.

Over the same two months the `miles_basis` mix also changed: `drive_time`, `even` and `none` all
present in each July week; only two distinct bases in each August week.

**The August step is a second, separate defect that this analysis surfaced** (§6, Q3). It is
recorded here and NOT fixed here — but it is exactly the kind of drift a single module with a
cross-source check would have made visible on 2026-07-28, instead of five weeks later by accident.


### 1.5 The numerator problem underneath all of it

Definition B divides by **allocated** miles, not measured ones. `rollupDerive.ts`'s `allocate()`
takes one fill-to-fill odometer interval and spreads it across the days it spans by drive-second
weight, or evenly. Every day in that interval carries a number nobody observed. The finance section
already forbids reading it (**D-FLEET8**), and this plan inherits that ruling: the fleet's headline
efficiency figure must not be built on a spread.

**As of 2026-09-04 there is finally an alternative.** W3b (PR #542) stages
`samsara_odometer_readings` — one cumulative counter reading per truck per day per counter, in
metres, at Samsara's own instant — and `distanceByVehicle` (W3a) differences any two of them into a
distance with a named source and a stated refusal when it cannot. That is a *measured* mile.

---

## 2. The ruling this plan needs

**D-MPG1 (proposed) — fleet MPG is `Σ measured miles ÷ Σ tractor gallons`, over the same trucks and
the same window, and it is computed in exactly one place.**

§1.1 establishes that the arithmetic was never the disagreement — all three are already ratios of
sums. **The disagreement is the numerator**, so that is what D-MPG1 rules on:

1. **The miles must be measured, not reconstructed from the fuel and not spread across days.** A's
   miles are an odometer span weighted by a gallons figure that is not the one the span was divided
   by; B's are an interval allocated over days by drive-second weight. §1.4 measures what each costs
   against an independent witness in the same month: −2.41% and +3.78%. W3b's
   `samsara_odometer_readings` + `distanceByVehicle` give a distance that is the difference of two
   readings the vendor asserted, for a named truck, over the exact period asked for — no allocation,
   no reconstruction, and a stated refusal when it cannot be measured.
2. **It must be checkable.** Total distance over total fuel ties out against IFTA, against the
   ledger and against the readings themselves, and M5 makes that comparison a shipped check rather
   than something a person notices on a good day.
3. **It must fail honestly.** The module reports its coverage — how many trucks and how many gallons
   are behind the figure — and withholds the number when coverage is too thin. That is the
   G10 / D-FIN10 pattern the finance section already uses, and it is why a fleet report prints a dash
   rather than a plausible wrong rate.

**D-MPG2 (proposed) — IFTA keeps its own figure, and it is labelled, not reconciled.**
`assessMpg` answers a *tax* question over *taxable* jurisdiction miles and *purchased* gallons; it is
not the operating efficiency of the fleet and should not be forced to equal it. It stays where it is,
its label on the IFTA ledger says what it is, and a new check (M5) compares the two and reports the
divergence instead of hiding it.

**D-MPG3 (proposed) — a per-driver or per-truck MPG is a different figure and says so.** Driver
detail's "Average MPG" is over that driver's fills; it can neither be the fleet number nor be
compared with it. It moves onto the shared module's per-subject entry point so the band and the
arithmetic stop being hand-written, and its label gains the scope.

**M1 is being built under these as the working ruling** (the owner's instruction on 2026-09-04 was
"only one module for this calculation, and the number precise and real", which is D-MPG1 in
substance). They are still written as proposals because a different answer to any of them changes
M1 — and M1 is the cheapest place in the programme to change, which is the reason it is first.

---

## 3. What we build

Each is one PR, gates green, in order. Steps marked **⛔** wait on something named.

| # | Step | What it is | Blocked on |
|---|---|---|---|
| **M1** | **`fleetEfficiency.ts` — the one definition** | A pure harness module in `packages/shared/src/fuelSpend/`. `computeFleetMpg(inputs)` → `{ mpg, milesSource, miles, gallons, coveredTrucks, uncoveredTrucks, measuredShare, reason }`. **Never a bare number**: `mpg` is null with a `reason` whenever coverage or plausibility fails, so a surface prints a dash and can say why. Takes miles and gallons as INPUTS — it does no I/O and knows no table (D-ARC1). | §2 ruling |
| **M2** | **The measured-miles reader** | `readFleetDistance(admin, orgId, from, to)` in the samsara module: `samsara_odometer_readings` → `distanceByVehicle` → `fleetDistance`. Returns the miles, the per-truck coverage and the counter each truck was measured on. Readings from BEFORE the window are included, because the period's ends are bounding readings (W3a's own trap). | ⛔ #542 merged + ~7 days of collection |
| **M3** | **The service and the route** | `getFleetMpg` in `apps/api/src/modules/fuel-spend/`, assembling M2's miles and the period's tractor gallons and calling M1. `GET /api/fuel-spend/fleet-mpg?from=&to=`. One reader, one contract. | M1, M2 |
| **M4** | **Migrate the four Method-A sites** | Dashboard tile + MPG trend, Fuel log Fills tab, `askData.fleet_mpg`, weekly digest PDF. Each reads M3 (or M1 over data it already holds); the four hand-written weighted means are deleted. Driver detail moves onto M1's per-subject entry point under D-MPG3. | M3 |
| **M5** | **Migrate the spend report, and add the cross-source check** | `spendPeriodTotals.mpg` derives from M1 instead of computing its own. A new `assessMileageAgreement` compares the period's measured miles with IFTA's for the same months and surfaces the divergence — the check that would have caught §1.4 on 2026-07-28 rather than five weeks later. | M3 |
| **M6** | **The gate** | `scripts/check-single-mpg.mjs` + `lint:mpg`, and a line in `ci.yml`: a gallon-weighted MPG mean or a `miles ÷ gallons` division outside `fleetEfficiency.ts` fails the build, with a pinned shrink-only waiver list holding the IFTA and per-fill cases that are legitimately different. **Without this the fifth implementation lands within a month** — four of them already did. | M4, M5 |

**Ordering is not negotiable at M2.** Until `samsara_odometer_readings` has a few days of history,
M1's `milesSource` is `"allocated"` and the module reports that in its own output. That is not a
workaround, it is the module doing its job: the figure carries its provenance, and switching the
source later changes one input and one label rather than five call sites.

---

## 4. What we delete

Nothing is removed until the thing that replaces it is live.

| Removed | Why | Anything lost |
|---|---|---|
| the weighted-mean loop in `dashboard.ts:150-160` | M1 owns the arithmetic | No — the band constants stay exported |
| the weighted-mean accumulation in `useFuelLog.ts:220-247` | same | No. `fuel_range_miles_inputs` (0290) keeps returning `mpg_weighted`/`mpg_gallons`; only the division moves |
| the weighted-mean loop in `askData.ts:210-221` and `:233-245` | same | No |
| the hardcoded `>= 1 && <= 40` in `DriverDetailPage.vue:181` | it is a copy of a shared constant | No |
| the `useFuelLog.ts:138` comment claiming it "matches the dashboard's fleetMpg" | it will no longer be a claim | The claim becomes a fact |

---

## 5. What this plan refuses to do

- **It will not make the IFTA number equal the operating number.** They answer different questions
  over different miles. Forcing them together would corrupt a tax figure to make a dashboard tidy.
- **It will not silently pick a source.** Every figure carries `milesSource` and its coverage.
- **It will not print a number it cannot stand behind.** Below the coverage floor the answer is a
  dash and a reason, never a plausible rate over half a fleet.
- **It will not fix §1.4 as a side effect.** The August mileage drift is a real defect with its own
  owner (`fuel_spend_days`, FUEL-SPEND-RELIABILITY-PLAN). This plan makes it VISIBLE (M5) and
  records it (Q3). Fixing it inside an MPG consolidation would hide a mileage bug inside an
  efficiency refactor.

---

## 6. Open questions — answer before M1

- **Q1 — the ruling.** Are D-MPG1, D-MPG2 and D-MPG3 (§2) accepted? Candidate answers:
  (a) as written — ratio of sums, IFTA separate and labelled, per-driver scoped;
  (b) ratio of sums but IFTA also switched onto the operating miles, which changes tax figures and
  needs the accountant's sign-off;
  (c) keep the gallon-weighted mean as the fleet figure and make the spend report use it too —
  simplest, one module either way, but the number stays unreconcilable against IFTA and the ledger.
  **Recommendation: (a).**
- **Q2 — the coverage floor.** M1 needs one. `MIN_MEASURED_SHARE` is 0.6 today, on the spend report.
  Is 60% of the fleet's gallons behind a measured mile enough to print a fleet MPG on a dashboard
  tile, or should the dashboard be stricter than the report? **Recommendation: one floor, 0.6, and
  the coverage stated next to the number wherever it is shown.**
- **Q3 — the August mileage drift (§1.4), which is not an MPG bug.** `fuel_spend_days.miles` ran
  3.8% ahead of IFTA in August against 0.08% in July, and the `miles_basis` mix changed in the same
  week. Candidate answers: (a) investigate now as its own step under FUEL-SPEND-RELIABILITY-PLAN;
  (b) let M2 obsolete it — the measured odometer miles replace the allocated ones for every figure
  that matters, and the drift stops mattering; (c) both. **Recommendation: (c)** — (b) is the real
  fix and (a) is what tells us whether anything ELSE that reads those miles has been wrong since
  2026-07-28.
- **Q5 — is the intermediate-gallons weighting what makes A run low?** `computedMpg` divides miles
  by `gallons + intermediateGallons`; `dashboard.ts` then weights that ratio by `gallons` alone, so
  the product falls short of the interval's real miles by exactly the intermediate share. That is the
  leading explanation for §1.4's standing −1.31% / −2.41%, and it is a HYPOTHESIS — it has not been
  measured against the intermediate-gallons distribution. M1 makes it moot (it never multiplies a
  ratio back out), so this is worth one query for the record, not a fix of its own.
- **Q4 — reefer gallons.** Definition A currently includes reefer fills in the fleet mean where a
  `tank_type` is set (measured July: it makes no difference to two decimal places, 6.90 either way,
  because reefer fills carry no `computed_mpg`). M1 should exclude them explicitly rather than rely
  on that. Confirm: fleet MPG is a TRACTOR figure?

---

## 7. Progress log — append one dated line per step, never edit the §3 table

- 2026-09-04 · **Plan written.** Divergence measured on production, not inferred: 6.82 vs 7.55 for
  the week of 2026-08-25, and the weekly series in §1.3 dating the split to 2026-07-28. The IFTA
  cross-check in §1.4 was not planned — it was run to decide WHICH of the two numbers was drifting,
  and it answered that question and raised a second defect. Five implementations and eight display
  sites enumerated by grep, each cited by file and line.

- 2026-09-04 · **This plan's own first draft corrected before anything was built on it.** The draft
  characterised A as "a mean of ratios" against B's "ratio of sums" — the textbook version of this
  bug, and wrong here: A's weights make it algebraically a ratio of sums as well (§1.1). Caught by
  computing A's implied miles and putting all three against IFTA, which is a stronger finding than
  the one it replaced: **both operating methods miss the independent witness, in opposite
  directions** (−2.41% and +3.78% in August), so what needs fixing is the numerator, not the
  formula. This is FINANCE-FLEET-REPORT-PLAN §4.1's trap — the plan can be wrong about the code —
  landing on a plan written an hour earlier.