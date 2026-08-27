/**
 * ifta — the quarterly fuel-tax harness, built 2026-08-27 (program step P1.10,
 * docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md). ARCHITECTURE §4 tolerated "ifta reads
 * samsara staging + fuel" — but the tolerance covered the read, not the browser→staging path
 * the web hook actually used. This module is now the only caller of the 0256/0258 period RPCs;
 * the position/tie-out math stays pure in the web feature and packages/shared. Owns no tables.
 */
export { iftaRouter } from "./routes/index.js";
export { readIftaPeriod, type IftaPeriodRows } from "./periodReads.js";
