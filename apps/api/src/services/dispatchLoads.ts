/**
 * Dispatch-side load operations (Phase 3D, D49) — the counterpart to `driverLoads.ts`.
 *
 * P2 split: this barrel preserves the public surface (`../services/dispatchLoads.js`) while the
 * implementation lives in cohesive modules:
 *  - `dispatchLoads/queries`   — reads (listLoads, listEvents, listAssignments)
 *  - `dispatchLoads/mutations` — writes + lifecycle transitions (create/update/transition/assign/…)
 *  - `dispatchLoads/shared`    — column lists, trigger-error mapping, and the private write helpers
 *
 * Reads are wide (dispatch sees every status); writes are the audited lifecycle transitions from D45,
 * each writing a `load_events` row. The transition gates live in the `loads_status_guard` trigger (0087).
 */
export { listLoads, listEvents, listAssignments } from "./dispatchLoads/queries.js";
export {
  createLoad,
  updateLoad,
  transitionLoad,
  assignLoad,
  endDutySession,
  bulkTransition,
  type BulkOutcome,
} from "./dispatchLoads/mutations.js";
export type { DispatchResult } from "./dispatchLoads/shared.js";
