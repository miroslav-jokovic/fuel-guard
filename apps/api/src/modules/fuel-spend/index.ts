/**
 * fuel-spend — the first module of the 2026-08-26 re-founding (D-ARC1, docs/ARCHITECTURE.md §4).
 *
 * The harness over what fuel actually cost: vendor statements in, the daily rollup, the
 * reconciliation runs, the exception lifecycle, and the rendered spend report. Owns
 * `fuel_statements`, `fuel_statement_lines`, `fuel_spend_days`, `fuel_recon_runs`,
 * `fuel_exceptions`, `fuel_exception_events` — and per D-ARC3 nothing outside this directory
 * writes them (`scripts/table-writers.json` is the enforcement).
 *
 * This file is the module's ONLY public surface. An import that reaches past it into a sibling
 * module's internals fails `lint:boundaries`; an import from here into `../../services/*` is
 * tolerated while the un-carved remainder still lives there, and each such import is a TODO the
 * next carve-out inherits (dqBinder/pdfDraw and fuelIdleVerdict are the two today).
 */
export { registerSpendRoutes } from "./routes/spend.js";
export { registerExceptionRoutes } from "./routes/exceptions.js";
export { startFuelSpendRollupScheduler } from "./fuelSpendRollupScheduler.js";
export { runFuelReconciliation } from "./fuelReconRun.js";
export { ingestFuelStatement, STATEMENT_BUCKET } from "./fuelStatementIngest.js";
