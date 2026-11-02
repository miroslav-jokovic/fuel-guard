/**
 * What an applicant still owes, as their link reads it (HIRING-WORKFLOW-AUDIT §13 SP1, D-SP2/D-SP3).
 *
 * Kinds, never details: the bare link is forwarded and read on shared phones (D-APP16), so it says a
 * drug test is booked, never where or when — the details travel by the drug-test text and the trip
 * message. In the order the page lists them: the drug test is time-bound, the videos are done before
 * coming in, the trip is information.
 */
export const APPLICANT_OWED_KINDS = ["drug_test", "videos", "trip"] as const;
export type ApplicantOwedKind = (typeof APPLICANT_OWED_KINDS)[number];

/** The facts the server reads, folded into the list — pure, so the order and each rule are tested here. */
export interface ApplicantOwedFacts {
  /** Live (uncancelled) appointments on this invitation: the end of each window, else its start. */
  drugTestWindowsEnd: readonly string[];
  /** The videos sent on this invitation, and the required ones not yet ticked. */
  videosSent: boolean;
  requiredVideosUnwatched: number;
  /** Live bookings on this invitation: each departure. */
  tripDepartures: readonly string[];
}

export function applicantOwed(f: ApplicantOwedFacts, now: Date): ApplicantOwedKind[] {
  const ahead = (iso: string) => Date.parse(iso) > now.getTime();
  const owed: ApplicantOwedKind[] = [];
  if (f.drugTestWindowsEnd.some(ahead)) owed.push("drug_test");
  if (f.videosSent && f.requiredVideosUnwatched > 0) owed.push("videos");
  if (f.tripDepartures.some(ahead)) owed.push("trip");
  return owed;
}
