import { EMPLOYMENT_FORM_COPY } from "@/components/employment/employmentCopy";

/**
 * A job as the office names it — by the name the applicant gave, or by saying there is none (AF-4), in
 * the timeline's own words (`EMPLOYMENT_FORM_COPY.noName`, HW5b).
 */
export const employerName = (e: Record<string, unknown>): string =>
  typeof e.employer_name === "string" && e.employer_name.trim() !== "" ? e.employer_name.trim() : EMPLOYMENT_FORM_COPY.noName;
