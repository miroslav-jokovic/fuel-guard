/** Anomaly engine — public barrel. Re-exports exactly the symbols the shared package exposed pre-split. */
export { RULE_IDS, SUPPRESSED_RULE_IDS, RULE_LABELS, formatRuleId } from "./ids.js";
export type { RuleId } from "./ids.js";
export { effectiveCapacityGal, learnObservedMaxFill } from "./types.js";
export {
  learnSensorCapacity,
  resolveCapacity,
  capacityAlertTolerancePct,
  decideCapacityAutoFix,
  CAPACITY_DIVERGENCE_PCT,
  CAPACITY_AUTOFIX_MIN_SAMPLES,
  SENSOR_CAP_MIN_RISE_PCT,
  SENSOR_CAP_MIN_FILL_GAL,
  SENSOR_CAP_PHYSICAL_MIN_GAL,
  SENSOR_CAP_PHYSICAL_MAX_GAL,
} from "./capacityResolve.js";
export type {
  SensorCapacityObservation,
  SensorCapacityResult,
  CapacityConfidence,
  ResolvedCapacity,
  CapacityAutoFix,
} from "./capacityResolve.js";
export type {
  FueledAtPrecision,
  TxnView,
  VehicleView,
  ObservedCapacityResult,
  FuelBalanceEvidence,
  Thresholds,
  OperatingHours,
  RuleContext,
  RuleResult,
  Rule,
} from "./types.js";
export {
  hoursBetween,
  daysBetween,
  milesSinceLast,
  milesSinceLastSourced,
  computedMpg,
  coldWeatherDeratePct,
  contaminatesBaseline,
  TANK_FILL_MIN_TOLERANCE_GAL,
  TANK_FILL_TOLERANCE_PCT,
  TANK_FILL_TOLERANCE_MIN_PCT,
  TANK_FILL_SIGMA_MULT,
  tankShortTolerancePct,
  recentMpgSeries,
  effectiveBaseline,
  MIN_TRAINABLE_MPG,
  MAX_TRAINABLE_MPG,
  IDLE_BURN_GPH,
  localHourMinute,
  isOffHours,
  eventTime,
  timeReliable,
} from "./helpers.js";
export {
  learnOdometerOffset,
  learnTankSensorReliability,
  robustWindowMiles,
  isSystematicStationOffset,
} from "./learning.js";
export type {
  OdometerOffsetResult,
  TankSensorReliabilityResult,
  WindowOdoRow,
  WindowMilesResult,
} from "./learning.js";
export { runAllRules } from "./rules.js";
export { MPG_SUSTAINED_MIN_FILLS, MPG_SUSTAINED_MIN_MILES } from "./rulesEfficiency.js";
export { RULESET_HASH } from "./catalog.generated.js";
export {
  MARKET_PRICE_OUTLIER_MULT,
  SAME_SITE_MILES,
  IMPOSSIBLE_TRAVEL_MIN_MILES,
  LOCATION_DISTANCE_MISMATCH_MILES,
  LOCATION_DISTANCE_FAR_MILES,
  CHRONIC_SHORT_MIN_FILLS,
  CHRONIC_SHORT_MIN_GAL,
  CHRONIC_SHORT_SIGMA_MULT,
  CHRONIC_SHORT_DEFAULT_SIGMA,
} from "./rulesBehavioral.js";
export {
  SEVERITY_RANK,
  maxSeverity,
  CASE_RULE_ID,
  SIGNAL_META,
  correlateSignals,
  reconcileAnomalies,
  CORRELATION_THRESHOLDS,
  explainCaseOutcome,
} from "./cases.js";
export type {
  SignalAxis,
  CaseLevel,
  CaseSignal,
  CaseAssessment,
  ExistingAnomaly,
  AnomalyReconciliation,
} from "./cases.js";
export {
  windowMilesFromAggregate,
  aggregateWindowOdo,
  windowMilesViaAggregate,
} from "./windowMilesAggregate.js";
export type { WindowOdoAggregate } from "./windowMilesAggregate.js";
