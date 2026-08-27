/**
 * driver-app — the driver phone's server side, sixteenth module (carved 2026-08-27,
 * docs/ARCHITECTURE.md §4).
 *
 * The me-surface BFF (the one endpoint set the Expo app talks to), duty sessions with their
 * abandonment sweeper, and the per-org feature/kill-switch resolution. Owns
 * `driver_duty_sessions`, `driver_app_features`, `driver_app_feature_overrides`, and
 * `driver_write_counters` (RPC-written rate buckets). `device_push_tokens` went to `messaging`
 * at its carve-out — its writers are the notification machinery.
 *
 * me.ts aggregates, and every domain it serves is an interface call: loads' driver verbs,
 * performance's score, messaging's threads, roster-issued credentials behind auth. That is what
 * a BFF should be — edges, not reimplementations — and the allow-list entries are the proof.
 */
export { meRouter } from "./routes/me.js";
export { driverAppSettingsRouter } from "./routes/driverAppSettings.js";
export { resolveDriverId } from "./dutySessions.js";
export { startDutySessionSweeper } from "./dutySessionSweeper.js";
export { getResolvedFeatures } from "./driverAppFeatures.js";
