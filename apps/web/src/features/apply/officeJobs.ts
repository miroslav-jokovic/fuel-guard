import { EMPLOYMENT_FORM_COPY } from "@/components/employment/employmentCopy";

/**
 * A job as the office names it — by the name the applicant gave, or by saying there is none (AF-4), in
 * the timeline's own words (`EMPLOYMENT_FORM_COPY.noName`, HW5b).
 */
export const employerName = (e: Record<string, unknown>): string =>
  typeof e.employer_name === "string" && e.employer_name.trim() !== "" ? e.employer_name.trim() : EMPLOYMENT_FORM_COPY.noName;

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** The jobs on the draft, as rows — with their key, which every edit to one names (Q-AX7). */
export function draftEmployers(payload: unknown): Record<string, unknown>[] {
  const list = isRecord(payload) ? payload.employers : undefined;
  return (Array.isArray(list) ? list : []).filter(isRecord);
}

/** The gaps the applicant (or the office) has explained, keyed by the day each starts. */
export function draftGaps(payload: unknown): Array<{ from: string; explanation?: string }> {
  const list = isRecord(payload) ? payload.employment_gaps : undefined;
  return (Array.isArray(list) ? list : []).filter(
    (g): g is { from: string; explanation?: string } => isRecord(g) && typeof g.from === "string",
  );
}
