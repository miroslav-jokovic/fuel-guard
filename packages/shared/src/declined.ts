/**
 * Theft-attempt scoring for DECLINED fuel-card transactions (docs/09 §rejections). A decline can be an
 * attempt to steal: the card used where the truck isn't, tried repeatedly until it works, or declined at
 * one site then approved at another shortly after. We correlate these independent signals into a single
 * suspicion level — pure + testable; the API gathers the evidence and calls assessDecline().
 */

export type DeclineSignalKey =
  | "location_mismatch" // Samsara shows the truck was NOT at the decline's location
  | "approved_elsewhere" // declined here, then an approved fill on the same card elsewhere soon after
  | "repeated_declines" // same card declined several times in a short window (card testing)
  | "restricted_reason" // decline reason indicates a site/product/location restriction (weak)
  | "wrong_unit_number"; // EXONERATING: a different truck fueled at this station right after → likely a mis-typed unit #

export interface DeclineSignal {
  key: DeclineSignalKey;
  weight: number;
  detail: string;
}

export type SuspicionLevel = "clear" | "review" | "alert";

export interface DeclineAssessment {
  level: SuspicionLevel;
  score: number;
  reasons: DeclineSignal[];
}

const WEIGHTS: Record<DeclineSignalKey, number> = {
  location_mismatch: 80,
  approved_elsewhere: 75,
  repeated_declines: 55,
  restricted_reason: 30,
  wrong_unit_number: 0, // informational/exonerating — shown but never raises suspicion
};

/** A signal ≥ this raises an alert on its own. */
const OVERWHELMING = 75;
/** A single signal ≥ this is worth a review. */
const REVIEW = 50;
/** Two+ signals combining to ≥ this → alert. */
const ALERT_SCORE = 110;

export const declineSignalWeight = (key: DeclineSignalKey): number => WEIGHTS[key];

/** Does the decline reason text indicate a restriction (vs. a benign wrong-PIN / expired card)? */
export function isRestrictedDeclineReason(code: string | null, description: string | null): boolean {
  const t = `${code ?? ""} ${description ?? ""}`.toLowerCase();
  return /site|location|geofence|product|restrict|not allowed|unauthor|outside|limit exceed/.test(t);
}

/** Correlate decline signals into one suspicion level. Weak lone signals stay clear (no noise). */
export function assessDecline(reasons: DeclineSignal[]): DeclineAssessment {
  const all = reasons.slice().sort((a, b) => b.weight - a.weight);
  const scored = all.filter((r) => r.weight > 0);
  if (scored.length === 0) return { level: "clear", score: 0, reasons: all };

  const score = scored.reduce((s, r) => s + r.weight, 0);
  const top = scored[0]!.weight;

  let level: SuspicionLevel;
  if (top >= OVERWHELMING || (scored.length >= 2 && score >= ALERT_SCORE)) level = "alert";
  else if (top >= REVIEW) level = "review";
  else level = "clear";

  return { level, score, reasons: all };
}
