/**
 * FleetPal — the maintenance collector (docs/plans/maintenance/FLEETPAL-INTEGRATION-PLAN.md).
 *
 * FleetPal is the only source in this stack that knows what ONE TRUCK cost to repair.
 * `mcleod_gl_totals` is grained org × company × period × post_module × glid with no equipment
 * dimension at all, and `mcleod_ap_vouchers` names the truck in free text D-FS5 forbids parsing.
 * `/v1/service-history` carries cost split five ways, labour hours and the meter reading at the
 * time, per unit, per repair.
 *
 * ── ⚠ AND NONE OF THAT MONEY IS FINANCIAL (D-FP3, D-FP4) ───────────────────────────────────────
 * Nothing here projects into `financial_entries` and nothing here reaches the fleet report. The
 * 2026-09-03 fleet ruling (D-FLEET2) made McLeod's general ledger the entire financial input and
 * that stands. What FleetPal knows is what the shop spent THROUGH FLEETPAL; what the ledger knows
 * is what the company spent on maintenance through every channel, and a roadside call invoiced
 * straight to AP never touches FleetPal. The two will disagree, the gap is not an error, and it is
 * why no surface may print a per-unit total without the coverage ratio beside it.
 *
 * The dedup contract this module would have needed under the old ruling is **deleted, not
 * deferred** — there is no second door left for a dedup key to guard. Anyone arriving here to add
 * one should read `docs/ARCHITECTURE.md` §2 and `FINANCE-FLEET-REPORT-PLAN.md` §0 first.
 *
 * ── THIS MODULE WRITES NO TABLE IT DOES NOT OWN (D-FP2) ────────────────────────────────────────
 * It owns `fleetpal_credentials`, `fleetpal_sync_state`, `fleetpal_units` and
 * `fleetpal_webhook_deliveries` (0334), and the staging tables F6 and F7 add. It does NOT write
 * `vehicles`, `trailers`, `parts`, `part_stock` or `part_movements`: where it must affect one it
 * calls the owning module's exported function (`recordMovement`, `createPart` in
 * `modules/maintenance/inventory`), which is the door D-ARC3 provides and `lint:table-access`
 * permits. A direct write would be a new site `lint:table-writers` refuses, and that refusal is
 * what keeps D-INV10's split — the shelf is ours, the repair job is FleetPal's — from eroding one
 * convenient exception at a time.
 */
export {
  getCredential,
  getApiKey,
  setApiKey,
  setEnabled,
  recordSweep,
  type FleetpalCredential,
} from "./credentials.js";
export {
  listSyncState,
  getSyncState,
  advance,
  recordFailure,
  type FleetpalSyncState,
  type SyncPosition,
} from "./syncState.js";
export { listUnits, countUnmatched, stageUnit, setMatch, type FleetpalUnitRow } from "./units.js";
export { claimDelivery, finishDelivery, listRecentDeliveries } from "./deliveries.js";
