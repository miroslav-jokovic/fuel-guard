import { z } from "zod";
import { orgModuleSchema } from "./entitlements.js";
import { featureStateSchema } from "./featureCatalog.js";

// Driver App API contract (plan §23.2 / D24). The client parses responses with these — never trusts
// raw shapes. Numeric columns arrive as number|string from PostgREST, so coerce.

export const meDriverSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  status: z.string(),
  employee_id: z.string().nullable(),
  phone: z.string().nullable(),
});
export type MeDriver = z.infer<typeof meDriverSchema>;

export const meAssignedVehicleSchema = z.object({
  id: z.uuid(),
  unit_number: z.string(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  fuel_type: z.string(),
  tank_capacity_gal: z.coerce.number(),
  current_odometer: z.coerce.number(),
});
export type MeAssignedVehicle = z.infer<typeof meAssignedVehicleSchema>;

export const meDriverResponseSchema = z.object({
  driver: meDriverSchema,
  vehicles: z.array(meAssignedVehicleSchema),
  /**
   * Which modules this tenant has bought — the app hides what it does not have (D55).
   * REQUIRED, deliberately: this field once had `.default([])`, which silently masked an API
   * refactor that dropped the org_modules read — every driver parsed fine and saw zero modules.
   * A missing field must be a loud parse error, never an empty entitlement set.
   */
  modules: z.array(orgModuleSchema),
  /**
   * The server-RESOLVED driver-app feature set (hardening plan Phase 4): released × entitled ×
   * org-enabled × per-driver override, computed in ONE place (`resolveFeatures`). The app consumes
   * this and never re-derives policy. REQUIRED for the same reason as `modules` — absence must be
   * a loud parse error, not a silently featureless app.
   */
  features: z.array(featureStateSchema),
});
export type MeDriverResponse = z.infer<typeof meDriverResponseSchema>;

// ── Driver Performance self-view (Phase 5 / docs/16-DRIVER-PERFORMANCE.md) ──────────────────────
// The signed-in driver's OWN frozen weekly grades from driver_performance_weeks. The API scopes the
// read to this driver server-side and returns each week's rank plus the cohort size — a count the
// driver could never read themselves (RLS hides every other driver's row), so "rank #4 of 23" is
// possible without leaking the leaderboard. Numeric columns arrive as number|string from PostgREST.

export const performanceWeightsSchema = z.object({
  safety: z.coerce.number(),
  efficiency: z.coerce.number(),
  idling: z.coerce.number(),
});
export type PerformanceWeightsView = z.infer<typeof performanceWeightsSchema>;

export const meScoreWeekSchema = z.object({
  week_start: z.string(),
  week_end: z.string(),
  /** Raw 0–100 sub-scores (higher = better), null when the feed is absent. */
  safety_score: z.coerce.number().nullable(),
  efficiency_score: z.coerce.number().nullable(),
  idle_score: z.coerce.number().nullable(),
  /** Fleet-relative normalized components (0–100) among the eligible cohort; null when absent/ineligible. */
  safety_pct: z.coerce.number().nullable(),
  efficiency_pct: z.coerce.number().nullable(),
  idle_pct: z.coerce.number().nullable(),
  /** Weighted combine of present normalized components — the week's grade. null → not rankable. */
  week_final: z.coerce.number().nullable(),
  /** Trailing-window average the rank is computed on. */
  trailing_final: z.coerce.number().nullable(),
  drive_distance_mi: z.coerce.number().nullable(),
  drive_time_hours: z.coerce.number().nullable(),
  eligible: z.boolean(),
  ineligible_reason: z.string().nullable(),
  rank: z.number().int().nullable(),
  is_winner: z.boolean(),
  /** Ranked (eligible) drivers in this week — the "of N" in the rank line. null when not computed. */
  cohort_size: z.number().int().nullable(),
});
export type MeScoreWeek = z.infer<typeof meScoreWeekSchema>;

export const meScoreResponseSchema = z.object({
  /** Most-recent settled week first, up to 8 weeks. Empty until the driver's first week settles. */
  weeks: z.array(meScoreWeekSchema),
  /** The latest week's weighting (or defaults) — powers the "biggest opportunity" coaching line. */
  weights: performanceWeightsSchema,
});
export type MeScoreResponse = z.infer<typeof meScoreResponseSchema>;
