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
 *  - idle → posted-prices: the cost basis prices an idled gallon off the posted board, through the
 *    collector's own reader because `fuel_prices` is raw-layer and sealed to it (Q9).
 * `idleSync` still writes `driver_vehicle_assignments` (roster-owned): recorded in the writer
 * manifest, resolved when `roster` carves out.
 */
export { syncIdleFoundation } from "./idleFoundationSync.js";
export { syncIdleRollup } from "./idleRollup.js";
export { syncIdleDutyEvidence } from "./idleDutyEvidenceSync.js";
export { IDLE_SOURCE_WINDOW_DAYS } from "./idleWindow.js";
export { organizationTimezone } from "./idleCapabilitySync.js";
export { readFleetIdleVerdict } from "./fuelIdleVerdict.js";
/**
 * Q9's one basis. Exported because three readers need the SAME answer: this module's fleet verdict,
 * the Idling endpoint below it, and the Dashboard endpoint §7.2c step 3 adds.
 */
export { resolveIdleCostBasis, __resetIdleCostBasisCache } from "./idleCostBasis.js";
export { idleRouter } from "./routes/index.js";
export { backfillTemperatures } from "./weatherBackfill.js";
