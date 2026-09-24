import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICANT_IDENTITY_KEYS,
  draftIdentityComplete,
  type ApplicantIdentity,
  type ApplicantIdentityKey,
} from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";
import { loadCarrierWording } from "./carrierWording.js";
import {
  ALREADY_SUBMITTED,
  isIntakeError,
  requireEsignConsent,
  resolveInvitation,
  type IntakeError,
} from "./applicationIntake.js";

/**
 * The applicant's date of birth, licence number and licence state — taken with the permissions
 * (AF3, D-AF1) and written by ONE function (D-AF8, `record_applicant_identity`, 0365).
 *
 * ── TWO CALLERS, ONE WRITER ───────────────────────────────────────────────────────────────────
 * The applicant (public, `p_overwrite = false`) fills gaps only: a value already on `drivers` — the
 * office's correction, a rehire's record — wins, and the draft is handed THAT value rather than what
 * was typed. The office (`p_overwrite = true`) overwrites both. Either way the row and the draft end
 * the transaction agreeing, which is the one property this module exists for: the licence PSP runs
 * against is the licence on the filed application.
 *
 * ── EVERY QUERY ORG-FILTERS ITSELF ────────────────────────────────────────────────────────────
 * ⚠ The service role bypasses RLS. The public half gets its org from a resolved token and the
 * office half from the session, and both still say `.eq("org_id", …)` on every read. Proven by
 * "scopes the office's correction to the caller's org" in `routes/applicantIdentity.test.ts`.
 */

/** The three columns as `drivers` holds them. PostgREST serves a `date` as `YYYY-MM-DD`. */
type IdentityColumns = Record<ApplicantIdentityKey, string | null>;

