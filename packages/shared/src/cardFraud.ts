import { isFullCardNumber } from "./cardAssignment.js";
import type { DeclineReasonCategory } from "./declineReason.js";

/**
 * Card fraud incidents: "a card used where its truck isn't", one incident per card (CF2;
 * docs/plans/fuel/CARD-FRAUD-ALERTS-PLAN.md D-CF1/D-CF2; F02-F04 PLAN.md chunk 5a).
 *
 * WHY ONE INCIDENT AND NOT ONE ALERT PER ATTEMPT. Over 2026-09-02..10-02, 13 declines kept the
 * scorer's `location_mismatch` signal, on 5 cards. Each raised its own alert among ~1,290
 * notifications in a fortnight, and the stolen card (…27564, South Bend, IN, while truck 729 was in
 * the south) went unanswered. A person needs ONE thing per card that grows with the attempts and
 * interrupts again only when something new happens.
 *
 * WHAT QUALIFIES (D-CF1) is decided here, so the fold and the live scorer cannot disagree: Samsara put
 * the card's truck AWAY from the station (`samsaraAtStation === false`, not merely unknown), and no
 * fill by that truck at that station explains it (the scorer's `wrong_unit_number` exoneration,
 * `declinedScoring.ts`). EFS's own "Merchant Position Too Far" does not qualify on its own: the four
 * such declines of 09-07..09-22 (Avoca, Vandalia, Bowman, Corbin) had Samsara placing the truck at
 * the station, and each was followed by a good fill from the same truck 6–85 minutes later (D-CF6).
 *
 * Pure: no clock, no I/O. `applyFraudAttempt` is what a scorer calls per attempt; `foldFraudAttempts`
 * is the same reducer over history, so a re-score and a live score produce the same incidents.
 */

/** An attempt joins the card's open incident when it comes within this long of the last attempt. */
export const CARD_FRAUD_JOIN_HOURS = 72;

/**
 * A repeat at a place the incident already holds escalates only after this long a gap there. EFS
 * reports one pump session as several rows in the same minute (South Bend 09-22 19:24 ×2, Franklin
 * 09-26 03:47 ×2, Jacksonville 09-11 10:01 ×2); those are one try, not a return. The real returns
 * measured were 11 h (Jacksonville) and 19 h (Franklin) later. Any value between a few minutes and
 * 11 h separates them; 6 h is a choice inside that range, not a measurement.
 */
export const CARD_FRAUD_RETURN_HOURS = 6;

/**
 * The EFS pump prompts a thief fails, because only the driver knows them (D-CF2). Read from the
 * description's second field ("INVALID INFORMATION|ODOMETER|171662 IN0851404194||"). UNIT NUMBER is
 * deliberately absent: it is the everyday typo (58 rows on production 2026-10-02), not a sign.
 */
export type FailedPrompt = "odometer" | "driver_id";

const PROMPTS: Array<[RegExp, FailedPrompt]> = [
  [/^ODOMETER\b/, "odometer"],
  [/^DRIVER\s*ID\b/, "driver_id"],
];

export function failedPromptOf(description: string | null | undefined): FailedPrompt | null {
  const field = (description ?? "").split("|")[1]?.trim().toUpperCase() ?? "";
  for (const [re, p] of PROMPTS) if (re.test(field)) return p;
  return null;
}

/**
 * Which card an attempt belongs to. A full card number names the card. A masked one does not, since
 * two cards can share the last four (AUDIT N7: 246 of 309), so it only counts together with the truck.
 */
export function cardFraudKey(cardRef: string, vehicleId: string | null): string {
  return isFullCardNumber(cardRef) ? cardRef.trim() : `${cardRef.trim()}|${vehicleId ?? "?"}`;
}

/** Where the card's truck was, as CF1 measured it (`declined_txn_scores.truck_*`). */
export interface FraudTruckPosition {
  at: string;
  city: string | null;
  state: string | null;
  milesToStation: number | null;
}

export interface FraudAttempt {
  /** The decline's or the fill's id; the incident remembers which attempts it holds. */
  id: string;
  source: "decline" | "fill";
  at: string;
  cardRef: string;
  vehicleId: string | null;
  city: string | null;
  state: string | null;
  /** Samsara's verdict on the card's truck at the station: false = away, null = could not tell. */
  samsaraAtStation: boolean | null;
  /** A fill by the same truck at the same station explains the attempt (`wrong_unit_number`). */
  explainedByFill: boolean;
  /** The decline's parsed reason; null for a fill. */
  reason: DeclineReasonCategory | null;
  failedPrompt: FailedPrompt | null;
  truck: FraudTruckPosition | null;
}

/** D-CF1: the one rule that turns an attempt into fraud evidence. */
export function opensFraudIncident(a: Pick<FraudAttempt, "samsaraAtStation" | "explainedByFill">): boolean {
  return a.samsaraAtStation === false && !a.explainedByFill;
}

export interface FraudPlace {
  city: string | null;
  state: string | null;
  attempts: number;
  firstAt: string;
  lastAt: string;
}

/**
 * The moments that interrupt a person (D-CF2): the incident opens, it escalates, or the card turns up
 * at a new place. One notification per step; a step's index is its dedupe key in CF4.
 */
export type FraudStep = "opened" | "escalated" | "new_place";

export interface FraudIncident {
  key: string;
  cardRef: string;
  vehicleId: string | null;
  openedAt: string;
  lastAttemptAt: string;
  /** "escalated" once any attempt is a sign beyond the location itself; it never goes back down. */
  level: "alert" | "escalated";
  attemptIds: string[];
  places: FraudPlace[];
  failedPrompts: FailedPrompt[];
  /** An APPROVED fill joined: fuel left the pump where the truck was not. */
  fuelTaken: boolean;
  lastTruck: FraudTruckPosition | null;
  steps: Array<{ step: FraudStep; at: string; attemptId: string }>;
  /** A person resolved or dismissed it. A closed incident is never joined; a new one opens. */
  closed: boolean;
}

