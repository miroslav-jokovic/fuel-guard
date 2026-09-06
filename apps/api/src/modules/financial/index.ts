/**
 * financial — the canonical money store, built 2026-08-27 (program steps P3.4/P3.5,
 * docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md; FINANCIAL-STORE-PLAN is the build plan;
 * the module ARCHITECTURE.md §3 reserved at the re-founding). Owns `financial_entries`.
 *
 * Reads staging through the mcleod collector's exported readers (D-SEP1 — never the raw tables
 * directly) and the canonical fuel record from fuel_transactions (core). The projection is the
 * ONE place the dedup rules live: reports read `where is_canonical and not is_void` and cannot
 * double-count, because 0257's partial unique index will not hold the row that would let them.
 *
 * Access posture: deny-all RLS on financial_entries stands (D-SEP7) — the accounting/billing
 * surfaces of phase P5 read through this module's interfaces, never PostgREST.
 */
export { projectFinancialWindow, type ProjectionResult } from "./projection.js";
export { startFinancialProjectionScheduler } from "./projectionScheduler.js";
export {
  startFinancialFreshnessScheduler,
  runFinancialFreshnessOnce,
  planFreshnessFindings,
  STALE_AFTER_HOURS,
  FINANCE_JOB_KINDS,
} from "./financialFreshness.js";
export {
  searchEntries,
  summarizeByCategory,
  moneyByVehicle,
  apSpendByAccount,
  type EntryFilter,
  type FinancialEntryRow,
  type CategorySummary,
  type VehicleMoney,
  type AccountSpend,
} from "./reads.js";
export { getLedgerCoverage } from "./ledgerCoverage.js";
export { getFuelTieOut } from "./fuelTieOut.js";
export { getMonthCloses, runMonthClosesOnce, computeMonthClose, type MonthCloseRow } from "./monthClose.js";
export { getGlIncomeForMonths, type GlIncomeSummary } from "./glIncome.js";
export { getIncomeStatement, type IncomeStatementResult } from "./incomeStatement.js";
export { getMileageCoverage, type MileageCoverageResult } from "./mileageCoverage.js";
export { getFleetReport, type FleetReportResult } from "./fleetReport.js";
export { getFleetTrend, type FleetTrendResult } from "./fleetTrend.js";
export { getBillingActivity, type BillingActivityResult } from "./billingActivity.js";
export { earningsByDispatcher, dispatcherNamesForEntries, type DispatcherEarnings } from "./dispatcherEarnings.js";
