import type { SupabaseClient } from "@supabase/supabase-js";
import { isIntakeError, resolveInvitation, type IntakeError } from "./applicationIntake.js";
import {
  drugAlcoholPolicyPdf,
  filedPolicyBytes,
  policyReceipt,
} from "./applicationPdf/drugAlcoholPolicy/drugAlcoholPolicyCopy.js";

/**
 * The carrier's drug-and-alcohol policy on the applicant's own link (DAP2, HIRING-WORKFLOW-AUDIT-2026-10-31
 * §15.2, D-DAP2): §382.601(a) "provide", and the copy page 28's receipt says the driver received.
 *
 * ── WHY THE TOKEN IS ENOUGH, AND NO PHASE IS ASKED ────────────────────────────────────────────
 * The policy is the carrier's handout to every driver, not a record about this one; the only personal
 * thing it can carry is the p28 signature, which this link made. So any live link may read it: the walk
 * opens it at page 28, and a driver who wants to read it again later — or before — is owed it.
 *
 * ⚠ Bytes, for `/:token/packet`'s reason: rendered on demand with the receipt if made, never stored
 * until the packet files. Once filed, the FILED copy — the one in the driver's file — as the handbook's
 * route serves its filed copy; rendered again only if that filing has not landed yet.
 */
export async function applicantDrugAlcoholPolicyPdf(
  admin: SupabaseClient,
  token: string,
  now: Date,
): Promise<{ pdf: Buffer; filename: string } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;

  if (invitation.submitted_at) {
    const { data } = await admin
      .from("driver_applications")
      .select("id")
      .eq("org_id", invitation.org_id)
      .eq("invitation_id", invitation.id)
      .order("certified_at", { ascending: false })
      .limit(1);
    const applicationId = ((data ?? []) as Array<{ id: string }>)[0]?.id;
    const filed = applicationId ? await filedPolicyBytes(admin, invitation.org_id, applicationId) : null;
    if (filed) return { pdf: filed, filename: "drug-alcohol-policy-signed.pdf" };
  }

  const receipt = await policyReceipt(admin, invitation.org_id, invitation.id);
  const pdf = await drugAlcoholPolicyPdf(admin, invitation.org_id, invitation.id, receipt);
  return { pdf, filename: "drug-alcohol-policy.pdf" };
}
