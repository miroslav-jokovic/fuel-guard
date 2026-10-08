import { CASE_RULE_ID } from "./anomalyRules/cases.js";
import { CARD_FRAUD_KIND, sectionOfFinding, type FindingKind } from "./findingAssignment.js";
import {
  ANOMALY_QUEUE_STATE,
  EXCEPTION_QUEUE_STATE,
  INCIDENT_QUEUE_STATE,
  closeOfAnomaly,
  closeOfException,
  closeOfIncident,
  type CardFraudIncidentStatus,
  type FindingRow,
} from "./findingQueue.js";
import { FUEL_EXCEPTION_KIND_LABELS, type FuelExceptionKind } from "./fuelSpend/exceptions.js";
import type { AnomalyDisposition, AnomalyStatus } from "./constants.js";
import type { FuelExceptionStatus } from "./fuelSpend/exceptions.js";

/**
 * The two producers, read into one row (C7b).
 *
 * Pure and in shared for the reason the whole C7a/C7b split exists: the mapping is the part that can
 * be wrong in a way nobody notices — a status landing in the wrong queue state, an anomaly acquiring
 * money — and a mapping that needs a database to test is a mapping nobody tests. The service that
 * calls these does I/O and nothing else.
 */

/** `anomalies`, as PostgREST returns the columns this needs. */
export interface AnomalyFindingRow {
  id: string;
  status: AnomalyStatus;
  disposition?: AnomalyDisposition | null;
  message?: string | null;
  fueled_at?: string | null;
  created_at?: string | null;
  assigned_to?: string | null;
  unit_number?: string | null;
}

/** `fuel_exceptions`, likewise. */
export interface ExceptionFindingRow {
  id: string;
  kind: FuelExceptionKind;
  status: FuelExceptionStatus;
  occurred_on?: string | null;
  amount?: number | string | null;
  credited_amount?: number | string | null;
  unit_number?: string | null;
  assigned_to?: string | null;
  first_seen_at?: string | null;
}

/** `card_fraud_incidents`, likewise (0438). */
export interface IncidentFindingRow {
  id: string;
  status: CardFraudIncidentStatus;
  disposition?: AnomalyDisposition | null;
  card_ref: string;
  opened_at: string;
  attempt_count: number;
  fuel_taken?: boolean | null;
  places?: Array<{ city?: string | null; state?: string | null }> | null;
  assigned_to?: string | null;
  unit_number?: string | null;
}

/** PostgREST hands `numeric` back as a string; null and unparseable both mean "no number". */
const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * A theft case as a finding.
 *
 * ⚠ `amountUsd` is hard-coded null and is not an oversight to be filled in later: an anomaly has no
 * face value, and a `confirmed` case is a true finding that recovered nothing. Giving it a number
 * here is the first half of the mistake D-FUI7 names, done in the mapper instead of the enum.
 */
export function findingFromAnomaly(row: AnomalyFindingRow): FindingRow {
  const kind = CASE_RULE_ID as FindingKind;
  return {
    id: row.id,
    source: "anomaly",
    kind,
    section: sectionOfFinding(kind),
    queueState: ANOMALY_QUEUE_STATE[row.status],
    // Q-FUI13 (b): the anomaly feed stays on the detection instant. Trimmed to a date so the two
    // sources sort together, and NOT relabelled as a business date, which it is not.
    occurredOn: (row.fueled_at ?? row.created_at)?.slice(0, 10) ?? null,
    unitNumber: row.unit_number ?? null,
    summary: row.message?.trim() || "Fuel anomaly",
    amountUsd: null,
    assignedTo: row.assigned_to ?? null,
    openedAt: row.created_at ?? null,
    close: closeOfAnomaly(row.status, row.disposition ?? null),
  };
}

/**
 * A ledger exception as a finding.
 *
 * The credited amount is read for the close and the IDENTIFIED amount for the row, which are
 * different numbers on purpose (E3): what a finding is worth and what came back are two figures, and
 * the one place they must never merge is a list somebody totals.
 */
export function findingFromException(row: ExceptionFindingRow): FindingRow {
  return {
    id: row.id,
    source: "exception",
    kind: row.kind,
    section: sectionOfFinding(row.kind),
    queueState: EXCEPTION_QUEUE_STATE[row.status],
    occurredOn: row.occurred_on ?? null,
    unitNumber: row.unit_number ?? null,
    summary: FUEL_EXCEPTION_KIND_LABELS[row.kind] ?? row.kind,
    amountUsd: num(row.amount),
    assignedTo: row.assigned_to ?? null,
    openedAt: row.first_seen_at ?? null,
    close: closeOfException(row.status, num(row.credited_amount)),
  };
}

/**
 * A card-fraud incident as a finding (CF2).
 *
 * The card is named by its last four only: `card_ref` can hold the full card number (0438, `cardFraudKey`),
 * and a list row is not a place for one. The place is the FIRST place the card was tried, where the
 * incident opened; the drawer (8c3) shows every place. `amountUsd` is null for the same reason as a
 * theft case's: an incident is about where a card was used, and it has no face value.
 */
export function findingFromIncident(row: IncidentFindingRow): FindingRow {
  const kind = CARD_FRAUD_KIND as FindingKind;
  const last4 = row.card_ref.replace(/\D/g, "").slice(-4) || "????";
  const first = row.places?.[0];
  const where = [first?.city, first?.state].filter(Boolean).join(", ");
  const tries = row.attempt_count === 1 ? "tried once" : `tried ${row.attempt_count} times`;
  return {
    id: row.id,
    source: "incident",
    kind,
    section: sectionOfFinding(kind),
    queueState: INCIDENT_QUEUE_STATE[row.status],
    occurredOn: row.opened_at.slice(0, 10),
    unitNumber: row.unit_number ?? null,
    summary: `Card ••••${last4} ${tries}${where ? ` in ${where}` : ""}${row.fuel_taken ? ", fuel taken" : ""}`,
    amountUsd: null,
    assignedTo: row.assigned_to ?? null,
    openedAt: row.opened_at,
    close: closeOfIncident(row.status, row.disposition ?? null),
  };
}

/**
 * Newest first, by the date the finding is about, with the id as the tie-break.
 *
 * The tie-break is not decoration: two sources merged in memory have no shared ordering, and without
 * one a page-two request can return a row page one already showed. An id is stable and arbitrary,
 * which is exactly what is wanted.
 */
export const byOccurredDesc = (a: FindingRow, b: FindingRow): number =>
  (b.occurredOn ?? "").localeCompare(a.occurredOn ?? "") || a.id.localeCompare(b.id);
