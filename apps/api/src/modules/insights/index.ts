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
