/**
 * roster — the canonical fleet identity, second core-store module of the 2026-08-26 re-founding
 * (docs/ARCHITECTURE.md §3).
 *
 * Owns `drivers`, `vehicles`, `trailers`, `driver_vehicle_assignments`, `driver_time_off` — the
 * rows every collector enriches and every feature reads. The write topology the manifest pins is
 * the architecture working as drawn: `mcleod` masters identity when the org says so, `samsara`
 * fills the telematics-shaped columns, `efs`/`idle` link cards and assignments, and this module
 * owns the human-facing CRUD, archiving (D-driver-archive: archive, never delete), app-login
 * credential issuance, and the reconcile/merge machinery (`merge_driver` RPC keeps its
 * every-new-table obligation — see merge-driver cascade trap).
 *
 * Two resolutions this carve-out delivers (audit 2026-08-26):
 *  - `terminals` is DROPPED (migration 0259): zero rows, zero producers, zero readers since 0097,
 *    measured against production before removal. A future terminals feature recreates it WITH a
 *    producer — `lint:table-producers` now guarantees that ordering.
 *  - CDL/medical dual-source: `certifications` (evidence) is authoritative — the §391 gate
 *    already reads it. The `drivers.cdl_*`/medical columns REMAIN as the roster's operational
 *    projection (McLeod sync and the application intake write them) until the projection is made
 *    mechanical; new code reads certifications, and this header is the pointer that says so.
 *
 * `routes/sevenDay` writes `seven_day_statements` (recruiting-owned, 0236): the route lives here
 * because it is driver-scoped roster UI; the write is manifest-pinned for the recruiting
 * carve-out to claim.
 */
// Unit number + assigned driver for a whole fleet, for the live map's board (LM6). Narrow on
// purpose: `vehicles` and `drivers` are roster's, and one question is what this answers.
export { writeAssignmentHistory, type HistoryWrite } from "./driverVehicleAssignmentWrites.js";
export { readFleetIdentities, readTrailerAnnualInspections, type FleetIdentity } from "./fleetIdentityReads.js";
// The truck's TMS home fleet, written by mcleod's roster sweep (DISPATCH-BOARD-PLAN DB1).
export { recordVehicleFleetCodes, recordVehicleWindingDown, type FleetPlacement, type WindingDownPlacement } from "./vehicleFleetCodes.js";
export { rosterDriversRouter } from "./routes/drivers.js";
export { rosterArchiveRouter } from "./routes/archive.js";
export { rosterCredentialsRouter } from "./routes/credentials.js";
/** The offboarding hold — ban + push revoke + app_access_enabled=false. Exported for the driver
 *  app's own account closure (P4.2): the driver-side close and the fleet-side hold must mean the
 *  same thing to GoTrue, so there is one implementation and driver-app calls it through here. */
export { disableDriverLogin } from "./driverCredentials.js";
// A former driver the TMS has rehired (D-MR7a): `mcleod` proves it, roster writes it.
export { restoreRehiredDriver, type RehireFacts } from "./driverRehire.js";
export { rosterSevenDayRouter } from "./routes/sevenDay.js";
export { recordInferredTrailerPairing } from "./trailerPairing.js";
// The equipment half of the §396.17 inspection — `maintenance` reads identity and projects the
// expiry through here, because `vehicles` and `trailers` are this module's tables (D-AVI9/D-AVI10).
export { getEquipmentIdentities, getEquipmentIdentity, listAnnualInspectionExpiries, listEquipmentIdentities, recordEquipmentInspectionExpiry } from "./equipmentInspection.js";
// The other end of the projection: read the claim before finalize takes it, give it back when the
// report that took it is deleted (0285, D-AVI29).
export { readEquipmentIdentitySource, releaseEquipmentInspectionClaim } from "./equipmentInspection.js";
export type { EquipmentIdentity, EquipmentListOptions } from "./equipmentInspection.js";
export { listUnitFileFacts, type UnitFileFacts } from "./unitFileFacts.js";
// The truck's page (M3): one unit's identity and meter for the shop, read through the owner.
export { getUnitShopFacts, type UnitShopFacts } from "./unitShopFacts.js";
// F11: FleetPal's collector computes the next PM due point and this module writes it (D-FP2).
export { recordVehiclePmDue, type PmDuePlacement } from "./vehiclePmDue.js";
// The attribution trail (DISPATCH-LOADS-COUNTS-PLAN D-DLC5): Samsara's driver↔vehicle segments, the
// roster's table, read by the Loads module's history endpoint through here.
export {
  readDriverVehicleAssignments,
  resolveAssignmentParties,
  samsaraIdsOf,
  segmentStillHeld,
  STILL_HELD_WITHIN_MS,
  type AssignmentParty,
  type AssignmentSegment,
  type AssignmentSegmentQuery,
} from "./driverVehicleAssignmentReads.js";
