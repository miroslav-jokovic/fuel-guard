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
export { getGlIncomeForMonths, type GlIncomeSummary } from "./glIncome.js";
export {
  getGlMonthlyCosts,
  type GlMonthlyCosts,
  type GlMonthlyCostAccount,
} from "./glMonthlyCosts.js";
export { computeCpmForWindow, type CpmWindowReport } from "./cpm.js";
export {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  readFixedCostsForMonths,
} from "./costSchedules.js";
