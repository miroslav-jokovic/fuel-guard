import { ANOMALY_STATUSES, type AnomalyDisposition, type AnomalyStatus } from "./constants.js";
import type { AppSection } from "./auth.js";
import type { FindingKind } from "./findingAssignment.js";
import { FUEL_EXCEPTION_STATUSES, type FuelExceptionStatus } from "./fuelSpend/exceptions.js";

/**
 * One queue axis for two case models (C7a, proving D-FUI7). No screen — this is the module that makes
 * C7b small, and it is useless to a reader on its own.
 *
 * ── WHAT THE TWO MODELS SHARE, AND WHAT THEY DO NOT ─────────────────────────────────────────────
 * D-FX2 ruled that `fuel_exceptions` cannot be `anomalies` — `anomalies.transaction_id` is NOT NULL
 * and the reconciler's most valuable finding, a line the vendor billed that we hold no fill for, has
 * no transaction by definition. So the tables stay apart and the SURFACE unifies.
 *
 * What genuinely unifies is the WORKFLOW: where is this in the queue, how old is it, who has it.
 * What does not is what CLOSING MEANS. An anomaly closes with a **disposition** — was the flag right,
 * which is the ground truth the whole detection-accuracy programme is built on. A fuel exception
 * closes with **money** — credited, or a decision not to pursue. Flattening those into one status
 * enum is the design D-FUI7 exists to forbid, and §0.2 fact 4 is why the qualification is
 * load-bearing rather than fussy.
 *
 * ── THE TWO MAPPINGS THAT ARE WRONG, AND WHY THEY ARE UNREPRESENTABLE HERE ──────────────────────
 * D-FUI7 names them so nobody writes them: `resolved → credited` and `resolved → dismissed`. An
 * anomaly resolved as `confirmed` is a TRUE finding that recovered nothing — mapping it onto
 * `credited` would inflate the recovery figure with money nobody collected, and mapping it onto
 * `dismissed` would delete a true positive from the precision figure. Both corrupt a number the
 * product is judged on.
 *
 * They are unrepresentable rather than merely unwritten, and that is a deliberate shape: **there is
 * no function in this module from one source's status to the other's.** Each maps ONTO the shared
 * axis and back to its own vocabulary, never across. A future reader who wants
 * `anomalyStatusToExceptionStatus` has to add it, and will find this paragraph when they try.
 *
 * ── THE ONE CLEAN CORRESPONDENCE ────────────────────────────────────────────────────────────────
 * `superseded` and `resolved_by_reingest` are the same idea in two vocabularies: a later run over the
 * same period no longer found it, and NOBODY DECIDED ANYTHING. That is why `FindingClose` has a third
 * arm both sources share — it is the only place the two models legitimately meet, and giving it its
 * own arm is what stops it being smuggled in as a disposition or as a money outcome of zero.
 */

/**
 * The axis the inbox presents, filters and ages on.
 *
 * `working` is not decoration for symmetry: a fuel exception can be `disputed`, which is neither
 * "somebody is looking at it" nor "it is finished" — a claim is with the vendor and the clock that
 * matters is theirs. The anomaly model has no equivalent and simply never lands there, which is the
 * correct shape for an axis two models share: it is the union of what they need, not the
 * intersection, and a state one source cannot reach is empty rather than wrong.
 */
export const FINDING_QUEUE_STATES = ["open", "investigating", "working", "closed"] as const;
export type FindingQueueState = (typeof FINDING_QUEUE_STATES)[number];

export const FINDING_QUEUE_STATE_LABELS: Record<FindingQueueState, string> = {
  open: "Open",
  investigating: "Investigating",
  working: "With the vendor",
  closed: "Closed",
};

/** Total over `ANOMALY_STATUSES` — a new status cannot be added without deciding where it sits. */
export const ANOMALY_QUEUE_STATE: Record<AnomalyStatus, FindingQueueState> = {
  open: "open",
  investigating: "investigating",
  // All three anomaly closes are CLOSED on the axis. What separates them is the disposition behind
  // them, which the axis deliberately does not carry — that is the whole of D-FUI7.
  resolved: "closed",
  dismissed: "closed",
  superseded: "closed",
};

/** Total over `FUEL_EXCEPTION_STATUSES`, for the same reason. */
export const EXCEPTION_QUEUE_STATE: Record<FuelExceptionStatus, FindingQueueState> = {
  open: "open",
  investigating: "investigating",
  disputed: "working",
  credited: "closed",
  dismissed: "closed",
  resolved_by_reingest: "closed",
};

/**
 * Back the other way: which of a source's own statuses a queue state covers.
 *
 * This is the half a FILTER needs — "show me everything closed" has to become
 * `status in (resolved, dismissed, superseded)` against one table and a different triple against the
 * other. Derived from the maps above rather than listed, so the two directions cannot disagree.
 */
export const anomalyStatusesIn = (state: FindingQueueState): AnomalyStatus[] =>
  ANOMALY_STATUSES.filter((s) => ANOMALY_QUEUE_STATE[s] === state);

export const exceptionStatusesIn = (state: FindingQueueState): FuelExceptionStatus[] =>
  FUEL_EXCEPTION_STATUSES.filter((s) => EXCEPTION_QUEUE_STATE[s] === state);

