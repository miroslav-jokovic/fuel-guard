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
// Filing a document the SERVER rendered — the browser-upload path above cannot serve a caller that
// already holds the bytes. Generalised from recruiting's application PDF at its second caller.
export { fileGeneratedDocument } from "./generatedDocuments.js";
export type { FiledDocument, GeneratedDocumentInput } from "./generatedDocuments.js";
// The certification write, exported so an owner outside this module can file the compliance FACT a
// document backs — `maintenance` files the §396.17 expiry this way (D-AVI9/D-AVI10).
export { insertCertification } from "./compliance.js";
// The TMS-sourced licence and medical card, filed as evidence rather than only as roster columns —
// D-ARC3's dual-source finding closed at the seam the McLeod sweep would otherwise have widened.
export { recordSyncedCredentials, SYNC_NOTE } from "./syncedCredentials.js";
export type { SyncedCredentialInput, SyncedCredentialResult } from "./syncedCredentials.js";
// The one deletion `RETENTION_FORBIDDEN` has always permitted — an explicit, audited, service-role
// act — behind a single door. `maintenance` uses it for D-AVI29's hard delete; the caller writes the
// audit row first, while there is still a record to describe.
export { filedDocumentPath, retractFiledEvidence } from "./retract.js";
export type { Retracted, RetractInput } from "./retract.js";
export { getComplianceOverview } from "./complianceOverview.js";
export { deriveDocument, DERIVER_VERSION } from "./documentDerivatives.js";
export { buildBinder } from "./dqBinder/index.js";
export { markDone, markFailed, markRunning, storeBinder } from "./dqExports.js";
export { startDqAlertScheduler } from "./dqAlertScheduler.js";
export { startDqExportSweeper } from "./dqExportSweeper.js";
export { complianceRouter } from "./routes/compliance.js";
export { complianceExportsRouter } from "./routes/complianceExports.js";
