/**
 * Card fraud incidents — "a card used where its truck isn't", one incident per card (CF2,
 * docs/plans/fuel/CARD-FRAUD-ALERTS-PLAN.md D-CF1/D-CF2).
 *
 * WHY ONE INCIDENT AND NOT ONE ALERT PER ATTEMPT. The stolen card the week of 2026-09-22 (…27564)
 * produced nineteen declines in seven days; the four that mattered — South Bend, IN, while truck 729
 * was hundreds of miles south — each raised its own alert, each one a line among ~1,290 notifications
 * in a fortnight. A person needs ONE thing that says "this card is being tried where its truck is
 * not", that grows as the attempts do, and that interrupts them again only when something new
 * happens: a new place, a return to the same place hours later, a failed pump prompt (the thief does
 * not know the odometer or the driver ID), or fuel actually leaving the pump.
 *
 * WHAT QUALIFIES is decided upstream, not here: a decline whose scorer kept the `location_mismatch`
 * signal (Samsara put the card's truck away from the station AND no fill by the same truck there
 * explained it — the `wrong_unit_number` exoneration), or an approved fill Samsara places away from
 * its station. Over 2026-09-02..10-02 that is exactly 13 declines on 5 cards. Everything else EFS
 * Secure Fueling already refused, or is a note (D-CF3).
 *
 * Pure: no clock, no I/O. The reducer is what the scorer calls per attempt; the fold is the same
 * reducer over history, so a re-score and a live score cannot disagree.
 */
import { isFullCardNumber } from "./cardAssignment.js";
import { formatDisplayDateTime } from "./displayDate.js";
import type { DeclineReasonCategory } from "./declineReason.js";

/** An attempt joins the card's open incident when it comes within this long of the last attempt. */
export const CARD_FRAUD_JOIN_HOURS = 72;
/** A repeat at a place already in the incident interrupts again only after this long a gap there. */
export const CARD_FRAUD_RETURN_HOURS = 6;

/** The EFS pump prompts a stolen card fails on. Read from "INVALID INFORMATION|ODOMETER|1". */
export type FailedPrompt = "odometer" | "driver_id" | "unit_number";

const PROMPTS: Array<[RegExp, FailedPrompt]> = [
  [/^ODOMETER\b/, "odometer"],
  [/^DRIVER\s*ID\b/, "driver_id"],
  [/^UNIT\s*NUMBE?R?\b/, "unit_number"],
];

/**
 * The prompt an `invalid_info` decline failed, from the description's second field. Production
 * carries `UNIT NUMBER` ×58, `ODOMETER` ×10 (three with a trailing `IN…` reference) and `DRIVER ID`
 * ×3 (2026-10-02); anything else is not a prompt we can name, and is null.
 */
export function failedPromptOf(description: string | null | undefined): FailedPrompt | null {
  const field = (description ?? "").split("|")[1]?.trim().toUpperCase() ?? "";
  for (const [re, p] of PROMPTS) if (re.test(field)) return p;
  return null;
}

/**
 * Which card an attempt belongs to. A full card number names the card. A masked one does not — two
 * cards can share the last four — so it is only trusted together with the truck, which keeps a
 * masked ref from welding two different cards' attempts into one incident.
 */
export function cardFraudKey(cardRef: string, vehicleId: string | null): string {
  return isFullCardNumber(cardRef) ? cardRef.trim() : `${cardRef.trim()}|${vehicleId ?? "?"}`;
}

/** Where the card's truck was, as CF1 measured it (truckPositionAt). */
export interface FraudTruckPosition {
  at: string;
  city: string | null;
  state: string | null;
  milesToStation: number | null;
}

export interface FraudAttempt {
  /** The decline's or fill's id; the incident remembers which attempts it holds. */
  id: string;
  source: "decline" | "fill";
  at: string;
  cardRef: string;
  vehicleId: string | null;
  unit: string | null;
  city: string | null;
  state: string | null;
  /** The decline's parsed reason; null for a fill. */
  reason: DeclineReasonCategory | null;
  failedPrompt: FailedPrompt | null;
  truck: FraudTruckPosition | null;
}

export interface FraudPlace {
  city: string | null;
  state: string | null;
  attempts: number;
  firstAt: string;
  lastAt: string;
}

