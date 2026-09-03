# Handoff — Finance fleet report, 2026-09-03

**Read this, then `FINANCE-FLEET-REPORT-PLAN.md`.** That plan is the queue; this file is where the
work stopped, what is proven, and the three traps that cost time in this session.

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
| **G1** fleet harness | **Pure half built.** Service, route and page owed | `fleetReport.ts` |
| **G5, G6, G7, G9, W1–W4** | Not started | — |

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
```

**Modified:** `mcleod/financialReads.ts` (+`readLedgerTotalsRange`, `readBilledMilesByDeliveryMonth`),
`samsara/samsaraIftaReads.ts` (+`readMonthlyMileageByMonth`), both module barrels,
`accounting/routes/index.ts` (+2 routes), `CpmReportPage.vue` (4th tab + coverage banner).

**No migration.** Nothing in this session touched the schema.

---

## 3. Next step, precisely — finish G1, then G5

The pure harness exists and is tested. What it needs is the service that feeds it and the page that
reads it.

### 3.1 `getFleetReport` — the service (owed)

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

### 3.2 G5 — the Overview tab

A fifth tab on `CpmReportPage.vue`: the six headline figures, the company/contractor/total table,
and the trend. The coverage banner is already above the tabs and needs no change.

### 3.3 Then, in order

**G9** (two denominators — most of it is already in `FleetReport`: `billedMiles`, `emptyMiles`,
`emptyPct`, `revenuePerBilledMile`) · **G6** (the ~10-family account map; needs one owner sitting) ·
**G7** (the removals — LAST, so nothing is deleted before its replacement is live) · then the
**W-series** for weekly.

---

## 4. Three traps this session hit — do not re-learn these

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

## 5. Measured facts worth not re-deriving

All from `supabase db query --linked` on 2026-09-03, checked against
`~/Downloads/PROFIT LOSS JULY 2026.pdf`.

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

## 6. Two things owed to the owner, unrelated to code

1. **July's tolls are $184.40** against $364,180 year to date (~$52k/month elsewhere). Reclassified,
   netted through driver deductions, or not yet entered — the accountants have to say which.
2. **The printed July balance sheet does not foot** by **$365,742.64** (assets 19,387,472.49 vs
   liabilities and equity 19,021,729.85). Every subtotal adds and net income agrees with retained
   earnings, so the gap is inside McLeod.

---

## 7. Running it

```
pnpm typecheck && pnpm lint                      # both green at d8db4b2
pnpm --filter @silvicom/shared exec vitest run   # 174 files, 2,459 tests
pnpm --filter @silvicom/api    exec vitest run   # 247 files, 2,813 tests
pnpm --filter @silvicom/web    exec vitest run   # 128 files, 1,181 tests
pnpm --filter web lint:tokens                    # after ANY template change
pnpm lint:ui-adoption                            # catches a raw <button> in pages/features
```

To see the pages: `pnpm --filter @silvicom/web preview:local` (`pnpm dev` crashes on this machine
inside vite's dependency optimiser — environmental, not a regression).
