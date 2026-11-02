import { employmentHistoryCreateSchema, type EmploymentHistory } from "@silvicom/shared";
import { blankEmployer, employerRecord, type EmployerFields } from "@/components/employment/employerRow";

/**
 * The office record's employment row (`driver_employment_history`) and the one employer form, mapped
 * both ways (HW5b, EM-5/EM-6).
 *
 * The record names its columns `employer_city`, `employer_phone`… where the application says `city`,
 * `phone`… — one mapping here, so the form stays the applicant's form and the table stays the table.
 * What the form never touches is the inquiry: `inquiry_status`, `inquiry_sent_on` and
 * `inquiry_response_on` are derived from the attempts by `syncInquiryStatus` (EM-6), and the old form
 * let the office type them, so every save overwrote the derived value. They are not mapped, so they
 * are never sent.
 */

/** Form field → record column, for the columns whose names differ. */
const COLUMN: Partial<Record<keyof EmployerFields, string>> = {
  address_line1: "employer_address_line1",
  city: "employer_city",
  state: "employer_state",
  phone: "employer_phone",
  email: "employer_email",
};
const FIELD: Record<string, string> = Object.fromEntries(Object.entries(COLUMN).map(([f, c]) => [c, f]));

/** A record row in the form's shape. `operated_cmv` not stated (a pre-0214 row) shows the default. */
export function historyToFields(r: EmploymentHistory): EmployerFields {
  return {
    ...blankEmployer(),
    key: r.id,
    employer_name: r.employer_name,
    usdot_number: r.usdot_number ?? "",
    address_line1: r.employer_address_line1 ?? "",
    city: r.employer_city ?? "",
    state: r.employer_state ?? "",
    phone: r.employer_phone ?? "",
    email: r.employer_email ?? "",
    position_held: r.position_held ?? "",
    started_on: r.started_on,
    ended_on: r.ended_on ?? "",
    operated_cmv: r.operated_cmv ?? true,
    dot_regulated: r.dot_regulated,
    reason_for_leaving: r.reason_for_leaving ?? "",
    subject_to_fmcsr: r.subject_to_fmcsr,
    safety_sensitive: r.safety_sensitive,
  };
}

/** The form's answers as record columns — through `employerRecord`, the one mapper every surface uses. */
export function fieldsToColumns(f: EmployerFields): Record<string, unknown> {
  const { key: _key, ...record } = employerRecord(f);
  return Object.fromEntries(Object.entries(record).map(([field, v]) => [COLUMN[field as keyof EmployerFields] ?? field, v]));
}

/**
 * What to send for a job: on an add, every column, `source: "manual"` — the office added it, which is
 * what EM-5 found mislabelled "Declared on the application" — checked by the shared create schema; on
 * a change, only the columns that changed, so a value the form shows by default (an unstated
 * `operated_cmv` reads Yes) is never written over a row nobody touched. Errors come back keyed by the
 * FORM's field, so they land under its boxes.
 */
export function historyWrite(
  fields: EmployerFields,
  notes: string,
  driverId: string,
  existing: EmploymentHistory | null,
): { body: Record<string, unknown> | null; errors: Record<string, string> } {
  const columns = { ...fieldsToColumns(fields), notes: notes.trim() === "" ? null : notes.trim() };
  const candidate = { ...columns, driver_id: driverId, source: existing?.source ?? "manual" };
  const parsed = employmentHistoryCreateSchema.safeParse(candidate);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const column = String(issue.path[0] ?? "employer_name");
      errors[FIELD[column] ?? column] ??= issue.message;
    }
    return { body: null, errors };
  }
  if (!existing) return { body: parsed.data, errors: {} };
  const before: Record<string, unknown> = {
    ...fieldsToColumns(historyToFields(existing)),
    notes: existing.notes,
    // Unstated stays unstated unless the office answers it: compared against what the row holds.
    operated_cmv: existing.operated_cmv,
  };
  const changed: Record<string, unknown> = Object.fromEntries(
    Object.entries(columns).filter(([c, v]) => JSON.stringify(before[c] ?? null) !== JSON.stringify(v ?? null)),
  );
  // The form shows an unstated `operated_cmv` as Yes; left at Yes, nobody answered it.
  if (existing.operated_cmv === null && changed.operated_cmv === true) delete changed.operated_cmv;
  return { body: changed, errors: {} };
}
