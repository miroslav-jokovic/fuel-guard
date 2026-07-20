/** Anomaly engine — public barrel. Re-exports exactly the symbols the shared package exposed pre-split. */
export { RULE_IDS, SUPPRESSED_RULE_IDS, RULE_LABELS, formatRuleId } from "./ids.js";
export type { RuleId } from "./ids.js";
export { effectiveCapacityGal, learnObservedMaxFill } from "./types.js";
export type { FueledAtPrecision, TxnView, VehicleView, ObservedCapacityResult, Thresholds, OperatingHours, RuleContext, RuleResult, Rule } from "./types.js";
export { hoursBetween, daysBetween, milesSinceLast, computedMpg, coldWeatherDeratePct, TANK_FILL_MIN_TOLERANCE_GAL, TANK_FILL_TOLERANCE_PCT, recentMpgSeries, effectiveBaseline, localHourMinute, isOffHours } from "./helpers.js";
export { learnOdometerOffset, learnTankSensorReliability, robustWindowMiles, isSystematicStationOffset } from "./learning.js";
export type { OdometerOffsetResult, TankSensorReliabilityResult, WindowOdoRow, WindowMilesResult } from "./learning.js";
export { runAllRules } from "./rules.js";
export { SEVERITY_RANK, maxSeverity, CASE_RULE_ID, SIGNAL_META, correlateSignals, reconcileAnomalies } from "./cases.js";
export type { SignalAxis, CaseLevel, CaseSignal, CaseAssessment, ExistingAnomaly, AnomalyReconciliation } from "./cases.js";
