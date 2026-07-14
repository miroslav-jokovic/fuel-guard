/**
 * Driver Performance — shared contracts + defaults (pure). Combines the Samsara Safety Score, the Samsara
 * Driver Efficiency score, and our own Idling-discipline score into one fair weekly grade. See
 * docs/16-DRIVER-PERFORMANCE.md. Every sub-score is 0–100, higher = better. The final grade is a weighted
 * mix of fleet-relative NORMALIZED component scores, ranked on a trailing multi-week average.
 */

/** How each component is put on a common scale before the weighted combine (§3.3). */
export type NormalizationMethod = "percentile" | "zscore" | "raw";

/**
 * How the idling sub-score is computed (§3.3a):
 *  - "intensity" — avoidable idle as a share of the driver's ENGINE-ON time (drive + idle). Exposure-normalized
 *                  and money-aligned: it grows with the ABSOLUTE avoidable waste, fair across mileage. DEFAULT.
 *  - "share"     — avoidable idle as a share of the driver's OWN idle only (magnitude-blind discipline ratio).
 */
export type IdleScoreBasis = "intensity" | "share";

export interface PerformanceWeights {
  safety: number;
  efficiency: number;
  idling: number;
}

export interface PerformanceSettings {
  weights: PerformanceWeights;
  normalizationMethod: NormalizationMethod;
  /** Below this many eligible drivers with a component, percentile is too coarse → fall back to zscore. */
  minCohortForPercentile: number;
  /** Weekly exposure gate (miles + drive-hours). */
  minDistanceMi: number;
  minDriveHours: number;
  /** Winners frozen per week. */
  rewardTopN: number;
  /** Weeks averaged for the trailing rank. */
  trailingWeeks: number;
  /** How the idling sub-score is computed (money-aligned "intensity" vs discipline "share"). */
  idleScoreBasis: IdleScoreBasis;
}

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  weights: { safety: 0.5, efficiency: 0.25, idling: 0.25 },
  normalizationMethod: "percentile",
  minCohortForPercentile: 20,
  minDistanceMi: 500,
  minDriveHours: 10,
  rewardTopN: 3,
  trailingWeeks: 3,
  idleScoreBasis: "intensity",
};

/** Per-driver raw inputs for one week. Component scores are 0–100 or null (absent). */
export interface DriverWeekInput {
  driverId: string;
  driverName?: string | null;
  safetyScore: number | null;
  efficiencyScore: number | null;
  idleScore: number | null;
  /** Avoidable (discretionary) idle hours this week — powers the money-aligned "intensity" basis. */
  idleDiscretionaryHours?: number | null;
  /** Engine-on hours (driving + idling) — the exposure denominator for the "intensity" basis. */
  engineOnHours?: number | null;
  /** Exposure, from the Safety feed. */
  miles: number | null;
  driveHours: number | null;
}

export type IneligibleReason = "below_min_miles" | "below_min_hours" | "no_safety";

/** One driver's combined result for a single week. */
export interface DriverWeekScore {
  driverId: string;
  driverName: string | null;
  safetyScore: number | null;
  efficiencyScore: number | null;
  idleScore: number | null;
  /** Fleet-relative normalized component scores (0–100) among the eligible cohort; null when absent/ineligible. */
  safetyPct: number | null;
  efficiencyPct: number | null;
  idlePct: number | null;
  miles: number | null;
  driveHours: number | null;
  eligible: boolean;
  ineligibleReason: IneligibleReason | null;
  /** Weighted combine of present normalized components (0–100), or null when not rankable. */
  weekFinal: number | null;
}

export interface WeekLeaderboard {
  rows: DriverWeekScore[];
  eligibleCount: number;
  methodUsed: NormalizationMethod;
  /** How many eligible drivers had each component present (data coverage). */
  coverage: { safety: number; efficiency: number; idling: number };
}

/** A ranked row on the trailing leaderboard. */
export interface LeaderboardRow {
  driverId: string;
  driverName: string | null;
  /** Trailing average of weekFinal over the available eligible weeks. */
  trailingFinal: number;
  /** How many of the trailing window's weeks contributed. */
  weeksCounted: number;
  /** The most-recent week's combined result (for display of current sub-scores). */
  current: DriverWeekScore;
  rank: number;
  isWinner: boolean;
}
