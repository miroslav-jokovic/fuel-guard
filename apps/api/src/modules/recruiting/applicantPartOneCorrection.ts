import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApplicantIdentity, ApplicantIntakeLicence, PartOneCorrection } from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";

/**
 * The office correcting Part 1's facts (Q-AW36 (a), owner 2026-09-27).
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────────────────────────
 * Part 1's answers are written by the applicant only, fill-only, and frozen once Part 1 is finished
 * (AI008). Part 2 shows them read-only and "Something wrong? Tell us" sends the office a note (C3c2c2)
 * — which the office could read and not act on, because the answers it would correct in the draft are
 * the ones filing lays Part 1 over. This is the act the note asks for.
 *
 * ── THROUGH THE ONE WRITER, OVERWRITING ───────────────────────────────────────────────────────
 * `record_applicant_intake` with `p_overwrite = true` (0376 already takes the flag): it writes the
 * intake row, replaces the licence list, overwrites `drivers`' contact and CDL class and expiry, and
 * — from the new position 0 — the licence number, state and date of birth through
 * `record_applicant_identity`, draft included. So the list the MVR is ordered from, the licence PSP
 * runs on and the one on the filed application stay one licence (D-AF8, D-AW3). It refuses a revoked
 * invitation and a filed one; it does not refuse an expired link or a finished Part 1, because the
 * office corrects while it screens, and screening outlives both.
 *
 * ⚠ The service role bypasses RLS: every read below names the org, and the function checks the
 * invitation belongs to it before writing.
 */

export type PartOneCorrectionError = { code: string; message: string };
export const isPartOneCorrectionError = (v: object): v is PartOneCorrectionError => "code" in v;

const NOT_FOUND: PartOneCorrectionError = {
  code: "application_not_found",
  message: "That application is not in this organization.",
};

interface CorrectableInvitation {
  id: string;
  driver_id: string;
  approved_at: string | null;
}

async function invitationOf(admin: SupabaseClient, orgId: string, invitationId: string): Promise<CorrectableInvitation | null> {
  const { data } = await admin
    .from("application_invitations")
    .select("id, driver_id, approved_at")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .maybeSingle();
  return (data as CorrectableInvitation | null) ?? null;
}

/** Does this invitation have Part 1 at all? "Has a row" is the whole v2 test (C3a, `intakeState`). */
async function hasIntakeRow(admin: SupabaseClient, orgId: string, invitationId: string): Promise<boolean> {
  const { data } = await admin
    .from("application_intakes")
    .select("id")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  return data !== null;
}

/** Part 1's licence list, in order. Position 0 is the current CDL. */
async function storedLicences(admin: SupabaseClient, orgId: string, invitationId: string): Promise<ApplicantIntakeLicence[]> {
  const { data, error } = await admin
    .from("application_intake_licences")
    .select("position, state_code, agency, licence_number, expires_on")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .order("position");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<ApplicantIntakeLicence & { position: number }>)
    .sort((a, b) => a.position - b.position)
    .map(({ state_code, agency, licence_number, expires_on }) => ({ state_code, agency, licence_number, expires_on }));
}

/** The function's refusals, in the office's words. */
function refusalOf(error: { code?: string; message: string }): PartOneCorrectionError {
  switch (error.code) {
    case "AI001":
      return NOT_FOUND;
    case "AI002":
      return { code: "invitation_revoked", message: "This invitation was revoked. Nothing was changed." };
    case "AI003":
      return { code: "already_filed", message: "The application is filed, and what it says can no longer change." };
    case "AI009":
      // The row is judged after every write, and the applicant has not answered the first question yet.
      return {
        code: "part_one_not_begun",
        message: "The applicant has not started the first part yet, so there is nothing to correct.",
      };
    case "23505":
      return { code: "invalid_request", message: "The same licence is listed twice." };
    case "AI004":
      return { code: "invalid_request", message: "Some of that could not be saved. Check it and try again." };
    default:
      return { code: "part_one_correction_failed", message: error.message };
  }
}

