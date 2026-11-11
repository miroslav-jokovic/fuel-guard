import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applicantFact,
  type FactEditRow,
  type PartOneAnswer,
  type PartOneAnswersView,
} from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";
import { recordOfficeEdits, signingStarted, SIGNING_STARTED } from "./applicationEditLog.js";

/**
 * The office correcting ONE of Part 1's answers that the whole-set correction does not carry
 * (APPLICATION-FIX-PLAN F3; the owner's Q-AM13 ruling, 2026-11-10). The catalogue's `part_one_answer`
 * door: the four drug-and-alcohol statements, "I don't have a medical card yet", the endorsements and
 * the donor gender.
 *
 * ── THROUGH THE ONE WRITER, ONE KEY ───────────────────────────────────────────────────────────
 * `record_applicant_intake` with `p_overwrite = true`, `p_intake` holding only this key, and the licence
 * list and endorsements left alone (`null`). The function writes a key only when it is present, keeps
 * `drivers`' columns for every key absent, and re-writes the identity it already holds — so nothing but
 * this one answer moves (0376/0469; measured against the function body 2026-11-10).
 *
 * ── WHAT THE DRIVER IS SHOWN ──────────────────────────────────────────────────────────────────
 * One `application_edits` row, at the path the driver reads it under: §40.25(j) as the application's
 * `prior_failed_pre_employment_test` (composition files it there), every other key as itself.
 * - A statement carries the office's note (required by `partOneAnswerSchema`), which 3.1 prints beside it.
 * - The donor gender is WITHHELD: the row records that it was replaced and nothing else, because the
 *   answer must not reach anybody who decides the hire (Q-AM13, D-MSUX10). Nor is it read here: the
 *   office types it blind, so there is no "before" to hold.
 *
 * ⚠ The service role bypasses RLS: every read names the org, and the function checks the invitation
 * belongs to it before writing.
 */

export type PartOneAnswerError = { code: string; message: string };
export const isPartOneAnswerError = (v: object): v is PartOneAnswerError => "code" in v;

const NOT_FOUND: PartOneAnswerError = { code: "application_not_found", message: "That application is not in this organization." };

/** The intake row's own columns for these answers. `endorsements` is a text[]; the rest are scalars. */
const COLUMNS = "dot_program_30d, dot_tested_6m, dot_random_12m, prior_positive_2y, medical_card_pending, endorsements, donor_gender";

interface IntakeAnswers {
  prior_positive_2y: boolean | null;
  dot_program_30d: boolean | null;
  dot_tested_6m: boolean | null;
  dot_random_12m: boolean | null;
  medical_card_pending: boolean | null;
  endorsements: string[] | null;
  donor_gender: string | null;
}

async function intakeAnswers(admin: SupabaseClient, orgId: string, invitationId: string): Promise<IntakeAnswers | null> {
  const { data } = await admin
    .from("application_intakes")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  return (data as IntakeAnswers | null) ?? null;
}

/**
 * What the office's review reads of these answers. ⚠ The donor gender as a boolean only: the column is
 * selected so the drawer can say "given", and its value never leaves this function.
 */
export async function partOneAnswersView(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<PartOneAnswersView | null> {
  const row = await intakeAnswers(admin, orgId, invitationId);
  if (!row) return null;
  return {
    dot_program_30d: row.dot_program_30d,
    dot_tested_6m: row.dot_tested_6m,
    dot_random_12m: row.dot_random_12m,
    medical_card_pending: row.medical_card_pending === true,
    endorsements: [...(row.endorsements ?? [])],
    donorGenderGiven: row.donor_gender !== null && row.donor_gender !== "",
  };
}

/** Where the driver reads this answer: the application fact it is composed into, or itself. */
function shownAt(key: PartOneAnswer["key"]): string {
  const fact = applicantFact(`intake.${key}`) ?? applicantFact(`intake.${key}[]`);
  const through = fact && !Array.isArray(fact.packet) && "through" in fact.packet ? fact.packet.through : null;
  // A set answer is catalogued as a list (`cdl_endorsements[]`, F2b) and recorded as the whole set.
  return through ? through.slice("application.".length).replace(/\[\]$/, "") : key;
}

function refusalOf(error: { code?: string; message: string }): PartOneAnswerError {
  switch (error.code) {
    case "AI001": return NOT_FOUND;
    case "AI002": return { code: "invitation_revoked", message: "This invitation was revoked. Nothing was changed." };
    case "AI003": return { code: "already_filed", message: "The application is filed, and what it says can no longer change." };
    case "AI009": return { code: "part_one_not_begun", message: "The applicant has not started the first part yet, so there is nothing to correct." };
    default: return { code: "part_one_correction_failed", message: error.message };
  }
}

export async function correctPartOneAnswer(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  body: PartOneAnswer,
  actorId: string,
): Promise<{ ok: true } | PartOneAnswerError> {
  const { data: inv } = await admin
    .from("application_invitations")
    .select("id, driver_id, submitted_at")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .maybeSingle();
  const invitation = inv as { id: string; driver_id: string; submitted_at: string | null } | null;
  if (!invitation) return NOT_FOUND;
  if (invitation.submitted_at) {
    return { code: "application_not_editable", message: "This application is signed and filed, so what it says is fixed now." };
  }
  if (await signingStarted(admin, orgId, invitation.id)) return SIGNING_STARTED;

  const was = await intakeAnswers(admin, orgId, invitation.id);
  if (!was) {
    return { code: "not_part_one", message: "This application was started before the first part existed. Correct its answers below." };
  }

  const endorsements = body.key === "endorsements";
  const { error } = await admin.rpc("record_applicant_intake", {
    p_org: orgId,
    p_invitation: invitation.id,
    p_driver: invitation.driver_id,
    p_intake: endorsements ? {} : { [body.key]: body.value },
    p_licences: null,
    p_endorsements: endorsements ? body.value : null,
    p_overwrite: true,
  });
  if (error) return refusalOf(error);

  const withheld = applicantFact(`intake.${body.key}`)?.rule === "replace_only";
  const before = body.key === "endorsements" ? [...(was.endorsements ?? [])].sort() : was[body.key];
  const after = Array.isArray(body.value) ? [...body.value].sort() : body.value;
  const row: FactEditRow = {
    path: [shownAt(body.key)],
    before: withheld ? null : before,
    after: withheld ? null : after,
    note: "note" in body ? body.note : null,
    withheld,
  };
  // An unchanged answer is not a correction the driver must read (the same rule as `partOneEdits`) —
  // except a withheld one, whose old value the office cannot see and so cannot know it repeated.
  const unchanged = !withheld && JSON.stringify(before ?? null) === JSON.stringify(after);
  const unrecorded = unchanged ? null : await recordOfficeEdits(admin, orgId, invitation.id, [row], actorId);

  // Names, never values — and the note is not a name either (`apps/api/CLAUDE.md`).
  await writeAudit(admin, {
    orgId,
    actorId,
    action: "application_part_one_corrected",
    entity: "application_invitations",
    entityId: invitation.id,
    meta: { driverId: invitation.driver_id, fields: [body.key] },
  });
  return unrecorded ?? { ok: true };
}
