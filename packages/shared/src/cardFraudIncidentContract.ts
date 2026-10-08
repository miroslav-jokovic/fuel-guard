import { ANOMALY_ALLOWED_TRANSITIONS, anomalyTransitionSchema, type AnomalyTransition } from "./anomaly.js";
import { CARD_FRAUD_INCIDENT_STATUSES, type CardFraudIncidentStatus } from "./findingQueue.js";

/**
 * Moving a card-fraud incident through its workflow (F02-F04 PLAN.md chunk 8c2).
 *
 * An incident closes the way a fill case does: a person investigates it, then resolves or dismisses it
 * with a note and a disposition (was the flag right), and may reopen it. 0438 gave incidents 0034's
 * words for exactly this, so the request and the transitions are DERIVED from the fill case's rather
 * than restated. The one difference is that an incident has no `superseded`: nothing re-scores it away.
 */

const isIncidentStatus = (t: string): t is CardFraudIncidentStatus =>
  (CARD_FRAUD_INCIDENT_STATUSES as readonly string[]).includes(t);
const derived = (s: CardFraudIncidentStatus): readonly CardFraudIncidentStatus[] =>
  ANOMALY_ALLOWED_TRANSITIONS[s].filter(isIncidentStatus);

/** The fill case's transitions, restricted to the statuses an incident can hold. Total over the statuses. */
export const INCIDENT_ALLOWED_TRANSITIONS: Record<CardFraudIncidentStatus, readonly CardFraudIncidentStatus[]> = {
  open: derived("open"),
  investigating: derived("investigating"),
  resolved: derived("resolved"),
  dismissed: derived("dismissed"),
};

export function isIncidentTransitionAllowed(from: CardFraudIncidentStatus, to: CardFraudIncidentStatus): boolean {
  return INCIDENT_ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** The same request as a fill case's: target status, a note and a disposition to close, the version read. */
export const cardFraudIncidentTransitionSchema = anomalyTransitionSchema;
export type CardFraudIncidentTransition = AnomalyTransition;
