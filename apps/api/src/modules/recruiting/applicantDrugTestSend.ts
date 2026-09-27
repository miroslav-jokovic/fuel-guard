import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { readLiveInvitation } from "./applicantChecklist.js";
import { COLS, type DrugTestError, type Row } from "./applicantDrugTest.js";
import { sendOrQueueSms, type OutboxOutcome } from "./smsOutbox.js";

/**
 * The office texting the drug-test appointment to the applicant (D-AW6, C2d).
 *
 * A file of its own so the import runs one way: the outbox asks `applicantDrugTest.ts` (the table's
 * owner) whether an appointment is still live and stamps it sent through it, and this act needs both
 * the outbox and that owner.
 */
/**
 * Text the live appointment to the applicant (D-AW6, C2d). Queued for their morning when it is late;
 * refused with words when they have not agreed to texts — the office then tells them by phone, which
 * is exactly what it did before this existed.
 */
export async function sendDrugTestToDriver(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  driverId: string,
  appointmentId: string,
  now: Date,
): Promise<{ outcome: OutboxOutcome; invitationId: string } | DrugTestError> {
  const invitation = await readLiveInvitation(admin, orgId, driverId);
  if (!invitation) return { code: "not_found", message: "That appointment is not on this applicant's application." };
  const { data } = await admin
    .from("drug_test_appointments")
    .select(COLS)
    .eq("org_id", orgId)
    .eq("invitation_id", invitation.id)
    .eq("id", appointmentId)
    .is("cancelled_at", null)
    .maybeSingle();
  const row = data as Row | null;
  if (!row) return { code: "not_found", message: "That appointment is not on this applicant's application, or is cancelled." };

  const outcome = await sendOrQueueSms(admin, env, {
    orgId, driverId, invitationId: invitation.id, template: "drug_test_site",
    params: {
      appointment_id: row.id, site_name: row.site_name, site_address: row.site_address, site_phone: row.site_phone,
      window_start: row.window_start, window_end: row.window_end, donor_reference: row.donor_reference,
    },
  }, now);
  if ("held" in outcome) {
    return {
      code: "not_texted",
      message: outcome.held === "no_number"
        ? "The applicant's number on file cannot be texted. Tell them by phone."
        : "The applicant has not agreed to texts. Tell them by phone.",
    };
  }
  if ("failed" in outcome) return { code: "write_failed", message: "The text could not be sent. Try again, or tell them by phone." };
  return { outcome, invitationId: invitation.id };
}
