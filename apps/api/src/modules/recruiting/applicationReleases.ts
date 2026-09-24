import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICATION_RELEASE_ORDER,
  isDraftDisclosure,
  type ApplicationRelease,
  type AuthorizationPurpose,
  type CarrierWording,
} from "@silvicom/shared";
import { loadCarrierWording } from "./carrierWording.js";
import {
  isIntakeError,
  requireEsignConsent,
  resolveInvitation,
  type IntakeError,
  type SubmitContext,
} from "./applicationIntake.js";
import { IDENTITY_MISSING, identityOnFile } from "./applicantIdentity.js";

/**
 * The five authorizations an applicant signs before the form (A5, D-APP4).
 *
 * ── WHY THIS IS ITS OWN MODULE ────────────────────────────────────────────────────────────────
 * Split out of `applicationIntake.ts` on 2026-09-11 when that file reached the 500-line budget, and
 * along a real seam rather than an arbitrary one: FCRA §604(b)(2) makes each instrument its own
 * document, signed on its own, and the ceremony that collects them is a different act from the
 * intake that files the application. `applicationIntake.ts` owns the SESSION — resolving a token,
 * the phases, the certified submission; this owns the SIGNATURES taken during it.
 *
 * ⚠ The direction of the dependency is deliberate and must not reverse: this module imports the
 * session, the session knows nothing about the ceremony. A cycle here would be the first symptom of
 * the split having been made for the line count rather than for the seam.
 */

/**
 * ⚠ The wording is a required argument, here and in `requireEsignConsent`. There was a
 * `CODE_WORDING` default — the placeholders — defended as failing closed, which it does for THIS
 * function and did not for that one. One shared default that is safe in one direction and open in
 * the other is not a default worth keeping; 2026-09-13's §390.32(d) hole is what it cost.
 */
export function releasesForApplicant(wording: CarrierWording): Array<{
  purpose: AuthorizationPurpose;
  version: string;
  title: string;
  citation: string;
  body: string;
  intent: string;
  draft: boolean;
}> {
  return APPLICATION_RELEASE_ORDER.map((purpose) => {
    const doc = wording.disclosures[purpose];
    return { ...doc, draft: isDraftDisclosure(doc.version) };
  });
}

export const RELEASES_COMPLETE: IntakeError = {
  code: "releases_complete",
  message: "Every authorization on this link has already been signed.",
};

export const RELEASE_ALREADY_SIGNED: IntakeError = {
  code: "release_already_signed",
  message: "You have already signed this one.",
};

/**
 * Record one signed release.
 *
 * The server composes the instrument from `DISCLOSURES` — the request carries who signed and how,
 * never what they signed, which is the rule 0092 set for `hazmat_reviews.attestation` and 0215
 * repeated for authorizations. A client-authored disclosure is worth nothing when the file is read.
 *
 * NOT part of the submit transaction, deliberately: FCRA §604(b)(2) makes each instrument its own
 * document, signed on its own, and bundling five of them into one atomic write would model in the
 * database exactly the thing the regulation forbids on paper. A half-signed set is a real state that
 * the pipeline already knows how to describe — `applicantProgress` reports which releases are
 * outstanding — rather than an inconsistency to be prevented.
 *
 * ⚠ It IS one transaction per SIGNATURE, since A5 (0228). That is not the same thing: the row and
 * the `releases_completed_at` stamp the last one triggers are the same fact written twice, and a
 * signature filed without the stamp would leave the ceremony asking for an instrument already
 * signed. Five documents, five acts, five transactions — and the fifth also closes the phase.
 */
export async function recordRelease(
  admin: SupabaseClient,
  token: string,
  body: ApplicationRelease,
  ctx: SubmitContext,
  now: Date,
): Promise<{ id: string; signedCount: number; completed: boolean } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  const wording = await loadCarrierWording(admin, invitation.org_id);
  // A signature given electronically by somebody who never agreed to sign electronically is the
  // gap §390.32(d) exists to close (A4).
  //
  // ⚠ `wording` — the carrier's published rows, loaded on the line above — and NOT the code's
  // placeholders. This call omitted it until 2026-09-13 and therefore recorded a release for an
  // applicant with no consent behind it: measured, 201, against a published `org_disclosures`.
  const consent = requireEsignConsent(invitation, wording);
  if (consent) return consent;
  // This path's own phase (D-APP1). The transaction checks it again under a lock; this is the cheap
  // refusal that keeps a finished ceremony from reaching the database at all.
  if (invitation.releases_completed_at) return RELEASES_COMPLETE;
  // D-AF1 (AF3): identity comes with the permissions, because PSP, the MVR and the Clearinghouse
  // query all run on it before the application exists — and PSP is ordered on the strength of
  // exactly these signatures. A full set of permissions for somebody the office still cannot
  // screen would be a finished step that finishes nothing.
  if (!(await identityOnFile(admin, invitation.org_id, invitation.id, invitation.driver_id))) {
    return IDENTITY_MISSING;
  }

  const doc = wording.disclosures[body.purpose];
  if (isDraftDisclosure(doc.version)) {
    return {
      code: "disclosure_not_final",
      message:
        "This disclosure is still draft wording and cannot be signed. The carrier must publish the "
        + "reviewed text first.",
    };
  }

  const { data, error } = await admin.rpc("record_driver_release", {
    p_org: invitation.org_id,
    p_invitation: invitation.id,
    p_driver: invitation.driver_id,
    p_purpose: body.purpose,
    p_version: doc.version,
    p_text: doc.body,
    p_intent: doc.intent,
    p_signed_name: body.signed_name,
    p_ip: ctx.ip,
    p_user_agent: ctx.userAgent,
    // The vocabulary lives here, not in the migration: a fifth instrument is a change to one array.
    p_expected_count: APPLICATION_RELEASE_ORDER.length,
  });
  if (error) {
    if (error.code === "DR023" || /already_signed/.test(error.message)) return RELEASE_ALREADY_SIGNED;
    if (error.code === "DR022" || /releases_already_complete/.test(error.message)) return RELEASES_COMPLETE;
    if (
      error.code === "DR020"
      || error.code === "DR021"
      || /invitation_unusable|invitation_not_found/.test(error.message)
    ) {
      return { code: "invalid_link", message: "This application link is not valid. Ask for a new one." };
    }
    return { code: "sign_failed", message: error.message };
  }
  const row = data as { authorization_id?: string; signed_count?: number; completed?: boolean } | null;
  return {
    id: String(row?.authorization_id ?? ""),
    signedCount: Number(row?.signed_count ?? 0),
    completed: Boolean(row?.completed),
  };
}

/**
 * Which instruments this link has already collected — so a resumed ceremony picks up at the next one.
 *
 * Keyed on the INVITATION and not on the driver: a rehire may have signed the same purposes a year
 * ago on a different application, and those signatures do not discharge this one. PSP's account
 * agreement is explicit that a signed authorization is required in advance of each request.
 */
export async function signedReleases(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<AuthorizationPurpose[]> {
  const { data } = await admin
    .from("driver_authorizations")
    .select("purpose")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .is("revokes", null);
  return ((data ?? []) as Array<{ purpose: AuthorizationPurpose }>).map((r) => r.purpose);
}
