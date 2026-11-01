import {
  applicationEmployerSchema,
  applicationV2FilingIssues,
  employmentSegments,
  recordId,
  type ApplicationEmployer,
} from "@silvicom/shared";

/**
 * One previous job as the one employer form holds it — the applicant's link, the office before
 * filing, the office after filing (HIRING-WORKFLOW-AUDIT-2026-10-31 §4.5, HW5b).
 *
 * ── WHY THIS LIVES IN `@/components` ──────────────────────────────────────────────────────────
 * Until HW5b there were three forms for one job, with three sets of fields and two different
 * defaults (EM-5: the office's `operated_cmv` started false, the applicant's true). One form means
 * one row shape, and the office's record screen is `features/recruitment`, which `lint:boundaries`
 * keeps out of `features/apply` — so the shape and its rules moved here, where both may import them.
 * `features/apply/draftShape.ts` re-exports them under the names the application always used
 * (`DraftEmployer`, `emptyEmployer`, `newEmployerKey`), so nothing there forked.
 *
 * All strings, as a form holds half-typed text; `employerRecord` turns it into the contract's row.
 */
export interface EmployerFields {
  /**
   * The entry's stable reference (AW1, D-AW8): the office's phone call to this employer is recorded
   * against it before filing, and filing copies the call onto the employment row made from it. Minted
   * once, when the entry is created or first loaded without one, and never changed — an index would
   * re-point every call when an entry above it is removed (Q-AX7).
   */
  key: string;
  employer_name: string;
  usdot_number: string;
  address_line1: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  position_held: string;
  started_on: string;
  ended_on: string;
  operated_cmv: boolean;
  dot_regulated: boolean;
  reason_for_leaving: string;
  /**
   * §391.21(b)(10)(iv)(A) and (B), asked Yes/No — and `null` until answered (C3c2b, Q-AW33). They were
   * `false` behind two unticked checkboxes, so the page always sent an answer nobody gave, and a v2
   * filing's `== null` rule could never fire. A saved `true` or `false` is kept as it was.
   */
  subject_to_fmcsr: boolean | null;
  safety_sensitive: boolean | null;
}

/** A field the form shows — everything but the key, which nobody types. */
export type EmployerField = Exclude<keyof EmployerFields, "key">;

/** A fresh employer reference — `crypto.randomUUID`, which `applicationEmployerSchema.key` checks is a UUID. */
export const newEmployerKey = (): string => crypto.randomUUID();

/**
 * A new job, with the applicant's defaults — for EVERY surface since HW5b (EM-5).
 *
 * `operated_cmv` and `dot_regulated` default TRUE because the person is being asked about driving
 * jobs, and the cost of the two defaults is asymmetric: a warehouse job wrongly marked DOT-regulated
 * produces an inquiry nobody owed, while a driving job wrongly marked otherwise silently drops a
 * §391.23(a)(2) obligation the carrier is required to discharge. The office's post-filing form
 * started `operated_cmv` false until §9 P5; one factory is what keeps the three from drifting again.
 *
 * ⚠ The (iv) answers are NOT defaulted (Q-AW33): they are the regulation's own "whether" questions
 * about this job, and a default is the one answer a filing rule cannot tell from the applicant's.
 */
export const blankEmployer = (): EmployerFields => ({
  key: newEmployerKey(),
  employer_name: "", usdot_number: "", address_line1: "", city: "", state: "", phone: "", email: "",
  position_held: "", started_on: "", ended_on: "",
  operated_cmv: true, dot_regulated: true,
  reason_for_leaving: "", subject_to_fmcsr: null, safety_sensitive: null,
});

const text = (v: string): string | null => (v.trim() === "" ? null : v.trim());
const EMPLOYER_KEY = recordId();
const isEmployerKey = (v: unknown): v is string => EMPLOYER_KEY.safeParse(v).success;

/**
 * One job, as the contract wants it: empty strings become `null` — the schema's `.nullish()` fields
 * mean "not answered", and an empty string is an answer of nothing. A stored `key` the contract would
 * refuse is sent as `null`, never as itself (D-US13).
 *
 * ⚠ ONE mapper for the applicant's draft, the office's draft edits and the office's record — a second
 * one would be a second opinion about what a row is, and the two would drift on the next field.
 */
