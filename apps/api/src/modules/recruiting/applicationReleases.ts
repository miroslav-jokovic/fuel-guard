import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICATION_RELEASE_ORDER,
  DISCLOSURES,
  ESIGN_CONSENT,
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

/**
 * The four authorizations an applicant signs before the form (A5, D-APP4).
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
 * The code's placeholders, as a `CarrierWording`.
 *
 * ⚠ The default for every function below, and the default is the SAFE one: a caller that forgets to
 * load the carrier's published documents gets `v0-draft` and therefore a refusal. Failing closed is
 * the only acceptable direction for a function that decides whether a signature may be taken.
 */
const CODE_WORDING: CarrierWording = { disclosures: DISCLOSURES, esignConsent: ESIGN_CONSENT };

export function releasesForApplicant(wording: CarrierWording = CODE_WORDING): Array<{
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
 * document, signed on its own, and bundling four of them into one atomic write would model in the
 * database exactly the thing the regulation forbids on paper. A half-signed set is a real state that
 * the pipeline already knows how to describe — `applicantProgress` reports which releases are
 * outstanding — rather than an inconsistency to be prevented.
 *
 * ⚠ It IS one transaction per SIGNATURE, since A5 (0228). That is not the same thing: the row and
 * the `releases_completed_at` stamp the last one triggers are the same fact written twice, and a
 * signature filed without the stamp would leave the ceremony asking for an instrument already
 * signed. Four documents, four acts, four transactions — and the fourth also closes the phase.
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
  const consent = requireEsignConsent(invitation);
  if (consent) return consent;
  // This path's own phase (D-APP1). The transaction checks it again under a lock; this is the cheap
  // refusal that keeps a finished ceremony from reaching the database at all.
  if (invitation.releases_completed_at) return RELEASES_COMPLETE;

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
