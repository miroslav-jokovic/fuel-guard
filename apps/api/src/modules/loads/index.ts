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
