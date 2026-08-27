/**
 * evidence — the first CORE-STORE module of the 2026-08-26 re-founding (docs/ARCHITECTURE.md §3).
 *
 * The append-only compliance record: `documents`, `certifications`, `qualification_records`,
 * `dq_exports` — the exact set pinned in `RETENTION_FORBIDDEN`, where corrections are new rows
 * and deletions are explicit audited service-role acts. Everything that files into or renders
 * out of that record lives here: document registration and listing, derivative generation,
 * the DQ binder renderer, exports with their sweeper, the DQ alert scheduler, and the two
 * compliance routes. Pure §391 logic (qualificationGate, dqFile, dqAlerts) stays in
 * `packages/shared` — shared is the contract layer, not a module.
 *
 * Every outside writer of an evidence table goes through `registerDocument`/this interface —
 * `psp` files fetched reports here ("psp -> evidence" in API_ALLOW), and
 * `services/applicationPdf/file.ts` + `services/employerInquiry.ts` do the same from the
 * un-carved recruitment remainder (manifest-pinned; they become "recruiting -> evidence" when
 * that module carves). This module resolves half of the audit's CDL dual-source finding by
 * existing: `certifications` is the qualification gate's source of truth, and D-ARC3's matrix
 * says the `drivers.cdl_*` columns become a projection of it at the roster carve-out.
 */
export { registerDocument, listDocuments } from "./compliance.js";
export { getComplianceOverview } from "./complianceOverview.js";
export { deriveDocument, DERIVER_VERSION } from "./documentDerivatives.js";
export { buildBinder } from "./dqBinder/index.js";
export { markDone, markFailed, markRunning, storeBinder } from "./dqExports.js";
export { startDqAlertScheduler } from "./dqAlertScheduler.js";
export { startDqExportSweeper } from "./dqExportSweeper.js";
export { complianceRouter } from "./routes/compliance.js";
export { complianceExportsRouter } from "./routes/complianceExports.js";
