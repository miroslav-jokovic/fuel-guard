/**
 * efs — the EFS/WEX fuel-card collector, the module that taught this codebase what a module is.
 *
 * Built during the card-control programme (docs/28-EFS-EXECUTION-PLAN.md) as `src/efs/` with the
 * capability registry, harness and orchestrator; docs/ARCHITECTURE.md D-ARC1 names it the pattern
 * the 2026-08-26 re-founding generalised, and this carve-out moves it under `modules/` with its
 * whole surface: the registry subtree, the ingest/mirror/reconcile services (`services/`), the
 * SOAP vendor plumbing that was in `lib/` (`lib/` here — soapClient, card XML, canonicalisation,
 * TLS), and the card routes that were `routes/fuelCards/` (`routes/`).
 *
 * Owns every `efs_*` table plus `card_write_counters` — and `efsIngest`/`efsSync` write
 * `fuel_transactions`/`fuel_events` (fuel-owned): the collector→core write the doc's §1 arrow
 * describes, pinned in the writer manifest, formalised when `fuel` core carves out.
 *
 * Wiring imports module files directly BY DESIGN: `app.ts` mounts the 13 card routers,
 * `schedulers.ts` starts the pollers, and the queue handlers bind the sync entrypoints — wiring
 * enumerates a surface, and re-exporting all of it here would add indirection with no isolation
 * (the boundary gate polices module→module, not wiring→module). What IS interface: the symbols
 * other services consume, below. EFS card writes go through the capability registry — that rule
 * (root CLAUDE.md) is unchanged by the move.
 */
export { syncFuelEventsFromEfs, scoreTouched } from "./services/efsSync.js";
export { cardRefHmac } from "./services/efsCardMirror.js";
export { buildIngestSource } from "./services/efsAutoIngest.js";
export { ingestReport } from "./services/efsIngest.js";
export { previewReport, type ReportPreview } from "./services/efsPreview.js";
export { readEfsLineItemsWindow, type EfsLineItemRow } from "./services/efsLineItems.js";
export { registerEfsSoapIntegrationRoutes } from "./routes/integrationSoap.js";
export { registerFeedFreshnessRoutes, type FeedFreshnessResponse } from "./routes/feedFreshness.js";
export { registerEfsExportRoutes } from "./routes/exports.js";
export { registerEfsSoapCertRoutes } from "./routes/integrationSoapCerts.js";
