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
export { rosterDriversRouter } from "./routes/drivers.js";
export { rosterArchiveRouter } from "./routes/archive.js";
export { rosterCredentialsRouter } from "./routes/credentials.js";
export { rosterSevenDayRouter } from "./routes/sevenDay.js";
export { recordInferredTrailerPairing } from "./trailerPairing.js";
// The equipment half of the §396.17 inspection — `maintenance` reads identity and projects the
// expiry through here, because `vehicles` and `trailers` are this module's tables (D-AVI9/D-AVI10).
export { getEquipmentIdentity, recordEquipmentInspectionExpiry } from "./equipmentInspection.js";
export type { EquipmentIdentity } from "./equipmentInspection.js";