/** What is new about an attempt — the reason it interrupts someone. In priority order. */
export type FraudStep = "opened" | "fuel_taken" | "new_place" | "returned" | "failed_prompt" | "inactive_card";
const STEP_PRIORITY: FraudStep[] = ["opened", "fuel_taken", "new_place", "returned", "failed_prompt", "inactive_card"];

export interface FraudIncident {
  key: string;
  cardRef: string;
  vehicleId: string | null;
  unit: string | null;
  openedAt: string;
  lastAttemptAt: string;
  attemptIds: string[];
  places: FraudPlace[];
  failedPrompts: FailedPrompt[];
  /** At least one attempt was APPROVED: fuel left the pump where the truck was not. */
  fuelTaken: boolean;
  sawInactiveCard: boolean;
  /** The most recent position of the truck we measured, for the sentence. */
  lastTruck: FraudTruckPosition | null;
  /** Every step taken, in order; its index is the notification's dedupe step. */
  steps: Array<{ step: FraudStep; at: string; attemptId: string }>;
  /** A closed incident (resolved or dismissed by a person) is never joined; a new one opens. */
  closed: boolean;
}

export interface ApplyResult {
  incident: FraudIncident;
  /** The step this attempt took, or null when it is more of the same (no new notification). */
  step: FraudStep | null;
  /** true when the attempt was already in the incident — a re-score is a no-op. */
  duplicate: boolean;
}

const H = 3_600_000;
const placeKey = (city: string | null, state: string | null) => `${(city ?? "").trim().toUpperCase()}|${(state ?? "").trim().toUpperCase()}`;

function opened(a: FraudAttempt): FraudIncident {
  return {
    key: `${cardFraudKey(a.cardRef, a.vehicleId)}@${a.id}`,
    cardRef: a.cardRef,
    vehicleId: a.vehicleId,
    unit: a.unit,
    openedAt: a.at,
    lastAttemptAt: a.at,
    attemptIds: [a.id],
    places: [{ city: a.city, state: a.state, attempts: 1, firstAt: a.at, lastAt: a.at }],
    failedPrompts: a.failedPrompt ? [a.failedPrompt] : [],
    fuelTaken: a.source === "fill",
    sawInactiveCard: a.reason === "card_not_active",
    lastTruck: a.truck,
    steps: [{ step: "opened", at: a.at, attemptId: a.id }],
    closed: false,
  };
}

/**
 * Apply one qualifying attempt to the card's latest incident (or to none). Opens a new incident when
 * there is none, it is closed, or the attempt comes more than CARD_FRAUD_JOIN_HOURS after its last
 * one. Otherwise the attempt joins, and takes at most ONE step — the highest-priority thing new about
 * it — so one attempt can never send two messages.
 *
 * Attempts must arrive in time order per card (the fold sorts; the live scorer scores an import's
 * rows in `declined_at` order). An attempt older than the incident's last one still joins, but takes
 * no step: it is history arriving late, not something happening now.
 */
export function applyFraudAttempt(current: FraudIncident | null, a: FraudAttempt): ApplyResult {
  if (current && current.attemptIds.includes(a.id)) return { incident: current, step: null, duplicate: true };
  const t = Date.parse(a.at);
  if (!current || current.closed || t - Date.parse(current.lastAttemptAt) > CARD_FRAUD_JOIN_HOURS * H) {
    return { incident: opened(a), step: "opened", duplicate: false };
  }

  const late = t < Date.parse(current.lastAttemptAt);
  const key = placeKey(a.city, a.state);
  const place = current.places.find((p) => placeKey(p.city, p.state) === key);
  const candidates: FraudStep[] = [];
  if (a.source === "fill" && !current.fuelTaken) candidates.push("fuel_taken");
  if (!place) candidates.push("new_place");
  else if (t - Date.parse(place.lastAt) >= CARD_FRAUD_RETURN_HOURS * H) candidates.push("returned");
  if (a.failedPrompt && current.failedPrompts.length === 0) candidates.push("failed_prompt");
  if (a.reason === "card_not_active" && !current.sawInactiveCard) candidates.push("inactive_card");
  const step = late ? null : (STEP_PRIORITY.find((s) => candidates.includes(s)) ?? null);

  const places = place
    ? current.places.map((p) =>
        p === place
          ? { ...p, attempts: p.attempts + 1, firstAt: a.at < p.firstAt ? a.at : p.firstAt, lastAt: a.at > p.lastAt ? a.at : p.lastAt }
          : p,
      )
    : [...current.places, { city: a.city, state: a.state, attempts: 1, firstAt: a.at, lastAt: a.at }];
  const incident: FraudIncident = {
    ...current,
    lastAttemptAt: late ? current.lastAttemptAt : a.at,
    attemptIds: [...current.attemptIds, a.id],
    places,
    failedPrompts: a.failedPrompt && !current.failedPrompts.includes(a.failedPrompt) ? [...current.failedPrompts, a.failedPrompt] : current.failedPrompts,
    fuelTaken: current.fuelTaken || a.source === "fill",
    sawInactiveCard: current.sawInactiveCard || a.reason === "card_not_active",
    lastTruck: !late && a.truck ? a.truck : current.lastTruck,
    steps: step ? [...current.steps, { step, at: a.at, attemptId: a.id }] : current.steps,
  };
  return { incident, step, duplicate: false };
}