/** The list as the function reads it: positions are the order given. */
const licenceRows = (licences: readonly ApplicantIntakeLicence[]) =>
  licences.map((l, position) => ({
    position,
    state_code: l.state_code,
    agency: l.agency ?? null,
    licence_number: l.licence_number,
    expires_on: l.expires_on ?? null,
    source: "intake",
  }));

async function overwrite(
  admin: SupabaseClient,
  orgId: string,
  invitation: { id: string; driver_id: string },
  intake: Record<string, unknown>,
  licences: readonly ApplicantIntakeLicence[],
): Promise<PartOneCorrectionError | null> {
  const { error } = await admin.rpc("record_applicant_intake", {
    p_org: orgId,
    p_invitation: invitation.id,
    p_driver: invitation.driver_id,
    p_intake: intake,
    p_licences: licenceRows(licences),
    p_endorsements: null,
    p_overwrite: true,
  });
  return error ? refusalOf(error) : null;
}

/**
 * The office's "Correct Part 1" — the whole set, overwriting, audited.
 *
 * ⚠ Refused once the office has APPROVED the application, the same line the draft's own corrections
 * stop at (`applicationIsEditable`): approval tells the driver "this document, now, sign it", and a
 * fact changed after that is one they were not shown. The audit row names the fields and carries no
 * value — a phone number and a licence number are what `apps/api/CLAUDE.md` says never to log.
 */
export async function correctApplicantPartOne(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  body: PartOneCorrection,
  actorId: string,
): Promise<{ ok: true } | PartOneCorrectionError> {
  const invitation = await invitationOf(admin, orgId, invitationId);
  if (!invitation) return NOT_FOUND;
  if (invitation.approved_at) {
    return {
      code: "application_not_editable",
      message: "You approved this application, so what it says is fixed now.",
    };
  }
  if (!(await hasIntakeRow(admin, orgId, invitation.id))) {
    return {
      code: "not_part_one",
      message: "This application was started before the first part existed. Correct its answers below.",
    };
  }

  const { licences, ...fields } = body;
  const refused = await overwrite(admin, orgId, invitation, fields, licences);
  if (refused) return refused;

  await writeAudit(admin, {
    orgId,
    actorId,
    action: "application_part_one_corrected",
    entity: "application_invitations",
    entityId: invitation.id,
    meta: { driverId: invitation.driver_id, fields: [...Object.keys(fields), "licences"] },
  });
  return { ok: true };
}

/**
 * The identity correction on a v2 link — the same writer, with the current licence replaced.
 *
 * ⚠ Why this is needed at all (found 2026-09-28, Q-AW36): `record_applicant_identity` alone writes
 * `drivers` and the draft, and on a v2 link leaves Part 1's licence list holding the OLD licence at
 * position 0. Filing still files the corrected one (`identityOnRecord` overlays `drivers` last), but the
 * list is what the MVR checklist picks the state from and what the drawer and the applicant's page show
 * as "your licences" — so one correction left two answers. Through `record_applicant_intake` the list,
 * `drivers` and the draft move together.
 *
 * Returns null when this is not a v2 link with a licence on file, and the caller keeps the identity
 * writer it always used: a legacy link has no list to disagree with, and a v2 link with no licence yet
 * gets its list from the applicant's own first write, which is fill-only and keeps the office's value
 * on `drivers`.
 */
export async function correctIdentityThroughPartOne(
  admin: SupabaseClient,
  orgId: string,
  invitation: { id: string; driver_id: string },
  body: ApplicantIdentity,
): Promise<{ ok: true } | PartOneCorrectionError | null> {
  if (!(await hasIntakeRow(admin, orgId, invitation.id))) return null;
  const [current, ...others] = await storedLicences(admin, orgId, invitation.id);
  if (!current) return null;
  const corrected = { ...current, state_code: body.cdl_state, licence_number: body.cdl_number };
  const refused = await overwrite(admin, orgId, invitation, { date_of_birth: body.date_of_birth }, [corrected, ...others]);
  return refused ?? { ok: true };
}
