import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICATION_RELEASE_ORDER,
  DISCLOSURES,
  esignConsentRequired,
  isDraftDisclosure,
  planApplicationIntake,
  ssnLast4,
  type ApplicationRelease,
  type ApplicationSubmit,
  type AuthorizationPurpose,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { promoteCaptures } from "./applicationCapture.js";
import { ensureApplicationPdf } from "./applicationPdf/file.js";
import { isSecretBoxConfigured, seal, secretAad } from "../lib/secretBox.js";

/**
 * The applicant's side of hiring — an invitation, a certified application, four signed releases (H5).
 *
 * Everything here runs UNAUTHENTICATED, for somebody who is not yet anyone. The token is the entire
 * access-control story, so it is treated as a credential end to end: 256 bits of entropy, stored
 * only as a SHA-256, compared in constant time, expiring, and spent ONE PHASE AT A TIME — since 0225
 * the link is a session (D-APP1), not a fuse, because the driver who signs four releases and then
 * loses signal must find the same link still open at the next step.
 *
 * ── WHAT THIS REFUSES TO DO WITH A DRAFT DISCLOSURE ────────────────────────────────────────────
 * Every instrument in `DISCLOSURES` is `v0-draft` placeholder text pending counsel (Q-H3), and this
 * service will not put a real person's signature under it. The refusal is tied to the version string
 * rather than to a feature flag on purpose: when real wording lands the versions become `v1` and the
 * gate opens by itself. A flag would have to be remembered, and what would need remembering is "stop
 * collecting signatures on text no lawyer has read".
 */

export type IntakeError = { code: string; message: string };
export const isIntakeError = (v: object): v is IntakeError => "code" in v;

/** 256 bits. The link is the only thing guarding a form that accepts a date of birth and an SSN. */
export function mintInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInvitationToken(token) };
}

export const hashInvitationToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

/** Constant-time compare of two hex digests — never `===` on anything derived from a secret. */
function hashEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * The invitation as the public surface sees it — a session with dated phase stamps (D-APP1, 0225).
 *
 * `used_at` is deliberately absent: 0225 made `submitted_at` the fact and left `used_at` behind as a
 * mirror for three staff-facing readers that A5 removes. A path that folded on both would have two
 * sources of truth for the same question, which is exactly what 0225's header says is tolerated only
 * on the staff side and only until A5.
 */
interface InvitationRow {
  id: string;
  org_id: string;
  driver_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  /** 15 U.S.C. 7001(c) consent recorded (A4 sets it; nothing sets it yet). */
  consented_at: string | null;
  /** All four APPLICATION_RELEASE_ORDER instruments signed (A5 sets it). */
  releases_completed_at: string | null;
  /** The certified §391.21 application filed — stamped inside `submit_driver_application`. */
  submitted_at: string | null;
}

/** What `GET /:token` hands the page so it can open where the driver stopped. */
export interface InvitationPhases {
  consentedAt: string | null;
  releasesCompletedAt: string | null;
  submittedAt: string | null;
}

export const phasesOf = (row: {
  consented_at: string | null;
  releases_completed_at: string | null;
  submitted_at: string | null;
}): InvitationPhases => ({
  consentedAt: row.consented_at,
  releasesCompletedAt: row.releases_completed_at,
  submittedAt: row.submitted_at,
});

/**
 * Resolve a presented token to a live invitation.
 *
 * Looked up BY HASH — the plaintext never touches a query — and then compared again in constant
 * time. The second compare is not redundant paranoia about the index: it keeps the code honest if
 * somebody later widens the lookup, and it costs a microsecond on a path that runs once per hire.
 *
 * Every failure returns the SAME refusal. "Expired" and "no such invitation" are different facts and
 * telling them apart is a probe: an anonymous caller learning that a token EXISTED has learned
 * something about a person applying for a job.
 *
 * ── WHAT IT NO LONGER REFUSES (A1, D-APP1) ────────────────────────────────────────────────────
 * A spent phase. Until 0225 this function killed the token the moment the application was submitted,
 * and `POST /:token/release` — the endpoint that records the driver's own signature on each
 * instrument — resolves through here, so submitting closed the door on the signing `ApplyPage.vue`
 * had promised. Only `revoked_at` and `expires_at` make the whole session dead now; a phase already
 * spent is refused by the write path that owns it, with its own answer, and the other phases stay
 * reachable through the same link.
 */
