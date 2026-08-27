/**
 * accounting — the AP/settlement/cost harness, built 2026-08-27 (program step P5.1,
 * docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md, D-SEP6/7). Reads the financial store
 * through `modules/financial`'s interface; owns no tables yet — the allocation-rules config
 * table arrives WITH finance's §6 Q5 ruling, not before (until then: direct costs only,
 * overhead unallocated and labelled, D-MC28's stance).
 *
 * CPM over financial_entries (FINANCIAL-STORE-PLAN §5.3) joins this module when the P3.5
 * backfill has run in production — a cost-per-mile computed over a store holding 50 days is a
 * number that lies about the year.
 */
export { accountingRouter } from "./routes/index.js";
