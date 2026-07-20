/** EFS import — public barrel. Re-exports exactly the symbols the shared package exposed before the split. */
export { FUEL_PRODUCT_CODES, REEFER_ITEM_CODES, tankTypeForItem } from "./types.js";
export type { ReportKind, RawRow, TankType, EfsTimePrecision, ParsedFuelLine, SkippedRow, ParsedDeclined } from "./types.js";
export { efsDateToIso, efsLocalDate, stateTimeZone, zonedWallTimeToUtcIso, isNoonSentinelIso, efsInstant, efsDateTimeToIso } from "./dateTime.js";
export type { EfsInstant } from "./dateTime.js";
export { fuelTypeFromText, detectReportKind, buildFuelExternalRef, normalizeTransactionRows, normalizeAllTransactionLines, deriveFuelEventsFromEfsStore } from "./parse.js";
export type { EfsTransactionLine, EfsTransactionRow, DeclinedTransactionRow, ReconciledFuelLine, EfsStoreLine, DerivedFuelEvents } from "./parse.js";
export { parseStationIdentity, unitMatchKeys, driverMatchKey, driversToProvision, reconcileFuelLines, normalizeRejectRows } from "./reconcile.js";
export type { StationIdentity } from "./reconcile.js";
