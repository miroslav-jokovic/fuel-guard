/**
 * samsara — the Samsara telematics collector, third module of the 2026-08-26 re-founding
 * (D-ARC1, docs/ARCHITECTURE.md §2).
 *
 * The collector PROCESSES live here: driver/vehicle/trailer roster syncs (which defer to McLeod
 * on identity when `mcleod`'s `isTmsRosterMaster` says so — the one cross-module import, carried
 * in API_ALLOW with that reason), IFTA jurisdiction-mile fetches, the reconciliation sweep, the
 * diagnostics probe, and the scheduler that paces them. Owns `samsara_ifta_fetches` and
 * `samsara_ifta_jurisdiction_miles`.
 *
 * Two debts, named so the next carve-outs inherit them knowingly:
 *  - the low-level vendor client stays in `lib/samsara*` — eight importers across un-carved
 *    domains (fuel planning, HOS, idle, reefer) still share it; it moves here when they carve;
 *  - `samsaraScheduler` still orchestrates the idle/HOS/score syncs in `services/` — it is the
 *    Samsara-cadence clock for domains that have not moved yet, so those imports point outward
 *    until the `idle` module exists. The doc's matrix parks `hos_duty_segments`,
 *    `vehicle_engine_days`, `duty_equipment_segments` and `idle_telemetry_windows` under this
 *    module; their writers live in `services/idle*Sync`/`hosSync` and will land here (or in
 *    `idle`) with that carve-out — the writer manifest, not this comment, is the enforcement.
 */
export { syncDriversFromSamsara } from "./samsaraDriverSync.js";
export {
  syncVehiclesFromSamsara,
  syncVehicleStatsFromSamsara,
  NoSamsaraTokenError,
  type VehicleSyncResult,
} from "./samsaraVehicleSync.js";
export { syncTrailersFromSamsara } from "./samsaraTrailerSync.js";
export { monthsToSync, syncIftaMilesForMonth } from "./samsaraIftaSync.js";
export { reconcileWithSamsara, SamsaraUnavailableError } from "./samsaraRecon.js";
export { startSamsaraScheduler } from "./samsaraScheduler.js";
export { runSamsaraDiagnostics } from "./samsaraDiagnostics.js";
export { syncHosDutySegments, syncHosCurrentStatus } from "./hosSync.js";
