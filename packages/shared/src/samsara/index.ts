/** Samsara — public barrel. Re-exports exactly the symbols the shared package exposed pre-split. */
export { metersToMiles, parseSamsaraSamples, matchFuelingMoment, sampleNearestTime } from "./core.js";
export type { SamsaraSample, OdometerSource, SourcedOdometer, FuelingMatch } from "./core.js";
export { normalizeStateCode, stateFromAddress, cityFromAddress, compareLocationState, approxFuelingUtcMs } from "./location.js";
export { MIN_MISMATCH_COVERAGE, odometerAtTime, pathDistanceMiles, odometerAtTimeSourced, matchFuelingStop, MIN_FUEL_RISE_PCT, findFuelingEvent } from "./stops.js";
export type { FuelingStopMatch, FuelingEvent } from "./stops.js";
export { minSampleDistanceMiles, resolveLocationConfidence, reconcileOdometerMiles, parseFuelPercents, tankPercentNear, reconcileTankFill } from "./reconcile.js";
export type { LocationConfidence, OdometerReconciliation, TankReading, TankFillReconciliation } from "./reconcile.js";
export { parseVehicleFuelPercents, parseVehicleStatsOdometer, parseCurrentAssignments, parseAssignmentIntervals, matchAssignmentAt, parseSamsaraTrailers, parseTrailerAssignments, parseSamsaraDrivers, parseSamsaraVehicles, locationDistanceMiles } from "./entities.js";
export type { SamsaraVehicle, VehicleFuelLevel, SamsaraDriver, VehicleDriverLink, AssignmentInterval, SamsaraTrailer, TrailerVehicleLink } from "./entities.js";
