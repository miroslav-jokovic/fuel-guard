import { ANOMALY_ALLOWED_TRANSITIONS, anomalyTransitionSchema, type AnomalyTransition } from "./anomaly.js";
import type { AnomalyDisposition } from "./constants.js";
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

/**
 * What the queue's incident drawer shows (chunk 8c3), as `GET /api/card-fraud-incidents/:id` returns it.
 * The card is its last four only: `card_ref` can hold the full number (0438), and it never leaves the API.
 */
export interface CardFraudIncidentDetail {
  id: string;
  status: CardFraudIncidentStatus;
  version: number;
  disposition: AnomalyDisposition | null;
  resolutionNote: string | null;
  cardLast4: string;
  unitNumber: string | null;
  openedAt: string;
  lastAttemptAt: string;
  level: "alert" | "escalated";
  attemptCount: number;
  fuelTaken: boolean;
  failedPrompts: Array<"odometer" | "driver_id">;
  places: Array<{ city: string | null; state: string | null; attempts: number; firstAt: string; lastAt: string }>;
  lastTruck: { at: string; city: string | null; state: string | null; milesToStation: number | null } | null;
  attempts: Array<{ source: "decline" | "fill"; attemptedAt: string; step: "opened" | "escalated" | "new_place" | null }>;
}

const place = (p: { city: string | null; state: string | null }): string => [p.city, p.state].filter(Boolean).join(", ");

/**
 * The incident in plain sentences, D-CF2's shape: where the card was tried, where the truck was, and what
 * else happened. Short words on purpose: office readers, English not their first language. Dates stay
 * out of these lines; the drawer shows them beside each attempt.
 */
export function incidentStory(d: CardFraudIncidentDetail): string[] {
  const where = d.places.map(place).filter(Boolean);
  const times = d.attemptCount === 1 ? "once" : `${d.attemptCount} times`;
  const lines = [`Card ••••${d.cardLast4} was tried ${times}${where.length ? ` in ${where.join(" and ")}` : ""}.`];
  if (d.lastTruck) {
    const truck = d.unitNumber ? `truck ${d.unitNumber}` : "the card's truck";
    const at = place(d.lastTruck);
    const miles = d.lastTruck.milesToStation == null ? "" : `, ${Math.round(d.lastTruck.milesToStation)} mi from the station`;
    lines.push(`Samsara had ${truck}${at ? ` in ${at}` : " somewhere else"}${miles}.`);
  }
  lines.push(d.fuelTaken ? "Fuel was taken." : "No fuel was taken.");
  for (const p of d.failedPrompts) lines.push(p === "odometer" ? "The odometer prompt failed." : "The driver ID prompt failed.");
  return lines;
}
