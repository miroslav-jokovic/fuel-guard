import { z } from "zod";
import type { AnomalySeverity, AnomalyStatus } from "./constants.js";
import { RULE_IDS } from "./anomalyRules.js";

/** An anomaly row as the web reads it. */
export interface Anomaly {
  id: string;
  org_id: string;
  transaction_id: string;
  vehicle_id: string | null;
  rule_id: string;
  severity: AnomalySeverity;
  status: AnomalyStatus;
  message: string;
  evidence: Record<string, unknown>;
  source: string;
  assigned_to: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

/**
 * Workflow transition request. A note is required when resolving or dismissing (audit trail), and
 * the caller's `version` must match for an optimistic-concurrency update (audit H6 → 409 on mismatch).
 */
export const anomalyTransitionSchema = z
  .object({
    status: z.enum(["investigating", "resolved", "dismissed"]),
    note: z.string().trim().max(2000).optional(),
    version: z.number().int().nonnegative(),
  })
  .refine((d) => d.status === "investigating" || (d.note && d.note.length > 0), {
    message: "A note is required when resolving or dismissing an anomaly",
    path: ["note"],
  });
export type AnomalyTransition = z.infer<typeof anomalyTransitionSchema>;

// ── Thresholds (settings form) ──────────────────────────────────────────────

export interface AnomalyThresholds {
  org_id: string;
  mpg_drop_pct: number;
  capacity_tolerance_pct: number;
  rapid_refuel_hours: number;
  max_plausible_mph: number;
  cost_min_per_gal: number | null;
  cost_max_per_gal: number | null;
  disabled_rules: string[];
  ai_verification_enabled: boolean;
  ai_monthly_token_budget: number | null;
}

const optionalNumber = z.preprocess(
  (v) => (v === "" || v == null ? null : v),
  z.coerce.number().nullable(),
);

export const thresholdsFormSchema = z.object({
  mpg_drop_pct: z.coerce.number().min(0).max(100),
  capacity_tolerance_pct: z.coerce.number().min(0).max(100),
  rapid_refuel_hours: z.coerce.number().int().min(0).max(72),
  max_plausible_mph: z.coerce.number().min(1).max(200),
  cost_min_per_gal: optionalNumber,
  cost_max_per_gal: optionalNumber,
  disabled_rules: z.array(z.enum(RULE_IDS)),
  ai_verification_enabled: z.boolean(),
  ai_monthly_token_budget: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.coerce.number().int().min(0).nullable(),
  ),
});
export type ThresholdsForm = z.infer<typeof thresholdsFormSchema>;
