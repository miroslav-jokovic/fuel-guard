import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICATION_RELEASE_ORDER,
  DISCLOSURES,
  isDraftDisclosure,
  planApplicationIntake,
  ssnLast4,
  type ApplicationRelease,
  type ApplicationSubmit,
  type AuthorizationPurpose,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { isSecretBoxConfigured, seal, secretAad } from "../lib/secretBox.js";

/**
 * The applicant's side of hiring — an invitation, a certified application, four signed releases (H5).
 *
 * Everything here runs UNAUTHENTICATED, for somebody who is not yet anyone. The token is the entire
 * access-control story, so it is treated as a credential end to end: 256 bits of entropy, stored
 * only as a SHA-256, compared in constant time, single-use, expiring.
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

interface InvitationRow {
  id: string;
  org_id: string;
  driver_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

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
 */
export async function resolveInvitation(
  admin: SupabaseClient,
  token: string,
  now: Date,
): Promise<InvitationRow | IntakeError> {
  const hash = hashInvitationToken(token);
  const { data } = await admin
    .from("application_invitations")
    .select("id, org_id, driver_id, token_hash, expires_at, used_at, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  const row = data as InvitationRow | null;
  const dead = { code: "invalid_link", message: "This application link is not valid. Ask for a new one." };
  if (!row || !hashEquals(row.token_hash, hash)) return dead;
  if (row.revoked_at || row.used_at) return dead;
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

  const { driverPatch, employment } = planApplicationIntake(body.application);
  const ssn = sealSsn(env, invitation.org_id, body.ssn);

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
  });
  if (error) {
    // DA021 is the race the FOR UPDATE lock caught — the link was spent between resolve and submit.
    if (error.code === "DA021" || /invitation_spent|invitation_not_found/.test(error.message)) {
      return { code: "invalid_link", message: "This application link has already been used." };
    }
    return { code: "submit_failed", message: error.message };
  }
  return {
    applicationId: String((data as { application_id?: string } | null)?.application_id ?? ""),
    driverId: invitation.driver_id,
  };
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
 */
export async function recordRelease(
  admin: SupabaseClient,
  token: string,
  body: ApplicationRelease,
  ctx: SubmitContext,
  now: Date,
): Promise<{ id: string } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;

  const doc = DISCLOSURES[body.purpose];
  if (isDraftDisclosure(doc.version)) {
    return {
      code: "disclosure_not_final",
      message:
        "This disclosure is still draft wording and cannot be signed. The carrier must publish the "
        + "reviewed text first.",
    };
  }

  const { data, error } = await admin
    .from("driver_authorizations")
    .insert({
      org_id: invitation.org_id,
      driver_id: invitation.driver_id,
      purpose: body.purpose,
      disclosure_version: doc.version,
      disclosure_text: doc.body,
      intent_statement: doc.intent,
      method: "esign",
      signed_name: body.signed_name,
      esign_consent_at: now.toISOString(),
      accepted_ip: ctx.ip,
      accepted_user_agent: ctx.userAgent,
      // No `recorded_by`: nobody in the carrier recorded this. The applicant signed it themselves,
      // and a staff id here would misattribute the act to whoever sent the link.
      recorded_by: null,
    })
    .select("id")
    .single();
  if (error || !data) return { code: "sign_failed", message: error?.message ?? "Could not record the signature." };
  return { id: (data as { id: string }).id };
}
