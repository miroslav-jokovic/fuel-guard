/**
 * billing — the AR/invoice harness, built 2026-08-27 (program step P5.2,
 * docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md, D-SEP6/7). Reads the financial store
 * through `modules/financial`'s interface; owns no tables. The invoice rows themselves arrive
 * via the mcleod billing sweep once the F1/F2 recon answers let it be written — this surface
 * shows what the store holds and says so honestly when that is nothing yet.
 */
export { billingRouter } from "./routes/index.js";
