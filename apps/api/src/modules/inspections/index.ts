/**
 * Roadside inspections and their DataQs challenges — the `safety` section's engine
 * (docs/plans/safety-dqf/INSPECTION-CHALLENGE-PLAN.md, D-IC12; scope D-S360-8: the engine challenges
 * records that are wrong, never records that are real).
 *
 * Built in steps IC1–IC9. Today (IC1) it is a collector: FMCSA's public open data for the carrier's
 * USDOT number, stored verbatim and versioned in `fmcsa_fetch_runs` / `fmcsa_raw_rows` (0457), and
 * projected into the typed `roadside_inspections` / `_units` / `_violations` / `_citations` with each
 * unit matched to our roster (0458). The SMS calculator and every case and filing table land in later
 * steps, and each one is this module's to own.
 *
 * The first reader of that projection is the Inspections inbox's first slice (§6) and the Operations
 * tab's Roadside card counting it (`routes/roadside.ts`, FLEET-MANAGER-HOME-PLAN Q-FM7 (a)).
 *
 * IC5 (`attribution/`) reads who was driving at each inspection from Samsara — only through the
 * `samsara` module's index (`inspections -> samsara` in `API_ALLOW`) — freezes the answers as received,
 * and records the reading in `inspection_attributions` (0473). The Inspection page shows the reading
 * (`read/inspectionAttribution.ts`) and a person confirms or corrects it (`attribution/decide.ts`), a
 * new row restating the reading it was made over.
 *
 * IC2 (`documents/`) files an inspection's paper — ticket, court result, officer's copy — only through
 * `evidence`'s `registerDocument` and lists it through `listDocuments` (`inspections -> evidence`).
 */
export { startFmcsaFeedScheduler, isFmcsaFeedDue } from "./feed/scheduler.js";
export { syncFmcsaFeed, type DatasetOutcome } from "./feed/sync.js";
export { projectRoadside, type ProjectionCounts } from "./feed/project.js";
export { SocrataClient, SocrataError, scopeWhere, type SocrataClientOptions } from "./feed/socrata.js";
export { roadsideInspectionsRouter } from "./routes/roadside.js";
export { roadsideReportReadGate } from "./report/readGate.js";
