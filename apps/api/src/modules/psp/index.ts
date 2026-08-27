/**
 * psp — the FMCSA PSP screening collector, fifth module of the 2026-08-26 re-founding
 * (D-ARC1, docs/ARCHITECTURE.md §2).
 *
 * The whole PSP surface in one place: the vendor client (OAuth against the NIC/Tyler API, the
 * "SambaSafety-shaped" response envelopes), report ordering with its preflight and billing
 * stance, PDF import/filing into the DQ document store, and the two routes recruitment mounts.
 * Owns `psp_requests`; `driver_authorizations` is also this module's per the doc, with one
 * recorded exception — `routes/recruitment/authorizations.ts` writes the driver's §391.23
 * authorization capture and stays with recruitment until that carve-out (the writer manifest
 * pins it). Pure PSP parsing logic lives in `packages/shared/src/psp/` and stays there — shared
 * is the contract layer, not a module.
 *
 * `pspImport` still imports `services/compliance.js` (registerDocument) — the evidence/compliance
 * seam this module inherits until `evidence` carves out.
 */
export { PspError, fetchMonitoringReport, fetchRecordPdf, pspHost, requestRecord } from "./client.js";
export { recruitmentPspRouter } from "./routes/psp.js";
export { recruitmentPspOrdersRouter } from "./routes/pspOrders.js";
export { orderPspRecord, pspOrderPreflight } from "./pspOrder.js";
export { filePspImport, isPspImportError, registerPspImportDocument } from "./pspImport.js";
