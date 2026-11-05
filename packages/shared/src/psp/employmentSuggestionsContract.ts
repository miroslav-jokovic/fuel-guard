import type { EmployerMatch, UnlistedCarrier } from "./employment.js";

/**
 * What the employment timeline is told about the driver's PSP record — HW6b
 * (HIRING-WORKFLOW-AUDIT-2026-10-31 §4.6, §3.6).
 *
 * ── SHOW-ONLY, BECAUSE PSP-PLAN Q10 IS OPEN ───────────────────────────────────────────────────
 * Computed at read time from the stored vendor response (`psp_requests.response_raw`) through
 * `crossMatchEmployment`, and never stored. Whether the PSP account-holder agreement lets us keep
 * PSP-DERIVED data past the hiring decision is Q10 and nobody has answered it, so this shape holds
 * nothing a table could keep: the evidence stays the one raw response that a Phase F purge already
 * deletes, and every answer here is re-derived from it on each read. An office that acts on a
 * suggestion does it through the ordinary employer form, as a job it confirmed with the driver.
 *
 * ── WHO IS TOLD ───────────────────────────────────────────────────────────────────────────────
 * Only the readers of the PSP report itself (`canReadRestrictedKind("psp_report", role)`, the
 * §391.53(a)(1) test, D-PERM9). A carrier name and the dates a driver was inspected in its truck ARE
 * the report's content, whatever table they are rendered from.
 */
export interface PspEmploymentSuggestions {
  /**
   * The report the suggestions were read from, or null when there is no machine-readable one: none
   * ordered yet, or only a PDF imported from the portal (read by nobody — `provenance.ts`). Null is
   * "nothing to compare", never "PSP found nothing".
   */
  report: { requestId: string; pulledOn: string } | null;
  /** Carriers PSP saw that the job list does not name, newest activity first. */
  unlisted: UnlistedCarrier[];
  /**
   * One per listed job that has a start date, in the list's order. `key` is the history row's id or
   * the draft employer's key; `index` is its position, for a draft job from before AW1 that has none.
   */
  employers: PspEmployerCheck[];
  /** Where PSP's sight begins — inspections 3 years, crashes 5 (D-PSP5); null with no report. */
  inspectionWindowStart: string | null;
  crashWindowStart: string | null;
}

export interface PspEmployerCheck {
  key: string | null;
  index: number;
  match: EmployerMatch;
  inspections: number;
  crashes: number;
}

/** The answer when there is nothing to compare — one constant, so "no report" has one shape. */
export const NO_PSP_EMPLOYMENT: PspEmploymentSuggestions = {
  report: null,
  unlisted: [],
  employers: [],
  inspectionWindowStart: null,
  crashWindowStart: null,
};
