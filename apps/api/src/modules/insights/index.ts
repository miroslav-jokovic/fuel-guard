/**
 * insights — the cross-cutting read-only harness carved 2026-08-27 (program step P1.6,
 * docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md; the matrix row landed with P0.1).
 * Report exports (CSV/PDF), detection-metrics surfaces, and the ask-the-data endpoint: readers
 * over many owners' tables, writers of none. Named debt, inherited knowingly: askData still
 * reads three raw-layer tables directly (pinned by path in check-table-access.mjs) and the
 * report queries read owners' tables raw — the owner-interface pass is the P6.1 burn-down.
 */
export { reportsRouter } from "./routes/reports.js";
export { aiRouter } from "./routes/ai.js";
/**
 * The fleet Dashboard in one call (queue item 5 step 3). It lives in `insights` for the reason the
 * module exists: a read-only harness over many owners' data, writing none of it — and it reaches the
 * two owners it cannot measure in SQL (`fuel`'s declined count, `idle`'s cost basis) through their
 * own indexes.
 */
export { dashboardRouter } from "./routes/dashboard.js";
export { readDashboardSummary } from "./dashboardSummary.js";
