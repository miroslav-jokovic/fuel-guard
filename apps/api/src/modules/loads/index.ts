/**
 * loads — the load lifecycle core, thirteenth module (carved 2026-08-27, docs/ARCHITECTURE.md §3).
 *
 * Owns `loads`, `load_stops`, `load_events`, `load_stop_photos`: the dispatch machinery
 * (create/update/transition with the D45 approval gate — a load is invisible to its driver until
 * a human releases it), assignment history, duty coupling, exceptions, and the driver-facing
 * accept/decline/start/complete verbs the me-surface serves. `mcleod` ingests loads from the TMS
 * (collector→core, manifest-pinned); the hazmat link/unlink bridge stays with `hazmat` until its
 * carve-out claims it.
 */
export { dispatchRouter } from "./routes/dispatch.js";
// What each truck is hauling right now, for the live map (LM6). Returns nothing until LM12 turns
// the TMS feed on — `loads` has 0 rows in production — and an empty answer is correct, not broken.
export {
  readLiveLoadContext,
  LIVE_LOAD_STATUSES,
  type LiveLoadContext,
  type LiveLoadStop,
} from "./liveLoadReads.js";
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