export function employerRecord(e: EmployerFields): Record<string, unknown> {
  return {
    key: isEmployerKey(e.key) ? e.key : null,
    employer_name: e.employer_name.trim(),
    usdot_number: text(e.usdot_number),
    address_line1: text(e.address_line1),
    city: text(e.city),
    state: text(e.state),
    phone: text(e.phone),
    email: text(e.email),
    position_held: text(e.position_held),
    started_on: e.started_on,
    ended_on: text(e.ended_on),
    operated_cmv: e.operated_cmv,
    dot_regulated: e.dot_regulated,
    reason_for_leaving: text(e.reason_for_leaving),
    subject_to_fmcsr: e.subject_to_fmcsr,
    safety_sensitive: e.safety_sensitive,
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const yesNo = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/**
 * A stored row (the draft's, the filed application's) back into the form's shape. A missing answer
 * stays unanswered; `operated_cmv` / `dot_regulated` fall back to the defaults only when the row
 * never had them, which is what an applicant's own form would have shown.
 */
export function employerFields(row: Record<string, unknown>): EmployerFields {
  return {
    ...blankEmployer(),
    key: isEmployerKey(row.key) ? row.key : newEmployerKey(),
    employer_name: str(row.employer_name),
    usdot_number: str(row.usdot_number),
    address_line1: str(row.address_line1),
    city: str(row.city),
    state: str(row.state),
    phone: str(row.phone),
    email: str(row.email),
    position_held: str(row.position_held),
    started_on: str(row.started_on),
    ended_on: str(row.ended_on),
    operated_cmv: typeof row.operated_cmv === "boolean" ? row.operated_cmv : true,
    dot_regulated: typeof row.dot_regulated === "boolean" ? row.dot_regulated : true,
    reason_for_leaving: str(row.reason_for_leaving),
    subject_to_fmcsr: yesNo(row.subject_to_fmcsr),
    safety_sensitive: yesNo(row.safety_sensitive),
  };
}

/**
 * Is this job one of (b)(10)'s — in the three years before `asOf` — by the dates typed so far? The
 * filing's own test (`employmentSegments`), so the form asks (iv) of exactly the jobs a filing refuses
 * without it. No start date yet, no answer.
 */
export function inLastThreeYears(e: EmployerFields, asOf: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.started_on)) return false;
  const row = employerRecord(e) as Pick<ApplicationEmployer, "started_on" | "ended_on" | "operated_cmv">;
  return employmentSegments(row, asOf).includes("b10");
}

/** One thing wrong with a job: the field it belongs on, and the contract's or the filing's sentence. */
export interface EmployerProblem {
  field: string;
  message: string;
  /** The schema's own issue, when the schema found it — `messageFor` turns it into the applicant's words. */
  code?: string;
}

/**
 * Everything wrong with one job as it stands: the row schema first, then — on a v2 application — the
 * filing's own rules for this row alone (address, reason for leaving, the (iv) answers). The same two
 * checks the applicant's Save and the office's Save run, so neither can put a job on the list that the
 * other side, or the filing, would refuse.
 */
export function employerProblems(e: EmployerFields, v2AsOf: string | null): EmployerProblem[] {
  const candidate = employerRecord(e);
  const parsed = applicationEmployerSchema.safeParse(candidate);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      field: String(issue.path[0] ?? "employer_name"),
      message: issue.message,
      code: issue.code,
    }));
  }
  if (!v2AsOf) return [];
  // Filed as the only employer, so its issues are `employers.0.*`; the address and gap rules about the
  // whole application are left to the screen that holds the whole application.
  return applicationV2FilingIssues({ employers: [parsed.data], employment_gaps: [], addresses: [] }, v2AsOf)
    .filter((issue) => issue.path.startsWith("employers.0."))
    .map((issue) => ({ field: issue.path.slice("employers.0.".length), message: issue.message }));
}
