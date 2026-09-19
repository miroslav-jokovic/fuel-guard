import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type CarrierWording, esignConsentRequired, ssnLast4 } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { isSecretBoxConfigured, seal, secretAad } from "../../lib/secretBox.js";

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
 *
 * ⚠ **Since 2026-08-23 that refusal covers SUBMITTING too, not only signing** — see
 * `WORDING_NOT_FINAL`, which moved to `applicationSubmit.ts` with the rest of the filing half in
 * A5b and is unchanged. Until then the ceremony was blocked and the certification was not, so the
 * one document the whole link exists to produce could be filed without the consent §390.32(d)
 * requires behind it.
 *
 * ── WHAT IS HERE, AND WHAT IS NEXT DOOR ───────────────────────────────────────────────────────
 * The SESSION: what a presented token resolves to, which phases it has spent, and what may be asked
 * of it. `applicationSubmit.ts` holds the one phase that ends the session — the certified filing and
 * everything that has to be true before it may happen. ⚠ The dependency runs ONE WAY, submission to
 * session, the same rule `applicationReleases.ts` states for the ceremony.
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
  /** The driver has finished and handed it to the office (F4) — `requestReview` stamps it. */
  review_requested_at: string | null;
  /** The office has read it, corrected what it corrected, and asked for a signature (F4). */
  approved_at: string | null;
  /** The certified §391.21 application filed — stamped inside `submit_driver_application`. */
  submitted_at: string | null;
}

/** What `GET /:token` hands the page so it can open where the driver stopped. */
export interface InvitationPhases {
  consentedAt: string | null;
  releasesCompletedAt: string | null;
  /**
   * The two phases the office owns (F4, 0336).
   *
   * ⚠ They are on the APPLICANT's payload because the applicant's page cannot otherwise tell the
   * three states apart that look identical to it: still filling it in, waiting for the carrier, and
   * asked to sign. Before these were served, a driver who had finished saw the same screen as one who
   * had never started, and the only thing that changed between them was a stamp they could not see.
   */
  reviewRequestedAt: string | null;
  approvedAt: string | null;
  submittedAt: string | null;
}

export const phasesOf = (row: {
  consented_at: string | null;
  releases_completed_at: string | null;
  review_requested_at?: string | null;
  approved_at?: string | null;
  submitted_at: string | null;
}): InvitationPhases => ({
  consentedAt: row.consented_at,
  releasesCompletedAt: row.releases_completed_at,
  reviewRequestedAt: row.review_requested_at ?? null,
  approvedAt: row.approved_at ?? null,
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
      "id, org_id, driver_id, token_hash, expires_at, revoked_at, consented_at, releases_completed_at, "
      + "review_requested_at, approved_at, submitted_at",
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

/**
 * The forensic context of whichever request is writing — who the record says did this, as far as an
 * unauthenticated caller can be said to be anyone.
 *
 * ⚠ It lives in the SESSION module rather than with the submission that named it, and that is
 * deliberate: `recordRelease`, `recordPacketMark` and `recordEsignConsent` all take one too. They
 * record acts rather than file documents, and moving this next to `submitApplication` would make
 * three modules that are not about submitting import the module that is.
 */
export interface SubmitContext {
  ip: string | null;
  userAgent: string | null;
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

/**
 * ⚠ **No default, and the absence is load-bearing (2026-09-13).** There was one: `CODE_WORDING`,
 * the placeholders, under a comment asserting that a forgetful caller therefore failed CLOSED. That
 * is true of every other function that reads a version string — `releasesForApplicant`,
 * `recordRelease`'s own draft check, `applicationWordingIsDraft` — and it is exactly BACKWARDS here.
 * This gate refuses only while the consent CAN be given, so `v0-draft` means "do not ask", and a
 * caller that forgot the carrier's wording got no gate at all.
 *
 * It was not theoretical. `saveDraft`, `openSession` and `recordRelease` all forgot, and the tests
 * could not see it because they published by mocking `ESIGN_CONSENT.version` — a route production
 * cannot take, since 0338 publishes ROWS and leaves the constant at `v0-draft` for ever. Measured on
 * 2026-09-13 against a seeded `org_disclosures`: the draft save answered 200, and the release
 * signature answered **201** — a `driver_authorizations` row written for somebody who had never
 * agreed to sign electronically, which is the §390.32(d) hole A4 was built to close. Pinned by
 * "with the carrier's wording published as rows, and no consent given".
 *
 * So the parameter is required, and the type system is what now asks the question.
 */
export function requireEsignConsent(
  invitation: { consented_at: string | null },
  wording: CarrierWording,
): IntakeError | null {
  return esignConsentRequired(invitation.consented_at, wording.esignConsent) ? CONSENT_REQUIRED : null;
}
