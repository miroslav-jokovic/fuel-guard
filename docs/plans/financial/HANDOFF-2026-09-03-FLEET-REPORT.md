# Handoff — Finance fleet report, 2026-09-03

**Read this, then `FINANCE-FLEET-REPORT-PLAN.md`.** That plan is the queue; this file is where the
work stopped, what is proven, and the seven traps that cost time in this session.

**Branch:** `claude/finance-collectors-july-start` · **PR:** #527 (open) · **Base:** `main` at
`5617963`.

---

## 1. What this programme is now

The owner ruled twice, and the rulings shrank the work by more than half:

- **Finance is a FLEET report**, not a per-truck one. There is no precise per-truck cost source and
  there will not be one soon, so the report is precise about the whole fleet and detailed within it.
- **Money comes from McLeod's ledger, distance from Samsara, and nothing is allocated.** EFS keeps
  collecting in full for the Fuel section and Finance does not read it.

That deleted the fixed-cost schedule, FleetPal, the toll collector, jurisdictional allocation, the
overhead basis, the trailer cost object, and four of six owner rulings. It also moved the reporting
era from 2026-07-01 back to **2026-01-01**, because the July boundary existed only to avoid EFS's
2026-02-04 history edge.

**Two superseded plans stay in the tree as records, not queues:** `FINANCE-GO-LIVE-PLAN.md`
(D-FIN1–15, all shipped, all still true) and `TRUCK-COST-ATTRIBUTION-PLAN.md` (what per-truck cost
would have cost — which is what makes stopping defensible).

---

## 2. What is built, and what proves it

Every layer is mutation-tested. Nothing below was accepted because its tests passed; each was
accepted because a deliberate break made them fail.

| Step | State | Where |
|---|---|---|
| **G2** dispatcher rate per mile | **Was already built.** The plan was wrong about it — see §4.1 | `dispatcherEarnings.ts` |
| **G3** income statement | **Built** | `incomeStatement.ts` ×3 layers, `IncomeStatementTable.vue`, tab 4 on the CPM page |
| **G4** active-truck rule | **Built** | `mileageCoverage.ts` (shared + service) |
| **G10** mileage-coverage guard | **Built** with G4 — one measurement | same |
| **G1** fleet harness | **Built** — pure harness, service, route | `fleetReport.ts` ×2 layers |
| **G5** Overview tab | **Built** | `FleetOverview.vue`, first tab on the CPM page |
| **G9** two denominators + trend | **Built** — the denominators inside `FleetReport`, the twelve-month trend beside it | `fleetTrend.ts` ×2 layers, `FleetTrendChart.vue` |
| **G11** ledger-coverage guard | **Built** — not planned; a live defect found while measuring for G6 | `ledgerMonths.ts`, `ledgerPeriod.ts` |
| **G6, G7, W1–W4** | Not started | — |

**Files added this session**

```
packages/shared/src/tmsCost/incomeStatement.ts        + .test.ts   (12 tests)
packages/shared/src/tmsCost/mileageCoverage.ts        + .test.ts   (12 tests)
packages/shared/src/tmsCost/fleetReport.ts            + .test.ts   (15 tests)
apps/api/src/modules/financial/incomeStatement.ts     + .test.ts   ( 6 tests)
apps/api/src/modules/financial/mileageCoverage.ts     + .test.ts   ( 7 tests)
apps/web/src/features/accounting/useIncomeStatement.ts
apps/web/src/features/accounting/useMileageCoverage.ts
apps/web/src/features/accounting/IncomeStatementTable.vue + .test.ts (8 tests)
apps/api/src/modules/financial/ledgerPeriod.ts                    (shared by both services)
apps/api/src/modules/financial/fleetReport.ts         + .test.ts   ( 7 tests)
apps/web/src/features/accounting/useFleetReport.ts
apps/web/src/features/accounting/FleetOverview.vue    + .test.ts   ( 8 tests)
packages/shared/src/tmsCost/fleetTrend.ts             + .test.ts   (10 tests)
apps/api/src/modules/financial/fleetTrend.ts          + .test.ts   ( 7 tests)
apps/web/src/features/accounting/useFleetTrend.ts
apps/web/src/features/accounting/FleetTrendChart.vue  + .test.ts   ( 9 tests)
```

