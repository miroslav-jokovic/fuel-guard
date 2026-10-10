/**
 * loads — the load lifecycle core, thirteenth module (carved 2026-08-27, docs/ARCHITECTURE.md §3).
 *
 * Owns `loads`, `load_stops`, `load_events`, `load_stop_photos`, `load_stop_eta_predictions` (0453,
 * the dispatch board's recorded ETAs): the dispatch machinery
 * (create/update/transition with the D45 approval gate — a load is invisible to its driver until
 * a human releases it), assignment history, duty coupling, exceptions, and the driver-facing
 * accept/decline/start/complete verbs the me-surface serves. `mcleod` ingests loads from the TMS
 * (collector→core, manifest-pinned); the hazmat link/unlink bridge stays with `hazmat` until its
 * carve-out claims it.
 */
export { dispatchRouter } from "./routes/dispatch.js";
// What each truck is hauling right now, for the live map (LM6). Which loads count is shared
// `isLoadOnTruck` (D-MCC12 for McLeod); an empty answer before the first sync is correct, not broken.
export {
  readLiveLoadContext,
  readLoadForRoute,
  type LiveLoadContext,
  type LiveLoadStop,
  type LoadForRoute,
  type LoadRouteStop,
} from "./liveLoadReads.js";
// Each truck's current and next load, for the dispatch board (DISPATCH-BOARD-PLAN DB4).
export { readTruckLoadPlans, type TruckLoadPlan } from "./truckLoadPlanReads.js";
// The board's ETA to each truck's next stop, recorded hourly so it can be scored against the arrival
// (DB7, 0453). `livemap` makes the estimate; the row is a fact about this module's stop.
export { recordStopEtaPredictions, type StopEtaPrediction } from "./etaPredictions.js";
export {
  acceptLoad,
  completeStop,
  declineLoad,
  getDriverLoads,
  getDriverLoad,
  getDriverType,
  startLoad,
  type LoadResult,
} from "./driverLoads.js";
// McLeod's projected loads, written by the one module that owns `loads` (LOADS-MIRROR-PLAN.md LR4).
// `mcleod` reads its raw tables and calls this; it never writes `loads` for the mirror itself.
export { applyMirroredLoads, type MirroredLoad, type MirrorWriteResult } from "./mirrorLoads.js";
