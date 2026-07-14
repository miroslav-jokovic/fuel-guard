/**
 * Resolve a driver_performance_settings DB row (+ the org's timezone) into a typed config with defaults
 * (pure). Shared by the API snapshot/sync and the web live view so both grade with identical rules.
 */
import { DEFAULT_PERFORMANCE_SETTINGS } from "./types.js";
import type { NormalizationMethod, PerformanceSettings } from "./types.js";

export interface PerformanceSettingsRow {
  weight_safety?: number | string | null;
  weight_efficiency?: number | string | null;
  weight_idling?: number | string | null;
  normalization_method?: string | null;
  min_cohort_for_percentile?: number | string | null;
  min_distance_mi?: number | string | null;
  min_drive_hours?: number | string | null;
  reward_top_n?: number | string | null;
  trailing_weeks?: number | string | null;
  settle_hours?: number | string | null;
  efficiency_enabled?: boolean | null;
  week_starts_on?: number | string | null;
  week_timezone?: string | null;
}

export interface ResolvedPerformanceConfig {
  settings: PerformanceSettings;
  weekTimezone: string;
  weekStartsOn: number;
  settleHours: number;
  efficiencyEnabled: boolean;
}

const num = (v: unknown, d: number): number => {
  const n = Number(v);
  return v != null && Number.isFinite(n) ? n : d;
};
const asMethod = (v: unknown): NormalizationMethod =>
  v === "zscore" || v === "raw" || v === "percentile"
    ? v
    : DEFAULT_PERFORMANCE_SETTINGS.normalizationMethod;

export function resolvePerformanceConfig(
  row: PerformanceSettingsRow | null | undefined,
  orgTimezone: string,
): ResolvedPerformanceConfig {
  const d = DEFAULT_PERFORMANCE_SETTINGS;
  return {
    settings: {
      weights: {
        safety: num(row?.weight_safety, d.weights.safety),
        efficiency: num(row?.weight_efficiency, d.weights.efficiency),
        idling: num(row?.weight_idling, d.weights.idling),
      },
      normalizationMethod: row ? asMethod(row.normalization_method) : d.normalizationMethod,
      minCohortForPercentile: num(row?.min_cohort_for_percentile, d.minCohortForPercentile),
      minDistanceMi: num(row?.min_distance_mi, d.minDistanceMi),
      minDriveHours: num(row?.min_drive_hours, d.minDriveHours),
      rewardTopN: num(row?.reward_top_n, d.rewardTopN),
      trailingWeeks: num(row?.trailing_weeks, d.trailingWeeks),
    },
    weekTimezone: row?.week_timezone || orgTimezone || "America/Chicago",
    weekStartsOn: num(row?.week_starts_on, 1),
    settleHours: num(row?.settle_hours, 96),
    efficiencyEnabled: row?.efficiency_enabled ?? true,
  };
}
