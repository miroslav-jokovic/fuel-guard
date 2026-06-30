import { z } from "zod";
import { ANOMALY_SEVERITIES, type AnomalySeverity } from "./constants.js";

/**
 * Claude AI verification layer contracts (docs/07-AI-VERIFICATION.md). The hard numbers (distance,
 * implied speed) are computed deterministically here and handed to the model as facts — the model
 * never does trigonometry. Output is strictly Zod-validated.
 */

export const AI_MODELS = {
  fast: "claude-haiku-4-5",
  deep: "claude-sonnet-4-6",
} as const;

export const RECOMMENDED_ACTIONS = [
  "monitor",
  "investigate",
  "contact_driver",
  "block_card",
  "none",
] as const;
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

/** Structured output Claude must return (validated on receipt; invalid output is discarded). */
export const aiOutputSchema = z.object({
  risk_score: z.number().int().min(0).max(100),
  risk_level: z.enum(ANOMALY_SEVERITIES),
  location_assessment: z.object({
    plausible: z.boolean(),
    reason: z.string(),
    implied_speed_mph: z.number().nullable(),
  }),
  summary: z.string().min(1),
  recommended_action: z.enum(RECOMMENDED_ACTIONS),
  contributing_factors: z.array(z.string()),
  needs_deeper_review: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export type AiOutput = z.infer<typeof aiOutputSchema>;

/** Persisted AI verification row as the web reads it. */
export interface AiVerificationRecord {
  id: string;
  transaction_id: string;
  anomaly_id: string | null;
  model: string;
  risk_score: number;
  risk_level: AnomalySeverity;
  location_plausible: boolean | null;
  implied_speed_mph: number | null;
  summary: string;
  recommended_action: RecommendedAction;
  contributing_factors: string[];
  confidence: number | null;
  created_at: string;
}

/** Context assembled server-side (org-scoped, no cross-tenant data, no PII beyond internal ids). */
export interface AiVerificationContext {
  vehicle: { unit: string; fuel_type: string; tank_capacity_gal: number; baseline_mpg: number | null };
  transaction: {
    fueled_at: string;
    odometer: number | null;
    gallons: number;
    price_per_gal: number | null;
    total_cost: number | null;
    station: { name: string | null; city: string | null; state: string | null; lat: number | null; lng: number | null };
  };
  rules_fired: { ruleId: string; severity: string; message: string }[];
  recent_transactions: {
    fueled_at: string;
    city: string | null;
    state: string | null;
    lat: number | null;
    lng: number | null;
    miles: number | null;
    mpg: number | null;
  }[];
  /** Computed-in-code geo fact: implied mph from the previous station to this one (null if unknown). */
  implied_speed_mph: number | null;
  operating_hours: { start: string; end: string; tz: string };
}

// ── deterministic geo math ──────────────────────────────────────────────────
const EARTH_RADIUS_MI = 3958.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in miles between two lat/lng points. */
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Implied average speed (mph) to travel `miles` in `hours`; null if not computable. */
export function impliedSpeedMph(miles: number, hours: number): number | null {
  if (hours <= 0 || miles < 0) return null;
  return Math.round((miles / hours) * 10) / 10;
}

// ── cost / model selection (pure, testable) ─────────────────────────────────

/** First pass uses the fast model; escalate to the deep model for serious or uncertain cases. */
export function shouldEscalate(firstPass: Pick<AiOutput, "risk_level" | "needs_deeper_review">): boolean {
  return (
    firstPass.needs_deeper_review ||
    firstPass.risk_level === "high" ||
    firstPass.risk_level === "critical"
  );
}

const sevRank: Record<AnomalySeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/** Whether a transaction's anomalies warrant an AI pass (selective trigger: severity ≥ medium). */
export function shouldVerify(maxSeverity: AnomalySeverity | null): boolean {
  return maxSeverity != null && sevRank[maxSeverity] >= sevRank.medium;
}

/** Budget gate: true if there is still token budget left for the month (null budget = unlimited). */
export function withinBudget(usedTokens: number, monthlyBudget: number | null): boolean {
  return monthlyBudget == null || usedTokens < monthlyBudget;
}

/** Stable hash of the context for caching / dedup (FNV-1a over canonical JSON). */
export function aiInputHash(context: AiVerificationContext): string {
  const json = JSON.stringify(context);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