**Moved:** `chartTheme.ts` (+ its test) from `apps/web/src/features/dashboard/` to
`apps/web/src/lib/` — a feature may not import a sibling feature's internals (`lint:boundaries`)
and finance is the second feature to need the palette. Six importers and two lint scripts follow it.
Three tokens added, `--viz-money-earned/-spent/-kept`, validated as their own palette by
`check-chart-colors.mjs`; `tokens.generated.css` is regenerated and committed (`lint:codegen`).

**Modified:** `mcleod/financialReads.ts` (+`readLedgerTotalsRange`, `readBilledMilesByDeliveryMonth`),
`samsara/samsaraIftaReads.ts` (+`readMonthlyMileageByMonth`), both module barrels,
`accounting/routes/index.ts` (+4 routes), `CpmReportPage.vue` (Overview and Income statement tabs,
coverage banner, tab-scoped description and stat strip, the trend under the overview),
`chartTheme.ts` (`trendOptions` now serves a multi-line chart: omit `series` and the legend appears
and each point names its own dataset; `labelFormat` writes month labels).

**No migration.** Nothing in this session touched the schema.

---

## 3. Next step, precisely

The pure harness exists and is tested. What it needs is the service that feeds it and the page that
reads it.

### 3.1 `getFleetReport` — **BUILT**. Kept below as the map of what feeds the harness.

`apps/api/src/modules/financial/fleetReport.ts`. It assembles `FleetReportInputs` and calls
`computeFleetReport`. Every reader it needs already exists:

| Input | Reader | Note |
|---|---|---|
| `ledger` | `readLedgerTotalsRange` + `readGlAccounts` | same as `getIncomeStatement` — factor the month-widening out of it rather than copying |
| `mileage` | `getMileageCoverage` | returns `months`, `miles`, `trucks`, `reason` already shaped for the input |
| `billedMiles` | `getMileageCoverage` | on the same result |
| `settlements` | `readSettlementsWindow` | needs `payee_type`, `tractor_unit`, `order_external_id`, `total_pay` — all selected |
| `bills` | `readBillingWindow` | `revenue` = `total_charges + other_charge`, **excise tax excluded** |
| `deductions` | `readOwnerOperatorDeductions` | must carry the account `type_id`; join `mcleod_gl_accounts` on `glid` |
| `milesByUnit` | `readVehicleMonthlyMiles` + `vehicles.unit_number` | optional; without it contractors show a dash |

Then `GET /api/accounting/fleet-report?from=&to=` beside the two routes added this session, same
`canView` gate.

### 3.2 G5 — the Overview tab — **BUILT**, and G9's trend with it

`FleetOverview.vue` leads the tabs; `FleetTrendChart.vue` sits under it. The trend is its own
endpoint (`GET /api/accounting/fleet-trend?to=&months=`) because the two cover different windows —
the report reads the picked period plus its fiscal year to date, the trend a fixed span of whole
months ending at it. One widened `readLedgerTotalsRange` bucketed by `period_start`, plus
`getMileageCoverage` for the per-month rows.

### 3.3 Then, in order

**G6** (the ~10-family account map; needs one owner sitting) · **G7** (the
removals **and the page rename** — the nav still says "Cost per mile" for a page that opens on an
overview and carries an income statement; the route name, `route.meta.title`, the nav entry, the
gate ledger and the section matrix all move together) · then the **W-series** for weekly.

### 3.4 How to see it before you trust it

`preview:local` only serves `/__design-system` without a login. For a real page, build with the
auth bypass and mock the API at the network:

```
cd apps/web && VITE_DEV_BYPASS=true npx vite build --mode development && npx vite preview --port 4173
```

then drive it with Playwright `page.route("**/api/accounting/fleet-report*", …)`. Mock the WHOLE
response shape — a partial one crashes the render, because nothing stands between a malformed
payload and the component. **A catch-all `page.route("**/api/**", …)` returning `{ ok: true, data:
null }` is exactly such a partial payload and takes the whole page to the error boundary**; leave
the unmocked calls to fail on their own, which the pages handle. There is no `playwright` package
in this workspace — import `playwright-core`, and by absolute path if the script lives outside the
repo. Four states have been checked this way: July's figures, a February-shaped response where
every rate is a dash, seven trend months with January and February as holes in the line, and a
February-only span where there is no line at all.

