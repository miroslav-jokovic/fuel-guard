import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hiringStep,
  travelBlockers,
  type ApplicantTravel,
  type ApplicantTravelBooking,
  type ApplicantTravelList,
  type HiringStepKey,
  type TravelMode,
} from "@silvicom/shared";
import { applicantChecklist, isChecklistError, readLiveInvitation } from "./applicantChecklist.js";
import { carrierZone, instantOf } from "./carrierClock.js";

/**
 * The applicant's trip to the office — D-AW7, AW11 (APPLICATION-FLOW-V2-PLAN §7, C2b2).
 *
 * ── A RECORD, AND A REFUSAL ───────────────────────────────────────────────────────────────────
 * Q-HM5 (owner, 2026-09-17): *"we will not even bring him if this not green."* Until now that ruling
 * lived only as `readyToTravel`, an answer nobody was obliged to read — the ticket was bought outside
 * the product and nothing recorded that it had been. So D-AW7 gives the trip a row
 * (`applicant_travel`, 0376) and this writer REFUSES to record one while any step before travel is
 * open (`TRAVEL_REFUSES_WITHOUT`). The refusal is the checklist's own fold (`travelBlockers`), read
 * through `applicantChecklist` — the drawer's green and this refusal cannot disagree, for the reason
 * `hireApplicant.ts` gives for the hire.
 *
 * ── ON THE LIVE INVITATION ────────────────────────────────────────────────────────────────────
 * A trip belongs to one application (0376 keys it on `invitation_id`): a rehire travels again, and
 * last year's ticket is not this year's step. `readLiveInvitation` is the checklist's own rule for
 * which invitation is live, so the row this writes is the row the fold then reads.
 *
 * ── CHANGED, NOT EDITED ───────────────────────────────────────────────────────────────────────
 * A changed flight is a new booking: the new row goes in FIRST and only then are the older live ones
 * cancelled, so a failure between the two leaves two live trips (the drawer shows the newest) rather
 * than none — a step that stays green on a real booking, never one that goes red on a lost write.
 * Cancelled rows stay: 0376 says "cancelled, never deleted", and the history of a trip that moved is
 * what an office asks about when an applicant says they were never told.
 *
 * ⚠ The service role bypasses RLS, and 0376's guard (AI013) refuses every other writer: every query
 * here carries its own `.eq("org_id", …)`, asserted by `expectOrgScoped` in the route test.
 */

export type TravelError = {
  code: "not_found" | "no_invitation" | "not_ready_to_travel" | "write_failed";
  message: string;
  /** `not_ready_to_travel`: the steps still open, in the catalogue's order. */
  missing?: HiringStepKey[];
};

export const isTravelError = (v: object): v is TravelError => "code" in v;

const TRAVEL_COLS = "id, mode, depart_at, arrive_at, confirmation_ref, created_at, cancelled_at";

interface TravelRow {
  id: string;
  mode: TravelMode;
  depart_at: string;
  arrive_at: string;
  confirmation_ref: string | null;
  created_at: string;
  cancelled_at: string | null;
}

const toTrip = (r: TravelRow): ApplicantTravel => ({
  id: r.id,
  mode: r.mode,
  departAt: r.depart_at,
  arriveAt: r.arrive_at,
  confirmationRef: r.confirmation_ref,
  bookedAt: r.created_at,
  cancelledAt: r.cancelled_at,
});

/** The live invitation's trips, newest first — cancelled ones included, so a moved trip has a history. */
export async function listTravel(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<ApplicantTravelList | TravelError> {
  const invitation = await readLiveInvitation(admin, orgId, driverId);
  const timeZone = await carrierZone(admin, orgId);
  if (!invitation) return { trips: [], timeZone };
  const { data, error } = await admin
    .from("applicant_travel")
    .select(TRAVEL_COLS)
    .eq("org_id", orgId)
    .eq("invitation_id", invitation.id)
    .order("created_at", { ascending: false });
  if (error) return { code: "write_failed", message: "The trips could not be read." };
  return { trips: ((data ?? []) as TravelRow[]).map(toTrip), timeZone };
}

export async function bookTravel(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  driverId: string,
  body: ApplicantTravelBooking,
  today: string,
): Promise<{ trip: ApplicantTravel; invitationId: string; replaced: number } | TravelError> {
  // The checklist first: it is the org membership check (a 404 for another org's driver) AND the
  // refusal, in the fold the drawer shows.
  const checklist = await applicantChecklist(admin, orgId, driverId, today);
  if (isChecklistError(checklist)) return { code: "not_found", message: checklist.message };
  const missing = travelBlockers(checklist);
  if (missing.length > 0) {
    return {
      code: "not_ready_to_travel",
      message: `Travel waits for: ${missing.map((k) => hiringStep(k).label).join(", ")}.`,
      missing,
    };
  }
  const invitation = await readLiveInvitation(admin, orgId, driverId);
  // Unreachable while `invitation_sent` is in the travel list — kept so a catalogue change cannot turn
  // it into a null dereference.
  if (!invitation) return { code: "no_invitation", message: "This applicant has no live invitation." };

  const zone = await carrierZone(admin, orgId);
  const { data, error } = await admin
    .from("applicant_travel")
    .insert({
      org_id: orgId,
      invitation_id: invitation.id,
      mode: body.mode,
      depart_at: instantOf(body.depart_at, zone),
      arrive_at: instantOf(body.arrive_at, zone),
      confirmation_ref: body.confirmation_ref?.trim() || null,
      booked_by: userId,
    })
    .select(TRAVEL_COLS)
    .single();
  if (error || !data) return { code: "write_failed", message: "The trip could not be recorded." };
  const trip = toTrip(data as TravelRow);

  // After the insert, never before — see the header's "changed, not edited".
  const { data: replaced } = await admin
    .from("applicant_travel")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("invitation_id", invitation.id)
    .is("cancelled_at", null)
    .neq("id", trip.id)
    .select("id");
  return { trip, invitationId: invitation.id, replaced: (replaced ?? []).length };
}

/**
 * Cancel one live trip. Scoped to the LIVE invitation, so an id from another application — or another
 * org — matches nothing and reads as not found.
 */
export async function cancelTravel(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  travelId: string,
): Promise<{ trip: ApplicantTravel; invitationId: string } | TravelError> {
  const invitation = await readLiveInvitation(admin, orgId, driverId);
  if (!invitation) return { code: "not_found", message: "That trip is not on this applicant's application." };
  const { data, error } = await admin
    .from("applicant_travel")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("invitation_id", invitation.id)
    .eq("id", travelId)
    .is("cancelled_at", null)
    .select(TRAVEL_COLS)
    .maybeSingle();
  if (error) return { code: "write_failed", message: "The trip could not be cancelled." };
  if (!data) return { code: "not_found", message: "That trip is not on this applicant's application, or is already cancelled." };
  return { trip: toTrip(data as TravelRow), invitationId: invitation.id };
}
