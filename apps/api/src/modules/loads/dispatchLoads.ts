/**
 * Dispatch-side load operations (Phase 3D, D49) — the counterpart to `driverLoads.ts`.
 *
 * P2 split: this barrel preserves the public surface (`../services/dispatchLoads.js`) while the
 * implementation lives in cohesive modules:
 *  - `dispatchLoads/queries`   — reads (listLoads, listEvents, listAssignments)
 *  - `dispatchLoads/mutations` — the writes LR6 left: resolve an exception, end a stuck shift
 *  - `dispatchLoads/shared`    — column lists, trigger-error mapping, and the private write helpers
 *
 * Reads are wide (dispatch sees every status). The office no longer writes a load at all
 * (LOADS-MIRROR-PLAN.md LR6): McLeod does, through the projection, and the office's one act on a load is
 * Dispatch (`dispatchToDriver.ts`), which writes `load_dispatches` instead.
 */
export { listLoads, listEvents, listAssignments } from "./dispatchLoads/queries.js";
export { getLoadDetail, type LoadPhoto } from "./dispatchLoads/detail.js";
export { listExceptions } from "./dispatchLoads/exceptions.js";
export { resolveException, endDutySession } from "./dispatchLoads/mutations.js";
export type { DispatchResult } from "./dispatchLoads/shared.js";
