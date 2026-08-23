import { z } from "zod";
import { DQ_ITEMS } from "./dqCatalogue.js";

/**
 * Hiring an applicant — the Recruitment → DQF handoff (HIRING-PLAN.md H8, D-HIRE2).
 *
 * ── WHAT THE HANDOFF ACTUALLY IS, WHICH IS LESS THAN IT SOUNDS ─────────────────────────────────
 * D-HIRE5 made an applicant a `drivers` row with `status = 'applicant'` rather than a separate
 * table, and that decision pays out here: the PSP report, the scans and any qualification records
 * Recruitment gathered are ALREADY filed against this driver id. Nothing is copied, moved or
 * re-keyed on hire, and a handoff that moved rows between tables would be the design that loses one.
 *
 * What is genuinely missing is a PROJECTION. `driver_employment_history` carries the §391.23(a)(2)
 * inquiry state as three columns on a mutable transcription row — sent on this date, answered on
 * that one. §391.51(b) wants those as dated, append-only evidence. So the handoff writes the
 * `previous_employer_inquiry` and `previous_employer_response` records the inquiry columns imply,
 * and changes nothing else.
 *
 * ── THE RULE THAT DECIDES EVERY EDGE CASE: NEVER INVENT A DATE ─────────────────────────────────
 * An evidence row is dated, and `occurred_on` is NOT NULL. A history row saying `sent` with no
 * `inquiry_sent_on` is incomplete data, and the two available answers are to file it under a date
 * nobody recorded or to leave it out and say so. Filing it dated today would put a false fact in a
 * §391.51 file — the one place a wrong date is worse than a missing row — so the handoff reports it
 * instead. Every `skipped` entry is something a person can go and fix.
 *
 * Pure: no database, no clock. `today` and the rows come in as arguments.
 */

export const HIRE_HANDOFF_SOURCE = "recruitment_handoff";

/**
 * A start date more than a year out is a typo, not a plan.
 *
 * The bound exists because `hire_date` is load-bearing twice over: `employmentCoverage` measures the
 * §391.21(b)(10) three-year window back from it, so a wrong year silently re-judges the applicant's
 * whole employment history, and §391.51(c) counts retention from the end of employment. A date the
 * operator can see is wrong is cheaper to refuse than to correct afterwards.
 */
export const HIRE_DATE_MAX_FUTURE_DAYS = 365;

export const hireApplicantSchema = z.object({
  driver_id: z.uuid(),
  /** The date employment begins — not the date the decision was made. */
  hire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
  note: z.string().max(1000).nullish(),
});
export type HireApplicant = z.infer<typeof hireApplicantSchema>;

export interface HireIssue {
  field: string;
  message: string;
}

const DAY_MS = 86_400_000;

