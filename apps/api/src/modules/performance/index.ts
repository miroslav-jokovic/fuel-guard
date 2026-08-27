/**
 * performance — driver scores and settled weeks, fifteenth module (carved 2026-08-27,
 * docs/ARCHITECTURE.md §4).
 *
 * Owns `driver_scores`, `driver_performance_weeks`, `driver_performance_settings` (the settings
 * row is client-written via PostgREST under RLS — the one owned table with no API writer). The
 * Samsara scheduler paces the score sync (`samsara -> performance`), the me-surface serves the
 * driver their score, and week snapshots settle on the same cadence.
 */
export { getDriverScore } from "./driverScore.js";
export { syncDriverScores, syncRecentDriverScoreWeeks } from "./driverScoreSync.js";
export { snapshotSettledWeeks } from "./driverPerformanceSnapshot.js";
export { registerPerformanceIntegrationRoutes } from "./routes/integration.js";