export async function resolveInvitation(
  admin: SupabaseClient,
  token: string,
  now: Date,
): Promise<InvitationRow | IntakeError> {
  const hash = hashInvitationToken(token);
  const { data } = await admin
    .from("application_invitations")
    .select(
      "id, org_id, driver_id, token_hash, expires_at, revoked_at, consented_at, releases_completed_at, submitted_at",
    )
    .eq("token_hash", hash)
    .maybeSingle();
  const row = data as InvitationRow | null;
  const dead = { code: "invalid_link", message: "This application link is not valid. Ask for a new one." };
  if (!row || !hashEquals(row.token_hash, hash)) return dead;
  if (row.revoked_at) return dead;
  if (Date.parse(row.expires_at) <= now.getTime()) return dead;
  return row;
}

/** The instruments an applicant is asked to sign, with the exact wording, composed server-side. */
export function releasesForApplicant(): Array<{
  purpose: AuthorizationPurpose;
  version: string;
  title: string;
  citation: string;
  body: string;
  intent: string;
  draft: boolean;
}> {
  return APPLICATION_RELEASE_ORDER.map((purpose) => {
    const doc = DISCLOSURES[purpose];
    return { ...doc, draft: isDraftDisclosure(doc.version) };
  });
}

/**
 * Seal the SSN, or decline to hold it (D-HIRE6).
 *
 * Returns the last four either way. The full value is stored ONLY as a secretBox envelope bound to
 * the org, and when sealing is not configured the full value is DROPPED rather than written in the
 * clear — a deployment without an encryption key must not be the deployment that keeps nine digits
 * readable in a jsonb column.
 */
export function sealSsn(env: Env, orgId: string, ssn: string | null | undefined): {
  last4: string | null;
  sealed: string | null;
} {
  if (!ssn) return { last4: null, sealed: null };
  if (!isSecretBoxConfigured(env)) return { last4: ssnLast4(ssn), sealed: null };
  return { last4: ssnLast4(ssn), sealed: seal(env, ssn, secretAad(orgId, "driver_ssn")) };
}

/**
 * The two refusals a LIVE link can give, one per spendable phase (D-APP1).
 *
 * Neither is `invalid_link`, and that is the point of A1: the neutral refusal exists so an anonymous
 * caller cannot learn that a token existed, and these two are only ever reached by a caller who
 * already holds a live one. Telling them what actually happened costs no privacy and saves them
 * asking the carrier for a replacement link that would fix nothing.
 */
export const ALREADY_SUBMITTED: IntakeError = {
  code: "already_submitted",
  message: "This application has already been sent. Reopen the link to see what the carrier received.",
};

/**
 * §390.32(d): an electronic record satisfying a Part 300–399 document requirement must include proof
 * of consent per 15 U.S.C. 7001(c). §391.21 is such a requirement, so the consent is the first act on
 * the link and every other write path calls this before doing anything (A4, D-APP5).
 *
 * `null` means carry on. It refuses only when the consent could actually have been given — see
 * `esignConsentRequired`: an unpublished document cannot gate anything, because nobody could pass it.
 *
 * It lives HERE rather than beside the rest of A4 so the dependency runs one way: `esignConsent.ts`
 * needs `resolveInvitation`, and a service importing back from it would make a cycle out of two
 * modules that are only related by sequence.
 */
export const CONSENT_REQUIRED: IntakeError = {
  code: "esign_consent_required",
  message: "Agree to sign and receive these documents electronically before you go on.",
};

export function requireEsignConsent(invitation: { consented_at: string | null }): IntakeError | null {
  return esignConsentRequired(invitation.consented_at) ? CONSENT_REQUIRED : null;
}

export const RELEASES_COMPLETE: IntakeError = {
  code: "releases_complete",
  message: "Every authorization on this link has already been signed.",
};

export const RELEASE_ALREADY_SIGNED: IntakeError = {
  code: "release_already_signed",
  message: "You have already signed this one.",
};

export interface SubmitContext {
  ip: string | null;
  userAgent: string | null;
}