---

## 4. Seven traps this session hit — do not re-learn these

### 4.1 The plan can be wrong about the code. Verify before you "fix".

The plan said the dispatcher rate reads the all-null `billing_loaded_distance` and printed a dash
for every dispatcher. **It does not.** Migration 0275 added plain `distance` for exactly that
purpose and every layer uses it — verified end to end against production July: 1,415 bills, 1,383
with a distance, 1,326,922 billed miles, $3.76 per mile fleet-wide. Half an hour went into
confirming there was nothing to build. §1.7 of the plan carries the correction. **A plan claim about
existing code is a hypothesis; check it against the code and the data before writing any.**

### 4.2 `supabaseRecorder` records filters. It does not apply them.

A flat-array fixture answers a query about April with March's rows, so a coverage assertion passes
for entirely the wrong reason. Pass a **function fixture** and filter inside it on
`q.filters()` / `q.ops` — which is also strictly stronger, because a service that forgets
`.eq("period_month", …)` then gets every month and fails. `mileageCoverage.test.ts` is the worked
example.

### 4.3 A fixture too uniform to discriminate is not a test.

Attributing contractor revenue **by truck** instead of **by order** is a real and serious bug, and
the first mutation pass could not detect it: every fixture order mapped one-to-one onto a
contractor truck, so both readings gave the same number and all fifteen tests passed. Four of eight
contractor tractors at this carrier are MIXED — the same truck runs for a contractor and for a
company driver — and adding one such truck to the fixture killed the mutant four times over.
**Mutate every rule you write. A surviving mutant is a defect in the fixture, not a spare test.**

---

### 4.4 Two "earned per mile" figures on one screen is worse than one wrong one.

The per-truck harness shares overhead out across trucks; the fleet report shares nothing. Both
legitimately produce a figure called "earned per mile" and they will never agree. The old stat
strip is therefore hidden on Overview and Income statement, and the page description follows the
tab. G7 removes the allocation apparatus and ends the problem; until then, **never put a harness
figure and a ledger figure under one label.**

### 4.5 A mutant that changes no output still names a defect.

Two of the trend's eighteen mutants survived their first pass: a ledger read with no upper bound,
and the coverage read given the exclusive month bound. Both fetch months that are never plotted, so
nothing about the RETURNED figures can see them. They died once the test asserted the QUERY the
service issued — the `period_start` bounds, and the three Samsara month reads. **When a mutant
survives, ask whether the assertion is about the answer where it should be about the question.**

### 4.6 A plain `{ value }` object is truthy in a Vue template.

Mocking a query hook with `{ data: { value: … }, isLoading: { value: false } }` makes
`v-else-if="isLoading"` permanently TRUE, so the component renders its loading branch and every
assertion passes or fails for a reason that has nothing to do with the component. Build real refs
inside the `vi.mock` factory (`await vi.importActual("vue")`); `FleetTrendChart.test.ts` is the
worked example.

### 4.7 "Has rows" is not "has the month".

The McLeod financial sweep is run by hand behind the VPN, so it can land mid-month — 2026-08-28 for
August, which staged $8,430 of expense and no revenue. The finance page opens on the last full
calendar month, so on 2026-09-03 it opened on exactly that and reported it as August. **Every
month-grained figure in this section must ask when its month was swept**, not whether rows exist:
`period_end` against `swept_at`, oldest sweep wins, strictly after (G11, `ledgerMonths.ts`). The
same shape of question as G4's mileage coverage, and it went unasked for a month.

---

## 5. Measured facts worth not re-deriving

All from `supabase db query --linked` on 2026-09-03, checked against
`~/Downloads/PROFIT LOSS JULY 2026.pdf`.

- **A ninth ledger month exists and is not a month.** 2026-08 holds eleven lines, $8,430.00 of
  expense and no revenue, swept 2026-08-28 21:02 UTC — before the month ended. Every other month
  (2025-12 through 2026-07) was swept by the same run, long after each had closed. **The sweep has
  not run since 2026-08-28**, so August needs a re-run before it can be reported (§6).
