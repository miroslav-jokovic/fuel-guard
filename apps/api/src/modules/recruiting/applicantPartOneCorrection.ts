import type { SupabaseClient } from "@supabase/supabase-js";
import { stopTextsToReplacedPhone } from "./applicantContactMove.js";
import { partOneEdits, type ApplicantIdentity, type ApplicantIntakeLicence, type ApplicationContactMove, type PartOneCorrection } from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";
import { partOneForFiling } from "./applicantIntake.js";
import { recordOfficeEdits, signingStarted, SIGNING_STARTED } from "./applicationEditLog.js";

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
 * ── EVERY CHANGE IS SHOWN TO THE DRIVER, AND NONE LANDS ONCE THEY ARE SIGNING (F3, E7) ─────
 * Each field the correction changes becomes an `application_edits` row, addressed where the application
 * files it (`partOneEdits`), so the driver reads "was / now" on 3.1 before signing, exactly as for a
 * draft correction. Until F3 this wrote only the audit row, and stopped at filing rather than at the
 * driver's first packet mark: the office could change a phone under a driver half way through signing,
 * and the driver was never told.
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
  submitted_at: string | null;
}

async function invitationOf(admin: SupabaseClient, orgId: string, invitationId: string): Promise<CorrectableInvitation | null> {
  const { data } = await admin
    .from("application_invitations")
    .select("id, driver_id, submitted_at")
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
    .select("position, state_code, agency, licence_number, expires_on, kind")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .order("position");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<ApplicantIntakeLicence & { position: number }>)
    .sort((a, b) => a.position - b.position)
    // P3: the type travels with the row — the identity correction posts this list back whole, and a
    // licence re-posted without its `kind` would lose it (0588 writes an absent key as NULL).
    .map(({ state_code, agency, licence_number, expires_on, kind }) => ({ state_code, agency, licence_number, expires_on, kind: kind ?? null }));
}

/**
 * Which of the draft's addresses Part 1's street is filed over: the one with no `to` (the current home,
 * `composeFiledApplication`). 0 when the draft has none yet — Part 1's street is still the current one.
 */
async function currentAddressIndex(admin: SupabaseClient, orgId: string, invitationId: string): Promise<number> {
  const { data } = await admin
    .from("application_drafts")
    .select("payload")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  const addresses = ((data as { payload?: { addresses?: unknown } } | null)?.payload?.addresses);
  if (!Array.isArray(addresses)) return 0;
  const at = addresses.findIndex((a) => {
    const to = (a as { to?: unknown } | null)?.to;
    return to === null || to === undefined || String(to).trim() === "";
  });
  return at < 0 ? 0 : at;
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
    kind: l.kind ?? null,
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
 * ⚠ Refused once the driver has made the first packet mark (F3, E7), the line the draft's own
 * corrections stop at since §9 P5; and once filed, which that implies. It closed at approval until
 * 2026-10-31, then at filing until F3. The driver is shown every change before they sign (the edit rows).
 * The audit row names the fields and carries no value — a phone number and a licence number are what
 * `apps/api/CLAUDE.md` says never to log; the values are in the edit rows, which are the driver's own.
 */
export async function correctApplicantPartOne(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  body: PartOneCorrection,
  actorId: string,
): Promise<{ ok: true; contact: ApplicationContactMove } | PartOneCorrectionError> {
  const invitation = await invitationOf(admin, orgId, invitationId);
  if (!invitation) return NOT_FOUND;
  if (invitation.submitted_at) {
    return {
      code: "application_not_editable",
      message: "This application is signed and filed, so what it says is fixed now.",
    };
  }
  if (!(await hasIntakeRow(admin, orgId, invitation.id))) {
    return {
      code: "not_part_one",
      message: "This application was started before the first part existed. Correct its answers below.",
    };
  }

  if (await signingStarted(admin, orgId, invitation.id)) return SIGNING_STARTED;

  // What Part 1 held, read before the overwrite, so the driver can be shown each change (E7).
  const was = await partOneForFiling(admin, orgId, invitation);
  const currentAddress = await currentAddressIndex(admin, orgId, invitation.id);

  const { licences, ...fields } = body;
  const refused = await overwrite(admin, orgId, invitation, fields, licences);
  if (refused) return refused;

  const unrecorded = was
    ? await recordOfficeEdits(admin, orgId, invitation.id, partOneEdits(was, body, currentAddress), actorId)
    : null;

  await writeAudit(admin, {
    orgId,
    actorId,
    action: "application_part_one_corrected",
    entity: "application_invitations",
    entityId: invitation.id,
    meta: { driverId: invitation.driver_id, fields: [...Object.keys(fields), "licences"] },
  });
  // E3: the phone Part 1 held is the one texts went to; a new one has no consent (`applicantContactMove`).
  const contact = await stopTextsToReplacedPhone(admin, orgId, invitation, was?.intake.phone, body.phone, actorId);
  return unrecorded ?? { ok: true, contact };
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