async function driverIdentity(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<IdentityColumns | null> {
  const { data } = await admin
    .from("drivers")
    .select(APPLICANT_IDENTITY_KEYS.join(", "))
    .eq("org_id", orgId)
    .eq("id", driverId)
    .maybeSingle();
  return (data as IdentityColumns | null) ?? null;
}

/**
 * The values already on `drivers`, for the draft save to lay over whatever the client sent.
 *
 * ── WHY THE DRAFT SAVE NEEDS THIS AT ALL ──────────────────────────────────────────────────────
 * `save_application_draft` (0226) REPLACES the payload wholesale — right for a draft, whose last
 * write is what is on the driver's screen. But a tab opened before the identity was written, or
 * before the office corrected it, holds a payload without those values or with old ones, and its
 * next autosave would put them back: a second writer, arriving by the side door, which is exactly
 * what D-AF8 rules out. So the save lays the ROW's values over the payload before writing it, and
 * the three keys become the server's to decide on every path that writes a draft.
 *
 * ⚠ Only the columns that are SET. A null column means nothing has been recorded yet — an applicant
 * from before AF3 who is typing their licence into the form — and overlaying a null would erase the
 * one copy of what they typed. The 0231 projection files those at submission, fill-only, as before.
 *
 * ⚠ It is a read followed by a write, so a correction landing between the two is not overlaid by
 * THAT save. The next save overlays it, and the identity step and the form are different screens, so
 * the window is one autosave wide and closes itself. Doing it inside `save_application_draft` would
 * close it outright, at the cost of a migration on a function the whole form depends on; recorded in
 * `APPLICANT-FLOW-PLAN.md` §8 rather than decided silently here.
 */
export async function identityOnRecord(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<Partial<Record<ApplicantIdentityKey, string>>> {
  const row = await driverIdentity(admin, orgId, driverId);
  const out: Partial<Record<ApplicantIdentityKey, string>> = {};
  for (const key of APPLICANT_IDENTITY_KEYS) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  return out;
}

/**
 * Is identity complete for this invitation? The ROW and the DRAFT both, and a boolean only.
 *
 * ⚠ Both, although the plan's text says "from the draft keys". The draft alone would pass an
 * applicant from before AF3 whose unfiled draft already holds a licence they typed into the form —
 * and whose `drivers` row therefore holds nothing, so PSP still could not be ordered, which is the
 * whole of what D-AF1 fixes. Requiring the row too sends that applicant through the identity screen
 * once, where the function copies what they give onto the row.
 */
export async function identityOnFile(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  driverId: string,
): Promise<boolean> {
  const onRow = await identityOnRecord(admin, orgId, driverId);
  if (APPLICANT_IDENTITY_KEYS.some((k) => !onRow[k])) return false;
  const { data } = await admin
    .from("application_drafts")
    .select("payload")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  return draftIdentityComplete((data as { payload?: unknown } | null)?.payload);
}

export const IDENTITY_MISSING: IntakeError = {
  code: "identity_missing",
  message: "Enter your date of birth and driver's licence before you sign.",
};

const rpcArgs = (
  orgId: string,
  invitationId: string,
  driverId: string,
  body: ApplicantIdentity,
  overwrite: boolean,
) => ({
  p_org: orgId,
  p_invitation: invitationId,
  p_driver: driverId,
  p_dob: body.date_of_birth,
  p_cdl_number: body.cdl_number,
  p_cdl_state: body.cdl_state,
  p_overwrite: overwrite,
});

/**
 * The applicant's own entry — fill-only (`p_overwrite = false`).
 *
 * ⚠ Answers with the NAMES of any column that kept a value already on file, never the values. The
 * screen needs to know only that something they typed was not used, so it can say "the carrier has
 * this on file already"; telling them what IS on file would read the date of birth back to whoever
 * holds the link, which D-APP16 exists to prevent.
 */
export async function recordApplicantIdentity(
  admin: SupabaseClient,
  token: string,
  body: ApplicantIdentity,
  now: Date,
): Promise<{ keptExisting: ApplicantIdentityKey[] } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  // A4: nothing is written before the 7001(c) consent, and a date of birth is the first thing this
  // path writes. The carrier's published wording, not the placeholders — `requireEsignConsent`'s
  // header has the measured cost of forgetting that.
  const consent = requireEsignConsent(invitation, await loadCarrierWording(admin, invitation.org_id));
  if (consent) return consent;
  if (invitation.submitted_at) return ALREADY_SUBMITTED;

  const { data, error } = await admin.rpc(
    "record_applicant_identity",
    rpcArgs(invitation.org_id, invitation.id, invitation.driver_id, body, false),
  );
  if (error) {
    if (error.code === "AI003") return ALREADY_SUBMITTED;
    if (error.code === "AI004") return { code: "invalid_request", message: "Enter all three." };
    if (error.code === "AI001" || error.code === "AI002") {
      return { code: "invalid_link", message: "This application link is not valid. Ask for a new one." };
    }
    return { code: "identity_failed", message: error.message };
  }
  const kept = (data as { kept_existing?: unknown } | null)?.kept_existing;
  return { keptExisting: Array.isArray(kept) ? (kept as ApplicantIdentityKey[]) : [] };
}

export type IdentityCorrectionError = { code: string; message: string };
export const isIdentityCorrectionError = (v: object): v is IdentityCorrectionError => "code" in v;

/**
 * The office's correction — overwrite (`p_overwrite = true`), audited.
 *
 * ⚠ The audit row names the invitation, the driver and WHICH fields the act covers, and carries no
 * value: a licence number and a date of birth are exactly what `apps/api/CLAUDE.md` says not to
 * log. `drivers`' own row-change trigger already keeps the before and after where the table's
 * access rules apply to it.
 */
export async function correctApplicantIdentity(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  body: ApplicantIdentity,
  actorId: string,
): Promise<{ ok: true } | IdentityCorrectionError> {
  const { data: inv } = await admin
    .from("application_invitations")
    .select("id, driver_id")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .maybeSingle();
  const invitation = inv as { id: string; driver_id: string } | null;
  const notFound = { code: "application_not_found", message: "That application is not in this organization." };
  if (!invitation) return notFound;

  const { error } = await admin.rpc(
    "record_applicant_identity",
    rpcArgs(orgId, invitation.id, invitation.driver_id, body, true),
  );
  if (error) {
    if (error.code === "AI001") return notFound;
    if (error.code === "AI002") {
      return { code: "invitation_revoked", message: "This invitation was revoked. Nothing was changed." };
    }
    if (error.code === "AI003") {
      return { code: "already_filed", message: "The application is filed, and what it says can no longer change." };
    }
    if (error.code === "AI004") return { code: "invalid_request", message: "Enter all three." };
    return { code: "identity_failed", message: error.message };
  }

  await writeAudit(admin, {
    orgId,
    actorId,
    action: "application_identity_corrected",
    entity: "application_invitations",
    entityId: invitation.id,
    meta: { driverId: invitation.driver_id, fields: [...APPLICANT_IDENTITY_KEYS] },
  });
  return { ok: true };
}
