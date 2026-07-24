/**
 * Theft-attempt scoring for DECLINED fuel-card transactions (docs/09 §rejections). A decline can be an
 * attempt to steal: the card used where the truck isn't, tried repeatedly until it works, or declined at
 * one site then approved at another shortly after. We correlate these independent signals into a single
 * suspicion level — pure + testable; the API gathers the evidence and calls assessDecline().
 *
 * WP1: the decline REASON is no longer a single weak regex — it is classified by the taxonomy in
 * declineReason.ts, and EFS's own proximity verdict ("Merchant Position Too Far") is an alert-level
 * signal on its own. Card→truck assignment signals come from cardAssignment.ts.
 */
import { classifyDeclineReason } from "./declineReason.js";

export type DeclineSignalKey =
  | "location_mismatch" // Samsara shows the truck was NOT at the decline's location
  | "approved_elsewhere" // declined here, then an approved fill on the same card elsewhere soon after
  | "repeated_declines" // same card declined several times in a short window (card testing)
  | "restricted_reason" // decline reason indicates a site/product/location restriction (weak)
  | "proximity_failure" // EFS's telematics geofence declined it: card not with its truck (alert-grade)
  | "card_not_active" // inactive/expired card (informational; retries escalate via repeated_declines)
  | "card_assigned_mismatch" // card assigned to truck A used with pump unit B, neither/unknown at station
  | "stale_card_assignment" // EXONERATING: pump-unit truck WAS at the station → reassign the card record
  | "card_unit_typo" // EXONERATING: assigned truck WAS at the station → the pump unit was mis-keyed
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
  // ≥ OVERWHELMING: EFS already ran the telematics geofence at authorization; honor its verdict.
  proximity_failure: 85,
  card_not_active: 10,
  // Strong only when telematics POSITIVELY placed both trucks elsewhere (assessCardAssignment
  // "mismatch_confirmed"); the unverified variant is passed at a reduced weight by the caller.
  card_assigned_mismatch: 75,
  stale_card_assignment: 0, // informational/exonerating — fix the card record
  card_unit_typo: 0, // informational/exonerating — card is with its truck
  wrong_unit_number: 0, // informational/exonerating — shown but never raises suspicion
};

/** Weight for card_assigned_mismatch when telematics could NOT place either truck — corroboration
 *  only (below the lone-review threshold), so an unverified mismatch never raises a case alone. */
export const CARD_MISMATCH_UNVERIFIED_WEIGHT = 45;

/** A signal ≥ this raises an alert on its own. */
const OVERWHELMING = 75;
/** A single signal ≥ this is worth a review. */
const REVIEW = 50;
/** Two+ signals combining to ≥ this → alert. */
const ALERT_SCORE = 110;

export const declineSignalWeight = (key: DeclineSignalKey): number => WEIGHTS[key];

/**
 * Does the decline reason text indicate a restriction (vs. a benign wrong-PIN / expired card)?
 * Back-compat wrapper over the WP1 taxonomy (classifyDeclineReason) — restriction-grade categories
 * only; a proximity failure is MORE than a restriction and is handled as its own signal.
 */
export function isRestrictedDeclineReason(code: string | null, description: string | null): boolean {
  const c = classifyDeclineReason(code, description).category;
  return c === "site_restriction" || c === "limit";
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
