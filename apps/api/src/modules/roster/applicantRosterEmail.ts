import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The roster's one acceptance of an email from an application (APPLICATION-FIX-PLAN Q-AM16 (a), 0594).
 *
 * `drivers` is the roster's table, and the recruiter who corrects an applicant's email does not hold the
 * roster section. So recruiting does not write `drivers.email`; it asks the roster, and the roster's
 * function decides atomically: only an applicant's row, only before filing, and only while the row
 * still holds the address being replaced (or none). An email set on the roster since is never
 * overwritten from an application. Answers whether it moved; a failed call is "did not move", because
 * the invitation's email, which every message goes to, has already moved and that is what the office
 * was told.
 */
export async function moveApplicantRosterEmail(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  from: string | null,
  to: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("move_applicant_roster_email", {
    p_org: orgId,
    p_invitation: invitationId,
    p_from: from,
    p_to: to,
  });
  return !error && data === true;
}
