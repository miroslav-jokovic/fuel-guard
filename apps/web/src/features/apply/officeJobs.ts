/** A job as the office names it — by the name the applicant gave, or by saying there is none (AF-4). */
export const employerName = (e: Record<string, unknown>): string =>
  typeof e.employer_name === "string" && e.employer_name.trim() !== "" ? e.employer_name.trim() : "A job with no name";