/** The reducer over a card's history — what a re-score produces, and what the tests pin. */
export function foldFraudAttempts(attempts: FraudAttempt[]): FraudIncident[] {
  const byCard = new Map<string, FraudAttempt[]>();
  for (const a of attempts) {
    const k = cardFraudKey(a.cardRef, a.vehicleId);
    byCard.set(k, [...(byCard.get(k) ?? []), a]);
  }
  const out: FraudIncident[] = [];
  for (const list of byCard.values()) {
    let cur: FraudIncident | null = null;
    for (const a of [...list].sort((x, y) => x.at.localeCompare(y.at) || x.id.localeCompare(y.id))) {
      const r = applyFraudAttempt(cur, a);
      if (cur && r.incident.key !== cur.key) out.push(cur);
      cur = r.incident;
    }
    if (cur) out.push(cur);
  }
  return out.sort((x, y) => x.openedAt.localeCompare(y.openedAt));
}

const PROMPT_WORDS: Record<FailedPrompt, string> = { odometer: "odometer", driver_id: "driver ID", unit_number: "unit number" };
const title = (s: string | null) => (s ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null);
const placeName = (p: { city: string | null; state: string | null }) =>
  [title(p.city), p.state?.toUpperCase() ?? null].filter(Boolean).join(", ") || "an unknown station";
const cardTail = (ref: string) => `…${ref.replace(/\D/g, "").slice(-5) || ref.slice(-5)}`;

/**
 * The words a person reads — in the bell, the email and the text message. Plain sentences, every
 * number with its source and time (D-CF2; CF7's register). Kept under ~300 characters so one SMS
 * segment pair carries it whole.
 */
export function describeFraudIncident(i: FraudIncident, timeZone: string): { title: string; body: string } {
  const truck = i.unit ? `truck ${i.unit}` : "its truck";
  const tries = i.attemptIds.length;
  const where = i.places.slice(0, 2).map(placeName).join(" and ") + (i.places.length > 2 ? ` and ${i.places.length - 2} more` : "");
  const head = i.fuelTaken
    ? `Card ${cardTail(i.cardRef)} bought fuel in ${where} while ${truck} was elsewhere.`
    : `Card ${cardTail(i.cardRef)} was tried ${tries} time${tries === 1 ? "" : "s"} in ${where}, where ${truck} was not.`;
  const t = i.lastTruck;
  const seen = t
    ? ` Samsara had ${truck} in ${placeName(t)} at ${formatDisplayDateTime(t.at, "", timeZone)}${t.milesToStation != null ? `, ${Math.round(t.milesToStation)} mi away` : ""}.`
    : "";
  const prompt = i.failedPrompts.length ? ` It failed the ${i.failedPrompts.map((p) => PROMPT_WORDS[p]).join(" and ")} prompt.` : "";
  return {
    title: i.fuelTaken ? `Fuel bought on card ${cardTail(i.cardRef)} away from its truck` : `Card ${cardTail(i.cardRef)} used away from its truck`,
    body: `${head}${seen}${prompt}`,
  };
}
