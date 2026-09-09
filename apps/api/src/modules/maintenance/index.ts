/**
 * maintenance — its own section, built ahead of its collector (program step P5.3, D-SEP8 — the
 * owner's 2026-08-27 ruling: separate section in architecture and policies now, FleetPal data and
 * custom features later).
 *
 * IT OWNS FOUR TABLES (scripts/table-modules.json, module=maintenance): `maintenance_inspectors`,
 * `vehicle_inspections`, `vehicle_inspection_items` and `maintenance_print_profiles` — the §396.17
 * annual inspection and the per-printer calibration for the pre-printed pads (0279-0283,
 * docs/plans/maintenance/ANNUAL-INSPECTION-PLAN.md). This header said "Owns no tables yet" until
 * 2026-09-08; it had been wrong since 0279.
 *
 * WHAT THIS MODULE IS AUTHORITATIVE FOR, and what it is not (D-INV10, 2026-09-08). The shelf is
 * ours: on-hand quantities, locations, reorder points, counts, asset identity and kits, arriving as
 * ten more owned tables across INVENTORY-PLAN.md steps I2-I11. The repair job is FleetPal's: the
 * work order and what it consumed. The two are tied by a nullable `work_order_ref` on the issue row
 * and by nothing stronger — no shared key, no projection, no reconciliation until I14.
 *
 * Money is neither. The FLEETPAL DEDUP CONTRACT that stood in this header from 2026-08-27 — that a
 * projected work-order expense must carry `maint:<vendor-invoice-or-wo-ref>` computed identically
 * for the McLeod AP voucher billing the same wrench, so 0257's canonical index rather than reviewer
 * vigilance keeps one wrench from being paid twice — is DELETED, and deleted rather than deferred.
 * The 2026-09-03 fleet ruling (D-FLEET2, docs/plans/financial/FINANCE-FLEET-REPORT-PLAN.md §0) made
 * `mcleod_gl_totals` x `mcleod_gl_accounts` the entire financial input and removed FleetPal from
 * Finance altogether, so there is no second arrival for a dedup key to arbitrate. Parts cost does
 * not arrive either (D-INV11): GL 30230000 Shop Parts already carries $270,670.22 of it, and a part
 * issue is not a spend event — the money left when the part was bought. D-SEP8's gate survives in
 * its operational half: a FleetPal ingest PR still may not merge without stating its contract, but
 * the contract it must now state is an ownership one against this module, not a dedup one against
 * `financial`.
 */
export { maintenanceRouter } from "./routes/index.js";
export { createInspectionDraft, getInspection, patchInspection } from "./inspections/inspections.js";
export { listInspections } from "./inspections/inspectionList.js";
export { createInspector, inspectorFor, isQualifiedOn, listInspectors } from "./inspections/inspectors.js";
export type { InspectorDto, InspectorInput, InspectorRow } from "./inspections/inspectors.js";
