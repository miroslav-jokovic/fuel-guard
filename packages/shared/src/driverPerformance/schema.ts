/** Zod schema for the driver-performance Settings form (shared by web validation + type). */
import { z } from "zod";

export const NORMALIZATION_METHODS = ["percentile", "zscore", "raw"] as const;
export const IDLE_SCORE_BASES = ["intensity", "share"] as const;

export const performanceSettingsFormSchema = z
  .object({
    weight_safety: z.coerce.number().min(0).max(100),
    weight_efficiency: z.coerce.number().min(0).max(100),
    weight_idling: z.coerce.number().min(0).max(100),
    normalization_method: z.enum(NORMALIZATION_METHODS),
    min_cohort_for_percentile: z.coerce.number().int().min(0),
    min_distance_mi: z.coerce.number().min(0),
    min_drive_hours: z.coerce.number().min(0),
    reward_top_n: z.coerce.number().int().min(1).max(50),
    trailing_weeks: z.coerce.number().int().min(1).max(12),
    idle_score_basis: z.enum(IDLE_SCORE_BASES),
    settle_hours: z.coerce.number().int().min(0).max(1000),
    efficiency_enabled: z.boolean(),
    week_starts_on: z.coerce.number().int().min(0).max(1),
  })
  .refine((d) => d.weight_safety + d.weight_efficiency + d.weight_idling > 0, {
    message: "At least one weight must be greater than 0",
    path: ["weight_safety"],
  });

export type PerformanceSettingsForm = z.infer<typeof performanceSettingsFormSchema>;
