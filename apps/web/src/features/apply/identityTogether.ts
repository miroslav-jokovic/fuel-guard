import { applicantIdentitySchema, type ApplicantIdentity } from "@silvicom/shared";
import type { FactRow, TableColumn } from "./applicantFactRows";

/**
 * The date of birth and licence entered TOGETHER on the Applicant facts card, when any of the three is
 * not on file yet (APPLICATION-FIX-PLAN F3c part 2, step 6).
 *
 * ── WHY TOGETHER ──────────────────────────────────────────────────────────────────────────────
 * The identity is written as all three at once (`applicantIdentitySchema`, one SQL writer, D-AF8). One
 * row at a time works while all three are on file — the other two are sent as shown (`correctionFor`).
 * With one missing, every single-row save is refused for the missing one, so the card could never
 * enter it: "Enter all three" with no way to. The Permissions drawer's own editor took all three, and
 * step 6 retires that editor, so the card has to.
 */

const blank = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** The identity's rows on the card — the ones the identity door writes. */
export const identityRows = (rows: readonly FactRow[]): FactRow[] => rows.filter((r) => r.door === "identity");

/** Whether any of the three is missing, so an edit opens all three. */
export const identityIncomplete = (rows: readonly FactRow[]): boolean => identityRows(rows).some((r) => blank(r.value));

/** The three as the editor asks them: each row's own label and control, a date of birth's own date rule. */
export const identityColumns = (rows: readonly FactRow[]): TableColumn[] =>
  identityRows(rows).map((r) => ({
    id: String(r.path[0]),
    label: r.label,
    input: r.input,
    ...(r.path[0] === "date_of_birth" ? { dateKind: "dob" as const } : {}),
  }));

/** What the editor holds, as the identity route takes it, or the contract's own first refusal. */
export function identityFrom(values: Record<string, unknown>): { identity: ApplicantIdentity } | { problem: string } {
  const parsed = applicantIdentitySchema.safeParse({
    date_of_birth: values.date_of_birth || null, cdl_number: values.cdl_number || null, cdl_state: values.cdl_state || null,
  });
  return parsed.success ? { identity: parsed.data } : { problem: parsed.error.issues[0]?.message ?? "Enter all three." };
}

/** What the editor opens holding: each of the three as shown, blank where none is on file. */
export const identityStart = (rows: readonly FactRow[]): Record<string, unknown> =>
  Object.fromEntries(identityRows(rows).map((r) => [String(r.path[0]), r.value ?? ""]));