/**
 * How a finding was closed — a discriminated union, never a flattened enum (D-FUI7).
 *
 * The discriminant is HOW the close was decided, not which table it came from, because that is the
 * distinction the reader acts on: a disposition answers "was the flag right", a money outcome answers
 * "did we get it back", and a reingest answers "it stopped being a finding and nobody decided".
 */
export type FindingClose =
  /** An anomaly. The accuracy programme's ground truth; carries no money and never will. */
  | { via: "disposition"; disposition: AnomalyDisposition }
  /** A fuel exception. `amountUsd` is null when the outcome is a decision not to pursue. */
  | { via: "money"; outcome: "credited" | "dismissed"; amountUsd: number | null }
  /** Both. `superseded` / `resolved_by_reingest`: a later run no longer found it. */
  | { via: "reingest" };

/**
 * The close of an anomaly, or null while it is still in the queue.
 *
 * ⚠ Returns a `disposition` arm or a `reingest` arm and CANNOT return a money one — the return type
 * says so, which is the mechanism that makes `resolved → credited` unrepresentable rather than merely
 * discouraged. A `resolved` case with no disposition recorded yet is `inconclusive`, which is the
 * value `ANOMALY_DISPOSITIONS` already defines as "couldn't be determined, excluded from precision";
 * inventing a fourth state for "closed but unlabelled" would put a row in the precision denominator
 * that has no ground truth.
 */
export function closeOfAnomaly(
  status: AnomalyStatus,
  disposition: AnomalyDisposition | null,
): Extract<FindingClose, { via: "disposition" | "reingest" }> | null {
  // An exhaustive switch rather than a lookup in the map above: it is TOTAL over the union, so a new
  // anomaly status is a compiler error here and not a silent null. That it agrees with the map is an
  // invariant a test asserts across the whole vocabulary, so the two cannot drift apart.
  switch (status) {
    case "open":
    case "investigating":
      return null;
    case "superseded":
      return { via: "reingest" };
    case "resolved":
    case "dismissed":
      return { via: "disposition", disposition: disposition ?? "inconclusive" };
  }
}

/**
 * The close of a fuel exception, or null while it is still in the queue.
 *
 * ⚠ The mirror of the above: a money arm or a reingest arm, never a disposition. An exception has no
 * ground truth to record — nobody asks whether an off-network premium was "really" one.
 */
export function closeOfException(
  status: FuelExceptionStatus,
  amountUsd: number | null,
): Extract<FindingClose, { via: "money" | "reingest" }> | null {
  switch (status) {
    case "open":
    case "investigating":
    case "disputed":
      return null;
    case "resolved_by_reingest":
      return { via: "reingest" };
    // `credited` carries what was actually recovered.
    case "credited":
      return { via: "money", outcome: "credited", amountUsd };
    // `dismissed` is a decision and carries NOTHING. Counting a dismissed finding's face value as
    // money is E3's whole complaint: identified, claimed and recovered are three numbers, never one.
    case "dismissed":
      return { via: "money", outcome: "dismissed", amountUsd: null };
  }
}

/**
 * The single row shape both producers satisfy (C7a element iii, given a consumer by C7b).
 *
 * ── WHY `amountUsd` IS ON THE ROW AND THE OUTCOME IS NOT ────────────────────────────────────────
 * This is the IDENTIFIED amount — what a finding is about — and it is null for an anomaly by
 * construction, because a theft case is an accusation about a person and has no face value. What was
 * RECOVERED lives in `close`, behind the money arm, and is reachable only for a source that can have
 * one. A reader summing `amountUsd` across a mixed inbox therefore sums exactly the exceptions, which
 * is the correct answer rather than a lucky one.
 *
 * ⚠ `occurredOn` is not the same fact on both sides, and pretending otherwise would be worse than
 * saying so. T1 gave `fuel_transactions` a stored station-local `business_date` and every fuel surface
 * moved onto it; `anomalies` was the one exception, and Q-FUI13 ruled (b) — Alerts stays on the
 * detection instant and nothing claims otherwise. So an anomaly's date here is derived from
 * `fueled_at` and can disagree with the ledger's business date by up to a day at a month boundary.
 * That is a recorded open question, not a defect introduced here.
 */
export interface FindingRow {
  id: string;
  source: FindingSource;
  kind: FindingKind;
  /** Derived from the kind — the section whose `manage` set may close this. See `findingAssignment`. */
  section: AppSection;
  queueState: FindingQueueState;
  /** The date the finding is ABOUT — see the warning above about what that means per source. */
  occurredOn: string | null;
  unitNumber: string | null;
  /** One line a reader can act on without opening the row. */
  summary: string;
  /** Money IDENTIFIED. Null for an anomaly, always. */
  amountUsd: number | null;
  assignedTo: string | null;
  /** When it first appeared, which is what an aging column counts from. */
  openedAt: string | null;
  close: FindingClose | null;
}

export type FindingSource = "anomaly" | "exception";

/** How old a finding is, in whole days, or null when it never recorded when it opened. */
export function findingAgeDays(row: Pick<FindingRow, "openedAt">, now: Date): number | null {
  if (!row.openedAt) return null;
  const opened = new Date(row.openedAt).getTime();
  if (!Number.isFinite(opened)) return null;
  return Math.max(0, Math.floor((now.getTime() - opened) / 86_400_000));
}
