/**
 * idle — the idle-evidence pipeline and its verdicts, fourth module of the 2026-08-26 re-founding
 * (D-ARC1, docs/ARCHITECTURE.md §4).
 *
 * The whole family moved together — sync AND rollup — because the seam between "collector" and
 * "harness" inside idle runs through shared windows, evidence versions and persistence that the
 * samsara carve-out deliberately refused to split down the middle. Owns `idle_events`,
 * `idle_park_sessions`, `idle_rollup_days`, `idle_settings`, `idle_telemetry_windows`,
 * `vehicle_engine_days`, and `weather_cache` (its only writer is this module's session-weather
 * resolver; revisit if `routing` ever carves out and wants it back). The doc's §2 matrix parked
 * the telemetry tables under `samsara` — this carve-out moves them here because their writers
 * live here, and the manifest is the enforcement.
 *
 * Cross-module edges, each carried in API_ALLOW with its reason:
 *  - idle → samsara: the token loader's error class; the syncs run on Samsara's vendor client.
 *  - samsara → idle: the Samsara scheduler paces the idle syncs — it is the cadence clock.
 *  - fuel-spend → idle: the spend report prints the fleet idle verdict.
 * `idleSync` still writes `driver_vehicle_assignments` (roster-owned): recorded in the writer
 * manifest, resolved when `roster` carves out.
 */
export { syncIdleFoundation } from "./idleFoundationSync.js";
export { syncIdleRollup } from "./idleRollup.js";
export { syncIdleDutyEvidence } from "./idleDutyEvidenceSync.js";
export { IDLE_SOURCE_WINDOW_DAYS } from "./idleWindow.js";
export { organizationTimezone } from "./idleCapabilitySync.js";
export { readFleetIdleVerdict } from "./fuelIdleVerdict.js";
export { backfillTemperatures } from "./weatherBackfill.js";
