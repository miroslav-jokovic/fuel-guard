/**
 * anomalies — the fuel-security harness, tenth module of the re-founding (carved 2026-08-27,
 * docs/ARCHITECTURE.md §4).
 *
 * The scoring engine (`scoring/` — context loading, capacity resolution, reconciliation,
 * cascade, persistence), declined-transaction scoring, entity risk and pattern sweeps, the
 * anomaly-flag reconciler, scoring health, and the anomalies case API. Owns `anomalies`,
 * `anomaly_transitions`, `anomaly_thresholds`, `scoring_attempts`, `case_pattern_reports`,
 * `pattern_sweep_requests` — and its writes into `fuel_transactions` score flags are the
 * harness→core seam the manifest pins (the flags live ON the canonical row by design; a
 * separate verdict table was rejected when scoring was built).
 *
 * `ai_verifications` was DROPPED at this carve-out (0260): dead since 0008, measured at zero
 * rows in production, waived since the producers gate landed — the waiver retires with it,
 * 6 → 5. Anything called "AI verification" starts over with a producer or not at all.
 *
 * Scoring is invoked from the collectors when rows land (`efs -> anomalies`,
 * `fuel -> anomalies` in API_ALLOW): detection runs where ingestion finishes, but the rules,
 * thresholds and case lifecycle live here.
 */
export {
  scoreImportWithCascade,
  scoreWithCascade,
  scoreTransaction,
  backfillOrg,
  RECENT_REBUILD_DAYS,
} from "./scoring/index.js";
export { scoreDeclinedImport, scoreDeclinedOrg } from "./declinedScoring.js";
export { scoringHealth } from "./scoringHealth.js";
export { startPatternSweepScheduler } from "./patternSweepScheduler.js";
export { startRebuildOnBoot } from "./rebuildScheduler.js";
export { markPatternSweepOutcome } from "./patternSweepRequests.js";
export { reconcileAnomalyFlags } from "./anomalyFlagReconcile.js";
export { anomaliesRouter } from "./routes/anomalies.js";
export { runPatternSweep } from "./entityRisk.js";
export { affectedVehicleIds } from "./scoring/index.js";
