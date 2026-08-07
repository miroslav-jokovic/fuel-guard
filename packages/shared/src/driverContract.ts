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

/**
 * The bootstrap payload, in two shapes — deliberately asymmetric (ship-pipeline decision D-S6).
 *
 * `modules` and `features` are the control plane: what this tenant bought, and what its drivers may
 * see. Both were made REQUIRED after an API refactor silently dropped the `org_modules` read and a
 * `.default([])` turned that regression into "every driver sees nothing", with no error anywhere.
 * Requiring them made that failure loud — but it also made it FATAL on the client: an API one deploy
 * behind fails the parse, and the driver app collapses to a red banner and two tabs. That is a worse
 * outcome than a degraded app, and it is a self-inflicted one, because deploy skew is normal.
 *
 * So: the SERVER is held to the strict shape by its own contract test (`meDriverResponseStrictSchema`),
 * where a missing field is a build-breaking failure with a name attached. The CLIENT is tolerant, and
 * records the fact in `contractDegraded` so the app can say "your app is talking to an older server"
 * in the build-info row instead of pretending to be broken. Loud where a human will act on it,
 * survivable where a driver is standing in a yard at 5am.
 */
const meDriverResponseFieldsSchema = z.object({
  driver: meDriverSchema,
  vehicles: z.array(meAssignedVehicleSchema),
  /** Which modules this tenant has bought — the app hides what it does not have (D55). */
  modules: z.array(orgModuleSchema).optional(),
  /**
   * The server-RESOLVED driver-app feature set (hardening plan Phase 4): released × entitled ×
   * org-enabled × per-driver override, computed in ONE place (`resolveFeatures`). The app consumes
   * this and never re-derives policy.
   */
  features: z.array(featureStateSchema).optional(),
});

/** Client-side parse: never fails on a server that predates the control plane. */
export const meDriverResponseSchema = meDriverResponseFieldsSchema.transform((raw) => ({
  driver: raw.driver,
  vehicles: raw.vehicles,
  modules: raw.modules ?? [],
  features: raw.features ?? [],
  /** True when the server omitted the control-plane fields entirely — i.e. deploy skew, not an org
   *  that simply owns nothing. Surfaced in Settings → build info; never used to grant access. */
  contractDegraded: raw.modules === undefined || raw.features === undefined,
}));
export type MeDriverResponse = z.infer<typeof meDriverResponseSchema>;

/** Server-side contract: the API must always send both fields. Asserted in the API's own tests. */
export const meDriverResponseStrictSchema = meDriverResponseFieldsSchema.required({
  modules: true,
  features: true,
});

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
