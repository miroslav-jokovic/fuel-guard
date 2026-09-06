import { CASE_RULE_ID } from "./anomalyRules/cases.js";
import { sectionOfFinding, type FindingKind } from "./findingAssignment.js";
import {
  ANOMALY_QUEUE_STATE,
  EXCEPTION_QUEUE_STATE,
  closeOfAnomaly,
  closeOfException,
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
 * Newest first, by the date the finding is about, with the id as the tie-break.
 *
 * The tie-break is not decoration: two sources merged in memory have no shared ordering, and without
 * one a page-two request can return a row page one already showed. An id is stable and arbitrary,
 * which is exactly what is wanted.
 */
export const byOccurredDesc = (a: FindingRow, b: FindingRow): number =>
  (b.occurredOn ?? "").localeCompare(a.occurredOn ?? "") || a.id.localeCompare(b.id);
