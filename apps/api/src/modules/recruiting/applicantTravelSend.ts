import type { SupabaseClient } from "@supabase/supabase-js";
import { renderApplicantEmail, type SigningTextOutcome } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { carrierZone } from "./carrierClock.js";
import { deliverApplicationMail, type ApplicationInviteDelivery } from "./applicationMail.js";
import { messageInputs } from "./messageWording.js";
import { sendOrQueueSms } from "./smsOutbox.js";
import { textOutcome } from "./applicationSendForSigning.js";
import { readTrip, tripLinesFor } from "./applicantTrip.js";

/**
 * "Send the trip to {name}" (HIRING-WORKFLOW-AUDIT §12 MT3, D-MT9).
 *
 * ── WHAT GAP ──────────────────────────────────────────────────────────────────────────────────
 * The office books the trip (`applicantTravel.ts`, 0376) and until §12 nothing told the applicant: the
 * recruiter read the flight out on the phone. This sends the newest live booking by email to the
 * invitation's address and by text through the outbox (reason `travel`, 0551), in the carrier's wording
 * (the `travel` catalogue message) with the trip's lines fixed below it.
 *
 * ── AN ACT, NOT A SIDE EFFECT OF BOOKING ──────────────────────────────────────────────────────
 * The office may book before it is ready to tell the applicant, and a moved trip is a new booking — so
 * the send is its own press, and a second press sends again (a corrected address, a lost email).
 *
 * ── THE TEXT RE-READS THE TRIP WHEN IT GOES ───────────────────────────────────────────────────
 * The outbox row carries the trip's id and nothing else (0376 keeps params small, and a booking
 * reference is a credential the audit log is kept free of). `smsOutboxRender` reads the trip at send
 * time, and the drain drops the text if the trip was cancelled or has left by then (`stillWanted`): a
 * text that arrives at 07:00 about a bus that left at 06:00, or was replaced overnight, is worse than none.
 *
 * ⚠ The service role bypasses RLS: every query carries its own `.eq("org_id", …)`.
 */

export type TravelSendError = { status: 404 | 409; code: string; message: string };
export const isTravelSendError = (v: object): v is TravelSendError => "status" in v && "code" in v;

export interface TravelSent {
  email: ApplicationInviteDelivery;
  text: SigningTextOutcome;
}

export async function sendTravel(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  driverId: string,
  travelId: string,
  now: Date,
): Promise<TravelSent | TravelSendError> {
  const { data: inv } = await admin
    .from("application_invitations")
    .select("id, email")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const invitation = inv as { id: string; email: string | null } | null;
  const trip = invitation ? await readTrip(admin, orgId, travelId) : null;
  // Another application's trip, another carrier's, or no trip at all: one answer, naming nothing.
  if (!invitation || !trip || trip.invitation_id !== invitation.id) {
    return { status: 404, code: "not_found", message: "That trip is not on this applicant's application." };
  }
  if (trip.cancelled_at) return { status: 409, code: "trip_cancelled", message: "That trip was cancelled. Send the current one." };
  if (Date.parse(trip.depart_at) <= now.getTime()) {
    return { status: 409, code: "trip_departed", message: "That trip has already left, so there is nothing to tell them." };
  }

  const [zone, { vars, wording }] = await Promise.all([
    carrierZone(admin, orgId),
    messageInputs(admin, orgId, driverId, "travel", null),
  ]);
  const text = await sendOrQueueSms(admin, env, {
    orgId, driverId, invitationId: invitation.id, template: "travel", params: { travel_id: trip.id },
  }, now);
  const email = await deliverApplicationMail(
    env, invitation.email, renderApplicantEmail("travel", vars, "", wording, { trip: tripLinesFor(trip, zone) }),
  );
  return { email, text: textOutcome(text) };
}