/** File the application — one transaction, in `submit_driver_application` (0220). */
export async function submitApplication(
  admin: SupabaseClient,
  env: Env,
  token: string,
  body: ApplicationSubmit,
  ctx: SubmitContext,
  now: Date,
): Promise<{ applicationId: string; driverId: string } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  // §390.32(d): an electronic §391.21 application must include proof of 7001(c) consent, so the
  // consent comes first or the document we file is not the one the regulation asked for (A4).
  const consent = requireEsignConsent(invitation);
  if (consent) return consent;
  // The submit phase is this path's own to spend (D-APP1). Said plainly rather than neutrally: only
  // the holder of the token reaches this, `GET /:token` already told them the application is in, and
  // "your link is not valid" for a link that plainly is would send them back to the recruiter for a
  // replacement they do not need.
  if (invitation.submitted_at) return ALREADY_SUBMITTED;

  const { driverPatch, employment } = planApplicationIntake(body.application);
  const ssn = sealSsn(env, invitation.org_id, body.ssn);

  /**
   * A8/D-APP10: the staged photographs become filed documents in the transaction below, so the bytes
   * have to be in the evidence bucket before it opens. A refusal here refuses the SUBMISSION — unlike
   * the PDF further down, a photograph is not regenerable, and filing an application whose licence
   * scan silently did not arrive is the failure this whole staging design exists to prevent. Nothing
   * has been spent, so pressing send again promotes the same set.
   */
  const captures = await promoteCaptures(
    admin, invitation.org_id, invitation.id, invitation.driver_id,
  );
  if (isIntakeError(captures)) return captures;

  const { data, error } = await admin.rpc("submit_driver_application", {
    p_org: invitation.org_id,
    p_invitation: invitation.id,
    p_driver: invitation.driver_id,
    p_payload: body.application,
    p_signed_name: body.application.signed_name,
    p_ip: ctx.ip,
    p_user_agent: ctx.userAgent,
    p_ssn_last4: ssn.last4,
    p_ssn_sealed: ssn.sealed,
    p_driver_patch: driverPatch,
    p_employment: employment,
    /**
     * ⚠ OMITTED when there is nothing to promote, and that is the deploy race, not tidiness. 0230
     * widened this function by dropping the eleven-argument signature and creating a twelve-argument
     * one whose last parameter defaults — so a migration that lands BEFORE this code keeps working.
     * The other order is covered here: an eleven-argument call resolves against the not-yet-migrated
     * function too, which is every submission that exists today. A submission that does carry
     * photographs can only come from a client the new API served, and if the migration is somehow
     * behind it fails loudly rather than dropping a driver's licence on the floor.
     */
    ...(captures.length > 0 ? { p_captures: captures } : {}),
  });
  if (error) {
    // DA022 is the race the FOR UPDATE lock caught — a second submission arrived between this
    // resolve and this stamp (a double-tapped button, or the link open in two tabs).
    if (error.code === "DA022" || /already_submitted/.test(error.message)) return ALREADY_SUBMITTED;
    // DA020/DA021: the invitation is unknown to this org and driver, or revoked, or expired. One
    // refusal for all of them — the transaction's half of the neutrality `resolveInvitation` keeps.
    if (
      error.code === "DA020"
      || error.code === "DA021"
      || /invitation_unusable|invitation_not_found/.test(error.message)
    ) {
      return { code: "invalid_link", message: "This application link is not valid. Ask for a new one." };
    }
    return { code: "submit_failed", message: error.message };
  }
  const applicationId = String((data as { application_id?: string } | null)?.application_id ?? "");

  /**
   * Render the §391.51(b)(1) document, best effort (A6, D-APP9).
   *
   * Deliberately after the transaction and deliberately unable to fail it. The evidence — the
   * payload, the signed rows, the consent — is committed and append-only; this produces a PDF from
   * it. Trading an irreplaceable submission for a regenerable derivative would be the wrong way
   * round, and `ensureApplicationPdf` is idempotent, so the recruiter's first download renders
   * whatever this call could not.
   */
  if (applicationId) {
    try {
      await ensureApplicationPdf(admin, invitation.org_id, applicationId);
    } catch (e) {
      console.error("[application] could not render the application PDF", {
        applicationId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { applicationId, driverId: invitation.driver_id };
}

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
  // A signature given electronically by somebody who never agreed to sign electronically is the
  // gap §390.32(d) exists to close (A4).
  const consent = requireEsignConsent(invitation);
  if (consent) return consent;
  // This path's own phase (D-APP1). The transaction checks it again under a lock; this is the cheap
  // refusal that keeps a finished ceremony from reaching the database at all.
  if (invitation.releases_completed_at) return RELEASES_COMPLETE;

  const doc = DISCLOSURES[body.purpose];
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
