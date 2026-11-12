/**
 * ifta — the quarterly fuel-tax harness, built 2026-08-27 (program step P1.10,
 * docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md). ARCHITECTURE §4 tolerated "ifta reads
 * samsara staging + fuel" — but the tolerance covered the read, not the browser→staging path
 * the web hook actually used. This module is now the only caller of the 0256/0258 period RPCs;
 * the position/tie-out math stays pure in the web feature and packages/shared. Owns no tables.
 * McLeod's hand-keyed fuel receipts (IP6) reach both reads through `receiptReads.ts`.
 */
export { iftaRouter } from "./routes/index.js";
// Ask AI's `ifta_report` (F21 R6b): the IFTA ledger page's quarter, by state.
export { assistantIftaReport, IFTA_QUARTER_PERIODS } from "./assistantIftaReport.js";
export { readIftaPeriod, readIftaJurisdictionTrucks, type IftaPeriodRows } from "./periodReads.js";
/** The roster sweep's door onto 0433: a truck's fuel-tax exclusion, recorded as dated periods. */
export { recordFuelTaxExclusion, type FuelTaxExclusionChange } from "./fuelTaxExclusion.js";
