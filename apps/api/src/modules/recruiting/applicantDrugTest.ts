import type { SupabaseClient } from "@supabase/supabase-js";
import type { DrugTestAppointment, DrugTestAppointmentBooking, DrugTestAppointmentList } from "@silvicom/shared";
import { readLiveInvitation } from "./applicantChecklist.js";
import { carrierZone, instantOf } from "./carrierClock.js";

/**
 * Where and when the applicant goes for the pre-employment drug test — D-AW6, AW8
 * (APPLICATION-FLOW-V2-PLAN §6.3, C2b3).
 *
 * ── OPERATIONAL, AND THAT IS THE WHOLE DESIGN ─────────────────────────────────────────────────
 * The office books the collection with its TPA outside this product (no lab integration, Q-AW7) and
 * writes down what the driver needs to get there: the site, its address and phone, the window, the
 * donor or registration number. The row is not evidence. §382.301's fact is the verified RESULT, filed
 * through the recorded-act door as `drug_test`, and the checklist reads only that — an appointment
 * never ticks the step, and one arranged by phone and never typed in here is as good as one that was.
 *
 * ── ON THE LIVE INVITATION, CHANGED NOT EDITED ────────────────────────────────────────────────
 * `applicantTravel.ts`'s two rules, for its reasons: the appointment belongs to one application
 * (0376 keys it on `invitation_id`), and a moved appointment is a new row inserted FIRST, then the
 * older live ones cancelled — so a failure between the two leaves two live rows (the drawer shows the
 * newest) rather than none. Cancelled rows stay: "the history of changes is readable" (0376).
 *
 * ⚠ Sent to the driver only when the office presses Send (`sendDrugTestToDriver`, C2d), through
 * `sms_outbox` — a text sent directly would be the held-and-dropped message A-11 records, and the
 * office books collections late in the day for the next morning. 0376's `sent_to_driver_at` is
 * stamped by the outbox when the text actually leaves, not when it is queued.
 *
 * ⚠ The service role bypasses RLS, and 0376's guard (AI012) refuses every other writer: every query
 * here carries its own `.eq("org_id", …)`, asserted by `expectOrgScoped` in the route test.
 */

export type DrugTestError = {
  code: "no_invitation" | "not_found" | "write_failed" | "not_texted";
  message: string;
};

export const isDrugTestError = (v: object): v is DrugTestError => "code" in v;

export const COLS =
  "id, site_name, site_address, site_phone, window_start, window_end, donor_reference, created_at, sent_to_driver_at, cancelled_at";

export interface Row {
  id: string;
  site_name: string;
  site_address: string;
  site_phone: string | null;
  window_start: string;
  window_end: string | null;
  donor_reference: string | null;
  created_at: string;
  sent_to_driver_at: string | null;
  cancelled_at: string | null;
}

const toAppointment = (r: Row): DrugTestAppointment => ({
  id: r.id,
  siteName: r.site_name,
  siteAddress: r.site_address,
  sitePhone: r.site_phone,
  windowStart: r.window_start,
  windowEnd: r.window_end,
  donorReference: r.donor_reference,
  arrangedAt: r.created_at,
  sentToDriverAt: r.sent_to_driver_at,
  cancelledAt: r.cancelled_at,
});

/**
 * The live invitation's appointments, newest first, cancelled ones included. The driver must be this
 * org's: `readLiveInvitation` reads by org AND driver, so another org's driver has no invitation here.
 */
export async function listDrugTestAppointments(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<DrugTestAppointmentList | DrugTestError> {
  const invitation = await readLiveInvitation(admin, orgId, driverId);
  const timeZone = await carrierZone(admin, orgId);
  if (!invitation) return { appointments: [], timeZone };
  const { data, error } = await admin
    .from("drug_test_appointments")
    .select(COLS)
    .eq("org_id", orgId)
    .eq("invitation_id", invitation.id)
    .order("created_at", { ascending: false });
  if (error) return { code: "write_failed", message: "The appointments could not be read." };
  return { appointments: ((data ?? []) as Row[]).map(toAppointment), timeZone };
}

export async function arrangeDrugTest(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  driverId: string,
  body: DrugTestAppointmentBooking,
): Promise<{ appointment: DrugTestAppointment; invitationId: string; replaced: number } | DrugTestError> {
  const invitation = await readLiveInvitation(admin, orgId, driverId);
  if (!invitation) return { code: "no_invitation", message: "This applicant has no live invitation." };

  const zone = await carrierZone(admin, orgId);
  const { data, error } = await admin
    .from("drug_test_appointments")
    .insert({
      org_id: orgId,
      invitation_id: invitation.id,
      site_name: body.site_name,
      site_address: body.site_address,
      site_phone: body.site_phone?.trim() || null,
      window_start: instantOf(body.window_start, zone),
      window_end: body.window_end ? instantOf(body.window_end, zone) : null,
      donor_reference: body.donor_reference?.trim() || null,
      arranged_by: userId,
    })
    .select(COLS)
    .single();
  if (error || !data) return { code: "write_failed", message: "The appointment could not be recorded." };
  const appointment = toAppointment(data as Row);

  // After the insert, never before — see the header.
  const { data: replaced } = await admin
    .from("drug_test_appointments")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("invitation_id", invitation.id)
    .is("cancelled_at", null)
    .neq("id", appointment.id)
    .select("id");
  return { appointment, invitationId: invitation.id, replaced: (replaced ?? []).length };
}

/** Cancel one live appointment, scoped to the LIVE invitation — another application's id matches nothing. */
export async function cancelDrugTest(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  appointmentId: string,
): Promise<{ appointment: DrugTestAppointment; invitationId: string } | DrugTestError> {
  const invitation = await readLiveInvitation(admin, orgId, driverId);
  if (!invitation) return { code: "not_found", message: "That appointment is not on this applicant's application." };
  const { data, error } = await admin
    .from("drug_test_appointments")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("invitation_id", invitation.id)
    .eq("id", appointmentId)
    .is("cancelled_at", null)
    .select(COLS)
    .maybeSingle();
  if (error) return { code: "write_failed", message: "The appointment could not be cancelled." };
  if (!data) {
    return { code: "not_found", message: "That appointment is not on this applicant's application, or is already cancelled." };
  }
  return { appointment: toAppointment(data as Row), invitationId: invitation.id };
}

/**
 * The two facts the outbox needs about an appointment it is texting (C2d), asked of this table's
 * owner rather than written from the outbox: is the appointment still live — a rebooking or a cancel
 * after the text was queued must stop it — and stamp `sent_to_driver_at` when the text actually leaves
 * (the first time only).
 */
export async function drugTestStillLive(admin: SupabaseClient, orgId: string, appointmentId: string): Promise<boolean> {
  const { data } = await admin
    .from("drug_test_appointments")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", appointmentId)
    .is("cancelled_at", null)
    .maybeSingle();
  return Boolean(data);
}

export async function markDrugTestSent(admin: SupabaseClient, orgId: string, appointmentId: string, at: string): Promise<void> {
  await admin
    .from("drug_test_appointments")
    .update({ sent_to_driver_at: at })
    .eq("org_id", orgId)
    .eq("id", appointmentId)
    .is("sent_to_driver_at", null);
}