- **The staged ledger reproduces the printed statement to the cent**, month and fiscal year to date:
  July 4,828,189.24 / 4,058,143.38 / 770,045.86; YTD 28,687,090.14 / 25,126,042.28 / 3,561,047.86.
- **Seven months of fleet cost per mile already exist**: Jan 2.10 earned vs 2.39 spent · Jul 3.11 vs
  2.61 · YTD 2.88 vs 2.52 over 9,956,348 miles.
- **Samsara coverage** — measured trucks vs trucks that delivered: Jan 130/139, Feb 135/151, Mar
  149/149, Apr 157/155, Jul 172/160. **January and February are short**; per-mile figures start in
  March. G10 enforces this as a computed rule, never a date.
- **McLeod holds no empty miles anywhere.** `fuel_distance` is 0.4% above loaded and is not it;
  stop-to-stop distance, `billing_empty_distance`, `pay_distance` and both manifest columns are
  never populated.
- **McLeod mileage is on a settlement clock** — median 4.3 days after delivery, 208 of July's 2,634
  settled movements delivered in June. Bill dates are later still. **Always re-date billing to
  `delivery_date`** when comparing against Samsara.
- **Owner-operator deductions classify themselves** by the account they post to. July: revenue
  34,384.28 · fuel/driver advances repaid 53,917.64 (**not income**) · pass-through 31,356.61 · cost
  recovery 11,064.71. Ties to the deduction total to the cent. No code table needed.
- **26.2% of July's expenses are 44 journal lines** averaging $24,210 (lease, insurance, payroll).
  This is why a weekly cost per mile needs D-FLEET10 rather than a smaller window.
- `gl_account.descr` is **truncated to 28 characters at source** — three revenue accounts read
  "Gross Trucking Income". Never key on it; always print the code.
- **Sorting by `type_id` then `glid` reproduces McLeod's printed line order exactly.**

---

## 6. Three things owed to the owner, unrelated to code

1. **The McLeod financial sweep needs re-running.** The last one was 2026-08-28, mid-August, so
   August cannot be reported at all until a run happens after month end (it is VPN-gated and
   manual). Every closed month before it is complete and unaffected.
2. **July's tolls are $184.40** against $364,180 year to date (~$52k/month elsewhere). Reclassified,
   netted through driver deductions, or not yet entered — the accountants have to say which.
3. **The printed July balance sheet does not foot** by **$365,742.64** (assets 19,387,472.49 vs
   liabilities and equity 19,021,729.85). Every subtotal adds and net income agrees with retained
   earnings, so the gap is inside McLeod.

---

## 7. Running it

```
pnpm typecheck && pnpm lint                      # both green
pnpm --filter @silvicom/shared exec vitest run   # 175 files, 2,469 tests
pnpm --filter @silvicom/api    exec vitest run   # 249 files, 2,827 tests
pnpm --filter @silvicom/web    exec vitest run   # 130 files, 1,198 tests
pnpm --filter web lint:tokens                    # after ANY template change
pnpm lint:ui-adoption                            # catches a raw <button> in pages/features
pnpm lint:chart-colors                           # after ANY --viz-* token or chart palette change
pnpm lint:codegen                                # a token change must COMMIT tokens.generated.css
```

To see the pages: §3.4. (`pnpm dev` crashes on this machine inside vite's dependency optimiser —
environmental, not a regression from any change.)

---

## 8. Position

**Built:** G2 (already was), G3, G4, G10, G1, G5, G9, G11. **Remaining:** G6, G7, W1–W4.

**G6 is measured but unsigned.** The 100 P&L accounts that posted in 2026 are pulled and drafted
into 14 families that tie to the ledger to the cent on both sides (§5 of the plan's progress log).
What it needs is one owner sitting on the dozen judgement calls — where contractor pay, recruiting,
financing fees and the jurisdictional accounts belong. Nothing about that map can be derived: McLeod
types `40790002 Tolls OO` as `Income Tax Expense` and truncates `descr` to 28 characters.
