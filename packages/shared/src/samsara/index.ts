/** Samsara — public barrel. Re-exports exactly the symbols the shared package exposed pre-split. */
export {
  metersToMiles,
  parseSamsaraSamples,
  matchFuelingMoment,
  sampleNearestTime,
} from "./core.js";
export type { SamsaraSample, OdometerSource, SourcedOdometer, FuelingMatch } from "./core.js";
export {
  normalizeStateCode,
  stateFromAddress,
  cityFromAddress,
  compareLocationState,
  approxFuelingUtcMs,
} from "./location.js";
export {
  MIN_MISMATCH_COVERAGE,
  odometerAtTime,
  pathDistanceMiles,
  odometerAtTimeSourced,
  matchFuelingStop,
  MIN_FUEL_RISE_PCT,
  findFuelingEvent,
} from "./stops.js";
export type { FuelingStopMatch, FuelingEvent } from "./stops.js";
export {
  minSampleDistanceMiles,
  resolveLocationConfidence,
  reconcileOdometerMiles,
  parseFuelPercents,
  tankPercentNear,
  reconcileTankFill,
} from "./reconcile.js";
export type {
  LocationConfidence,
  OdometerReconciliation,
  TankReading,
  TankFillReconciliation,
} from "./reconcile.js";
export {
  parseVehicleFuelPercents,
  parseVehicleStatsOdometer,
  parseVehicleGpsSnapshots,
  cityFromFormattedLocation,
  parseCurrentAssignments,
  parseAssignmentIntervals,
  mergeOperatorAssignments,
  matchAssignmentAt,
  parseSamsaraTrailers,
  parseTrailerAssignments,
  parseSamsaraDrivers,
  parseSamsaraVehicles,
  locationDistanceMiles,
} from "./entities.js";
export {
  parseIftaVehicleReport,
  mergeIftaPages,
  iftaMonthNumber,
  IFTA_MONTHS,
} from "./ifta.js";
export type {
  IftaJurisdictionRow,
  IftaTroubleshooting,
  IftaVehicleReport,
  IftaMonth,
  RawIftaResponse,
} from "./ifta.js";
export type {
  SamsaraVehicle,
  VehicleFuelLevel,
  VehicleGpsSnapshot,
  SamsaraDriver,
  VehicleDriverLink,
  AssignmentInterval,
  OperatorObservation,
  SamsaraTrailer,
  TrailerVehicleLink,
} from "./entities.js";
export {
  findFuelLevelDrops,
  normalizeFuelSamples,
  accumulateStatsFeedPage,
  latestOdometerMiles,
  latestFuelLevel,
  feedPageHasData,
  FUEL_DROP_MAX_GAP_MINUTES,
} from "./statsFeed.js";
export type {
  FuelLevelSample,
  FuelLevelDrop,
  FuelDropOptions,
  StatsFeedPage,
  VehicleFeedSeries,
} from "./statsFeed.js";
export { computeTelematicsCoverage } from "./telematicsCoverage.js";
export type {
  TelematicsCoverageInput,
  TelematicsCoverageMonth,
  TelematicsCoverageSummary,
} from "./telematicsCoverage.js";
export { lastReadingEachDay } from "./odometerReadings.js";
export type { OdometerStatSample, DailyOdometerReading } from "./odometerReadings.js";
