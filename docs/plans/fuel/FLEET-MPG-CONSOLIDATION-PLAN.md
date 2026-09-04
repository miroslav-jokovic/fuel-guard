# Fleet MPG — one definition, one module

**Status:** ACTIVE. **Rulings made 2026-09-04** — the owner delegated them explicitly ("make
rulings on this so we get precision and reliability and enterprise grade best solutions"), so §2 is
decided, not proposed. **Owner:** Miki.
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

## 2. The rulings

Made 2026-09-04 on the owner's explicit delegation. The brief was *precision, reliability,
enterprise-grade*, and each ruling below is justified against that brief rather than against
convenience. Where a ruling costs something, the cost is named.

### D-MPG1 — fleet MPG is `Σ miles ÷ Σ gallons that have a mile behind them`, computed in exactly one place

§1.1 establishes that the arithmetic was never the disagreement — all three definitions are already
ratios of sums. **The disagreement is the numerator**, so that is what this rules on:

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
3. **It must fail honestly.** The module reports its coverage and withholds the number when coverage
   is too thin. That is the G10 / D-FIN10 pattern the finance section already uses, and it is why a
   fleet report prints a dash rather than a plausible wrong rate.
4. **No surface computes an MPG.** Not a style preference — it is the only form of this ruling that
   survives contact with the next feature. Four implementations of one definition already landed
   without anyone being asked, so M6's gate is part of the ruling and not an optional tidy-up.

### D-MPG2 — IFTA keeps its own figure; it is labelled and compared, never reconciled

`assessMpg` answers a *tax* question over *taxable* jurisdiction miles and *purchased* gallons. It is
not the fleet's operating efficiency and must not be bent into agreeing with it — forcing a tax
figure to match a dashboard is how a filing becomes wrong. It stays where it is, the IFTA ledger's
label says what it is, and M5's `assessMileageAgreement` compares the two and **reports** the
divergence. Comparison is the reliability mechanism; reconciliation would destroy the very
independence that makes the comparison worth anything.

### D-MPG3 — a per-driver or per-truck MPG is a different figure and says so

Driver detail's "Average MPG" is over that driver's fills. It can neither be the fleet number nor be
compared with it, and a shared label inviting that comparison is itself the defect. It moves onto the
same arithmetic — so the band and the division stop being hand-written — and its label gains the
scope.

### D-MPG4 — ONE coverage floor fleet-wide, `MIN_MEASURED_SHARE = 0.6`, and the coverage is shown wherever the number is

The tempting answer is a stricter bar on a dashboard tile than in a report. It is wrong, and it is
wrong in this programme's own terms: two floors mean the same period can show a dash on one page and
a figure on another, which is a NEW instance of exactly the defect being removed. One number, one
floor, everywhere.

0.6 is kept rather than raised because it is what `spendPeriodTotals` has enforced since migration
0244 and raising it would silently withhold figures the spend report shows today — a product change
smuggled inside a refactor. **The cost of keeping it is named:** a 62%-covered period and a
99%-covered period both print a number, and only the displayed `measuredShare` distinguishes them.
That is why displaying it is part of the ruling and not a nicety. Once M2 lands and coverage is
measured near 99%, raising the floor becomes a deliberate one-line change with evidence behind it
(follow-up, not a silent deferral).

`truckCoverage` is reported and deliberately **not** gated on: a fleet where 40% of the trucks are
new and barely fuelled is not the same failure as one where 40% of the fuel is unaccounted for, and
one threshold that cannot tell them apart would withhold good figures and pass bad ones.

### D-MPG5 — fleet MPG is a TRACTOR figure, and reefer and DEF are excluded explicitly

Measured 2026-07: 58 reefer fills, 1,259 gallons, and **every one of them carries a null
`computed_mpg`** — so today they fall out of definition A by accident and the fleet number is the
same to two decimal places either way. That is precisely the argument for making it explicit. A
figure that is right by coincidence is one scoring change away from being wrong silently, and
"reefer fuel moved the truck" is not a claim anybody would defend if asked. M3 filters on
`tank_type` rather than relying on the coincidence.

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

## 6. Questions — all five answered 2026-09-04

Kept in full rather than deleted: a plan that shows only its conclusions cannot be argued with, and
three of these are worth re-opening if the evidence changes.

- **Q1 — the definition.** **ANSWERED: (a), as D-MPG1/2/3.** Ratio of sums over measured miles, IFTA
  separate and labelled, per-subject figures scoped. (c) — keeping the gallon-weighted mean and
  making the spend report use it too — was the cheapest option and is rejected on the brief: §1.4
  shows that numerator running 1.31% then 2.41% below an independent witness, so standardising on it
  would have made every page consistently wrong instead of inconsistently wrong. That is worse, not
  better, because it removes the only signal anybody had.
- **Q2 — the coverage floor.** **ANSWERED: one floor, 0.6, coverage always displayed (D-MPG4).**
  Re-open when M2 has measured real coverage; raising it is then evidence-backed rather than a guess.
- **Q3 — the August mileage drift.** **ANSWERED: (c), both.** M5 ships the cross-source check, which
  is what makes drift visible the week it starts. Separately, the defect is filed against
  `fuel_spend_days` in its own plan, because **the drift is not confined to MPG** — the spend report
  prints those miles as miles, and anything else reading them has been 3.8% high since 2026-07-28.
  M2 obsoletes them for MPG; it does not obsolete them for everything.
- **Q4 — reefer gallons.** **ANSWERED: excluded explicitly (D-MPG5).**
- **Q5 — is the intermediate-gallons weighting what makes A run low?** **ANSWERED: yes,
  structurally — confirmed by reading the path rather than by inference.**
  `persist.ts:144` stores `computed_mpg = computedMpg(txn, previousTxn, intermediateGallons)`, and
  `helpers.ts:70` computes that as `milesSinceLast ÷ (txn.gallons + intermediateGallons)`, where
  `intermediateGallons` is the fuel bought for the same truck BETWEEN the two odometer readings
  (`consumptionContext.ts:200`). Every surface then weights that ratio by `txn.gallons` alone, so the
  product is `miles × gallons ÷ (gallons + intermediate)` — always ≤ the interval's real miles, and
  short by exactly the intermediate share. The bias is therefore **structurally negative**, which is
  what §1.4 measures in aggregate (−1.31%, −2.41%). It is not separable per fill without re-running
  the scorer, and it does not need to be: M1 never multiplies a ratio back out.


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
- 2026-09-04 · **Rulings made, on the owner's explicit delegation.** D-MPG1–D-MPG5 in §2, and all
  five questions in §6 answered. Two are worth re-reading later because they cost something: the
  coverage floor stays at 0.6 rather than being raised, so a 62%-covered period and a 99%-covered one
  both print a number and only the displayed coverage separates them — raising it is a product change
  and does not belong inside a refactor. And Q3 is answered "both", because the August mileage drift
  is not an MPG bug: the spend report prints those same miles AS miles, so M2 obsoleting them for
  efficiency does not obsolete them for everything that reads them.

  Q5 closed by reading the path rather than inferring from the numbers: `persist.ts:144` →
  `helpers.ts:70` → `consumptionContext.ts:200` shows `computed_mpg` dividing by
  `gallons + intermediateGallons` while every surface weights by `gallons`, so the per-fill numerator
  is short by exactly the intermediate share and the bias is structurally negative — which is the
  mechanism behind §1.4's measured −1.31% / −2.41%.
- 2026-09-04 · **M1 — `fleetEfficiency.ts`, the one definition.** `computeFleetMpg(inputs)` takes the
  period's miles, their SOURCE, the period's tractor gallons and the gallons that have a mile behind
  them, and returns `{ mpg, milesSource, measuredShare, truckCoverage, trucksMeasured,
  trucksUnmeasured, reason }`. Pure, no I/O, no table.

  **Three things it encodes that no current surface does.** The provenance travels with the number,
  including when the number is withheld — `milesSource` is part of the answer, because miles spread
  across days by drive-second weight are not the same claim as two odometer readings the vendor
  asserted. The denominator is `gallonsWithMiles`, not `gallons`: dividing measured miles by the
  whole period's fuel understates MPG by exactly the unmeasured share, and a 90%-covered fleet would
  read 10% low, plausibly. And it refuses in four named ways — no fuel, no measured fuel, no
  distance, and below the coverage floor — rather than returning a zero that would enter a
  cost-per-mile as though it were a measurement.

  **`mileageDivergence` ships with it**, unused for now on purpose: it is the comparison M5 makes a
  shipped check, and its test pins the three figures from §1.4 so the numbers that motivated this
  plan cannot quietly stop being true.

  **`PLAUSIBLE_FLEET_MPG` and `MIN_MEASURED_SHARE` moved here** from `spendPeriodTotals.ts` and are
  re-exported from their old home, so no importer moved and no behaviour changed. That is what makes
  M5 a derivation rather than a second opinion: the thresholds now live beside the function that
  applies them.

  **Deliberately NOT built here:** an adapter that turns per-fill `computed_mpg` back into miles.
  That multiplication is the −1.31% / −2.41% bias §1.4 measured, and giving it a home in the shared
  module would bless the path the plan exists to retire. The four Method-A surfaces get their miles
  from M3 instead.

  Fourteen tests, seven mutants killed (divide by all gallons; coverage floor removed; plausibility
  band removed; a zero-distance period reporting a figure; the over-coverage clamp removed; truck
  coverage hard-zeroed; the divergence made unsigned).
- 2026-09-04 · **M2 — `readFleetDistance`, the measured-miles reader.** In the samsara module, over
  its own `samsara_odometer_readings` (D-SEP1): reads the readings, hands them to `distanceByVehicle`,
  returns per-truck distance plus the fleet total and the count it could not measure. It does no
  arithmetic on metres and it decides no period.

  **The lookback is the whole trick.** A period's distance is `odometer(end) − odometer(start)` where
  each end is the last reading AT OR BEFORE that instant, and the collector writes one reading per
  truck per day, late in the day — so the readings strictly INSIDE a Monday-to-Monday week run Monday
  evening to Sunday evening: six days of driving reported as seven, a 14% undercount no total
  contradicts. The reader therefore fetches from **30 days before** the window. Thirty rather than a
  handful because the failure is asymmetric: too short and a truck parked for a fortnight loses its
  opening odometer and drops out of the fleet total; too long costs rows, and rows are ~380 a day.

  **It does not invent a population.** A truck that staged no readings simply does not appear — the
  CALLER knows which trucks bought fuel, and returning a guessed roster from a reader would put a
  coverage decision in the wrong layer.

  **A test that proved nothing, caught by mutating it.** `supabaseRecorder` records filters and does
  not apply them, so with a flat-array fixture the mutation that deleted the lookback outright — the
  single correctness property of this file — left all ten assertions green. The fixture now honours
  the window the reader asked for, and that same mutant kills six of the ten. This is
  [[supabase-recorder-does-not-filter]] landing on the one file where it mattered most; the warning
  is now in the test's own header.

  Ten tests, six mutants killed (no lookback; lookback zeroed; upper bound dropped; org filter
  dropped; counter validation dropped; a reversed period accepted).