export interface ApplyResult {
  /** null when the attempt does not qualify and there was no incident to begin with. */
  incident: FraudIncident | null;
  /** The step this attempt took, or null when it is more of the same (no new notification). */
  step: FraudStep | null;
}

const H = 3_600_000;
const placeKey = (city: string | null, state: string | null) =>
  `${(city ?? "").trim().toUpperCase()}|${(state ?? "").trim().toUpperCase()}`;

/**
 * D-CF2's escalation signs, plus fuel actually taken. D-CF2 lists a failed odometer or driver-ID
 * prompt, an attempt on a deactivated card, and a repeat at the same far-away place. An approved fill
 * is added here: D-CF1 lets a fill join an incident, and without this a fill at a place the incident
 * already holds would interrupt nobody, though it is the one attempt where fuel was lost.
 */
function escalates(a: FraudAttempt, returned: boolean): boolean {
  return a.failedPrompt != null || a.reason === "card_not_active" || a.source === "fill" || returned;
}

function opened(a: FraudAttempt): FraudIncident {
  return {
    key: `${cardFraudKey(a.cardRef, a.vehicleId)}@${a.id}`,
    cardRef: a.cardRef,
    vehicleId: a.vehicleId,
    openedAt: a.at,
    lastAttemptAt: a.at,
    level: escalates(a, false) ? "escalated" : "alert",
    attemptIds: [a.id],
    places: [{ city: a.city, state: a.state, attempts: 1, firstAt: a.at, lastAt: a.at }],
    failedPrompts: a.failedPrompt ? [a.failedPrompt] : [],
    fuelTaken: a.source === "fill",
    lastTruck: a.truck,
    steps: [{ step: "opened", at: a.at, attemptId: a.id }],
    closed: false,
  };
}

/**
 * Apply one attempt to the card's latest incident (or to none). An attempt that does not qualify
 * (D-CF1) changes nothing. A qualifying one opens a new incident when there is none, it is closed, or
 * the attempt comes more than CARD_FRAUD_JOIN_HOURS after its last one. Otherwise it joins and takes
 * at most ONE step, escalation before a new place, so one attempt never sends two messages.
 *
 * An attempt already in the incident is a re-score: a no-op. An attempt older than the incident's
 * last one joins but takes no step: it is history arriving late, not something happening now.
 */
export function applyFraudAttempt(current: FraudIncident | null, a: FraudAttempt): ApplyResult {
  if (!opensFraudIncident(a)) return { incident: current, step: null };
  if (current && current.attemptIds.includes(a.id)) return { incident: current, step: null };
  const t = Date.parse(a.at);
  if (!current || current.closed || t - Date.parse(current.lastAttemptAt) > CARD_FRAUD_JOIN_HOURS * H) {
    return { incident: opened(a), step: "opened" };
  }

  const late = t < Date.parse(current.lastAttemptAt);
  const key = placeKey(a.city, a.state);
  const place = current.places.find((p) => placeKey(p.city, p.state) === key);
  const returned = place != null && t - Date.parse(place.lastAt) >= CARD_FRAUD_RETURN_HOURS * H;
  const level = current.level === "escalated" || escalates(a, returned) ? "escalated" : "alert";
  const step: FraudStep | null = late
    ? null
    : level !== current.level
      ? "escalated"
      : !place
        ? "new_place"
        : null;

  const places = place
    ? current.places.map((p) =>
        p === place
          ? {
              ...p,
              attempts: p.attempts + 1,
              firstAt: a.at < p.firstAt ? a.at : p.firstAt,
              lastAt: a.at > p.lastAt ? a.at : p.lastAt,
            }
          : p,
      )
    : [...current.places, { city: a.city, state: a.state, attempts: 1, firstAt: a.at, lastAt: a.at }];
  const incident: FraudIncident = {
    ...current,
    lastAttemptAt: late ? current.lastAttemptAt : a.at,
    level,
    attemptIds: [...current.attemptIds, a.id],
    places,
    failedPrompts:
      a.failedPrompt && !current.failedPrompts.includes(a.failedPrompt)
        ? [...current.failedPrompts, a.failedPrompt]
        : current.failedPrompts,
    fuelTaken: current.fuelTaken || a.source === "fill",
    lastTruck: !late && a.truck ? a.truck : current.lastTruck,
    steps: step ? [...current.steps, { step, at: a.at, attemptId: a.id }] : current.steps,
  };
  return { incident, step };
}

/** The reducer over history: what a re-score produces, and what the tests pin. Order-independent. */
export function foldFraudAttempts(attempts: readonly FraudAttempt[]): FraudIncident[] {
  const byCard = new Map<string, FraudAttempt[]>();
  for (const a of attempts) {
    const k = cardFraudKey(a.cardRef, a.vehicleId);
    byCard.set(k, [...(byCard.get(k) ?? []), a]);
  }
  const out: FraudIncident[] = [];
  for (const list of byCard.values()) {
    let cur: FraudIncident | null = null;
    for (const a of [...list].sort((x, y) => x.at.localeCompare(y.at) || x.id.localeCompare(y.id))) {
      const next: FraudIncident | null = applyFraudAttempt(cur, a).incident;
      if (cur && next && next.key !== cur.key) out.push(cur);
      cur = next;
    }
    if (cur) out.push(cur);
  }
  return out.sort((x, y) => x.openedAt.localeCompare(y.openedAt) || x.key.localeCompare(y.key));
}
