/**
 * Roadside inspections and their DataQs challenges — the `safety` section's engine
 * (docs/plans/safety-dqf/INSPECTION-CHALLENGE-PLAN.md, D-IC12; scope D-S360-8: the engine challenges
 * records that are wrong, never records that are real).
 *
 * Built in steps IC1–IC9. Today (IC1, first half) it is a collector only: FMCSA's public open data
 * for the carrier's USDOT number, stored verbatim and versioned in `fmcsa_fetch_runs` /
 * `fmcsa_raw_rows` (0457). The projections, the SMS calculator and every case and filing table land
 * in later steps, and each one is this module's to own.
 *
 * It will file documents only through `evidence`'s `registerDocument` and read Samsara only through
 * the `samsara` module's index; neither edge exists yet, and each arrives in `API_ALLOW` with the
 * step that needs it.
 */
export { startFmcsaFeedScheduler, isFmcsaFeedDue } from "./feed/scheduler.js";
export { syncFmcsaFeed, type DatasetOutcome } from "./feed/sync.js";
export { SocrataClient, SocrataError, scopeWhere, type SocrataClientOptions } from "./feed/socrata.js";