export function validateHireRequest(input: HireApplicant, today: string): HireIssue[] {
  const days = (Date.parse(`${input.hire_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS;
  if (!Number.isFinite(days)) {
    return [{ field: "hire_date", message: "That is not a date" }];
  }
  if (days > HIRE_DATE_MAX_FUTURE_DAYS) {
    return [{
      field: "hire_date",
      message: `A hire date more than ${HIRE_DATE_MAX_FUTURE_DAYS} days out is almost certainly a typo`,
    }];
  }
  return [];
}

/** One employer as the transcription holds it — the columns the projection reads, and no others. */
export interface HandoffEmployment {
  id: string;
  employerName: string;
  usdotNumber: string | null;
  dotRegulated: boolean;
  inquiryStatus: "not_required" | "pending" | "sent" | "responded" | "no_response";
  inquirySentOn: string | null;
  inquiryResponseOn: string | null;
}

/** An existing §391.51 record, read only to answer "has this already been filed". */
export interface HandoffExistingRecord {
  kind: string;
  detail: Record<string, unknown> | null;
}

export interface HandoffRecordDraft {
  kind: "previous_employer_inquiry" | "previous_employer_response";
  occurredOn: string;
  result: string | null;
  performedBy: string;
  reference: string | null;
  detail: Record<string, unknown>;
}

export type HandoffSkipReason =
  /** The inquiry was never sent — §391.23(a)(2) is still owed. */
  | "inquiry_not_sent"
  /** Marked sent, with no date to file it under. */
  | "undated_inquiry"
  /** Marked answered, with no date to file it under. */
  | "undated_response"
  /** A record for this employer is already in the file — a replay, not a duplicate. */
  | "already_filed";

export interface HandoffSkip {
  employmentId: string;
  employerName: string;
  reason: HandoffSkipReason;
}

export const HANDOFF_SKIP_LABELS: Record<HandoffSkipReason, string> = {
  inquiry_not_sent: "No safety-history inquiry has been sent yet",
  undated_inquiry: "Marked sent, but with no date — add the date it went out",
  undated_response: "Marked answered, but with no date — add the date it came back",
  already_filed: "Already in the qualification file",
};

export interface HireHandoffPlan {
  records: HandoffRecordDraft[];
  skipped: HandoffSkip[];
}

const alreadyFiled = (
  existing: readonly HandoffExistingRecord[],
  kind: string,
  employmentId: string,
): boolean =>
  existing.some((r) => r.kind === kind && r.detail?.["employment_id"] === employmentId);

/**
 * What hiring this applicant will file, and what it will not.
 *
 * ── NO WINDOW FILTER, DELIBERATELY ─────────────────────────────────────────────────────────────
 * §391.23(a)(2) obliges the inquiry for the three years preceding the application, and
 * `employmentCoverage` is where that window lives. This function does not apply it: an inquiry that
 * was actually sent to a fourth-year employer is evidence that exists, and declining to file it
 * would lose a real document to a rule about which documents are REQUIRED. What is owed and what is
 * held are different questions, and only the first one is windowed.
 *
 * `not_required` employers (not DOT-regulated) produce nothing and are not reported as skipped —
 * there is no obligation to report the absence of.
 */
export function planHireHandoff(input: {
  employment: readonly HandoffEmployment[];
  existing: readonly HandoffExistingRecord[];
}): HireHandoffPlan {
  const records: HandoffRecordDraft[] = [];
  const skipped: HandoffSkip[] = [];

  for (const e of input.employment) {
    if (e.inquiryStatus === "not_required" || !e.dotRegulated) continue;
    const where = { employmentId: e.id, employerName: e.employerName };

    if (e.inquiryStatus === "pending") {
      skipped.push({ ...where, reason: "inquiry_not_sent" });
      continue;
    }

    const detail = {
      employment_id: e.id,
      employer_name: e.employerName,
      usdot_number: e.usdotNumber,
      source: HIRE_HANDOFF_SOURCE,
    };

    if (alreadyFiled(input.existing, "previous_employer_inquiry", e.id)) {
      skipped.push({ ...where, reason: "already_filed" });
    } else if (!e.inquirySentOn) {
      skipped.push({ ...where, reason: "undated_inquiry" });
    } else {
      records.push({
        kind: "previous_employer_inquiry",
        occurredOn: e.inquirySentOn,
        result: null,
        performedBy: e.employerName,
        reference: e.usdotNumber,
        detail,
      });
    }

    if (e.inquiryStatus === "sent") continue; // Nothing has come back yet — nothing to file.

    if (alreadyFiled(input.existing, "previous_employer_response", e.id)) {
      // Not reported twice: the inquiry half above already said "already filed" for this employer.
      continue;
    }
    if (!e.inquiryResponseOn) {
      skipped.push({ ...where, reason: "undated_response" });
      continue;
    }
    records.push({
      kind: "previous_employer_response",
      occurredOn: e.inquiryResponseOn,
      // §391.23(d) lets a carrier rely on a documented NON-response, so this is a result, not a
      // failure. The catalogue item accepts either, and the word stored is which one happened.
      result: e.inquiryStatus === "no_response" ? "no_response" : "responded",
      performedBy: e.employerName,
      reference: e.usdotNumber,
      detail,
    });
  }

  return { records, skipped };
}

/**
 * The §391.51(b) hiring group that will STILL be unsatisfied once the handoff has run.
 *
 * Advisory items (PSP, ELDT) are excluded — reporting a lawful file as incomplete is the failure
 * D-PSP1 named. Every hiring item is `source: "record"`, so qualification records alone answer this;
 * if that ever stops being true this function has to read certifications too, and the filter below
 * is where it would be noticed.
 */
export function hiringGapsAfterHire(
  existing: readonly HandoffExistingRecord[],
  planned: readonly HandoffRecordDraft[],
): Array<{ key: string; label: string; citation: string }> {
  const held = new Set<string>([...existing.map((r) => r.kind), ...planned.map((r) => r.kind)]);
  return DQ_ITEMS.filter(
    (i) =>
      i.group === "hiring"
      && !i.advisory
      && i.source === "record"
      // ⚠ Conditional items are excluded because this function CANNOT evaluate the condition: its
      // inputs are the records held and the records planned, and neither says whether the driver
      // holds a CDL or admitted a prior failed test. Listing one anyway would report every clean
      // file as missing §40.25(j) paperwork. The §40.25(j) case is reported at the hire by
      // `HireResult.returnToDutyBlocked`, which reads the fact this function has no access to.
      && !i.appliesWhen
      && !i.evidenceKinds.some((k) => held.has(k)),
  ).map((i) => ({ key: i.key, label: i.label, citation: i.citation }));
}
