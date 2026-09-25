import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applicationAwaitsSignature,
  applicationWordingIsDraft,
  planApplicationIntake,
  type ApplicationSubmit,
  type ApplyingAs,
  applyingAsOf,
  driverPlacementIds,
  packetDriverMarkCount,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { loadCarrierWording } from "./carrierWording.js";
import { promoteCaptures } from "./applicationCapture.js";
import { ensureApplicationPdf } from "./applicationPdf/file.js";
import {
  ALREADY_SUBMITTED,
  isIntakeError,
  phasesOf,
  requireEsignConsent,
  resolveInvitation,
  sealSsn,
  type IntakeError,
  type SubmitContext,
} from "./applicationIntake.js";
import { identityOnRecord } from "./applicantIdentity.js";

/**
 * Filing the certified §391.21 application — the last act on the link, and the only irreversible one.
 *
 * ── WHY THIS IS A FILE OF ITS OWN (A5b, 2026-09-18) ───────────────────────────────────────────
 * `applicationIntake.ts` stood at 497 lines of a 500-line budget, and A5b — teaching
 * `resolveInvitation` to accept a second token hash — is a change inside it. A refactor bundled into
 * a feature step produces a diff in which nobody can see the feature, which is how the file-size
 * gate comes to be waived rather than obeyed; `ApplyPage.vue` (#883) and `usePacketCeremony.ts`
 * (#888) were split ahead of their features for the same reason and in the same order.
 *
 * The seam is not arbitrary and predates the split. `applicationIntake.ts` is the SESSION: what a
 * presented token resolves to, which phases it has spent, and what may be asked of it. This is the
 * one phase that ENDS the session, together with everything that has to be true before it may.
 *
 * ── THE DEPENDENCY STILL RUNS ONE WAY ─────────────────────────────────────────────────────────
 * ⚠ Submission knows about the session; the session knows nothing about submission, exactly as
 * `applicationReleases.ts` states the rule for the ceremony. `SubmitContext` stayed behind in the
 * session module for that reason and not by oversight: three other write paths take one, and they
 * record acts rather than file documents. A cycle here would be the first symptom of a seam drawn
 * for line count rather than for meaning.
 */

/**
 * The refusal that closes the §390.32(d) window (2026-08-23).
 *
 * ── WHAT WAS REACHABLE, AND WHY IT WAS REACHABLE ON PURPOSE ───────────────────────────────────
 * `esignConsentRequired()` is armed by counsel's review rather than by a flag: it returns false while
 * `ESIGN_CONSENT` is `v0-draft`, because requiring a consent that `recordEsignConsent` refuses to
 * record would take the application offline with no way through it. That reasoning is correct and it
 * had a consequence nobody had followed to the end — **a driver could certify a §391.21(b)
 * application with no 7001(c) consent behind it and no authorization signed.** 49 CFR §390.32(d)
 * requires an electronic record satisfying a Part 300–399 document requirement to include proof of
 * consent per 15 U.S.C. 7001(c). A record filed in that window does not have it.
 *
 * ⚠ **And the defect would have been permanent, not transient.** Submitting spends the phase
 * (`submitted_at`), so that invitation's file could never afterwards acquire the consent it was
 * missing — the driver would have to be re-invited into an empty form.
 *
 * ── WHY MORE THAN THE ESIGN CONSENT, AND WHY NOT THE WHOLE CATALOGUE ──────────────────────────
 * The narrow gate would be `isDraftDisclosure(ESIGN_CONSENT.version)`, which is the one that opens
 * the §390.32(d) hole exactly. It is not enough: while the releases are draft `ApplyPage` skips
 * the ceremony entirely, so a submission files a §391.21 application with **zero** authorizations
 * onto a link that is now spent — a qualification file that can never be completed for that
 * applicant, which §390.32(d) does not describe and which is just as unfixable.
 *
 * ⚠ Not the whole catalogue, although since D-AF4 (2026-09-24) the two cover the same five
 * instruments. The predicate is `applicationWordingIsDraft()` — the 7001(c) consent plus exactly the
 * instruments this path collects — so that a purpose added to the catalogue for an office-only
 * workflow can never start holding a driver's submission on a document the driver has no part in.
 *
 * The gate is tied to the version strings for the same reason every other one here is: when
 * counsel's wording lands the versions become `v1` and this disappears by itself. Nothing has to be
 * remembered, and what would need remembering is "start refusing to file records the regulation
 * will not recognise".
 */
/**
 * The office has not approved it yet (F4, D-AX11) — so there is nothing to certify.
 *
 * ── WHY THE SERVER REFUSES AND NOT ONLY THE PAGE ──────────────────────────────────────────────
 * §391.21(b)(12) has the applicant certify that "all entries on it and information in it are true and
 * complete", and since F4 the office can change an entry between the driver sending the application
 * and the driver signing it. A certification taken before that review is a certification of a
 * document that may not be the one filed — and `submitted_at` spends the phase, so the file it
 * produces could never afterwards be corrected.
 *
 * ⚠ This refusal shipped in a SEPARATE merge from the page that hands the application over (F4 4b),
 * and in that order deliberately: a gate landing first would have refused every submission from the
 * client that was still live, which is the deploy-window rule applied to behaviour rather than to a
 * column. By the time this is served, every page in the field sends for review first.
 */
export const NOT_YET_APPROVED: IntakeError = {
  code: "not_yet_approved",
  message:
    "The carrier has not finished checking this application yet. Nothing is lost — you sign it in "
    + "their office, and they will contact you about coming in.",
};

export const WORDING_NOT_FINAL: IntakeError = {
  code: "disclosure_not_final",
  message:
    "This carrier has not published its final wording yet, so an application sent now would be "
    + "missing the consents that have to go with it. Nothing you have typed is lost — they have "
    + "been told, and this link will work the moment they publish.",
};


export const PACKET_NOT_SIGNED: IntakeError = {
  code: "packet_not_signed",
  message: "Sign every place on the application form before sending it.",
};

export const PACKET_NAME_MISMATCH: IntakeError = {
  code: "packet_name_mismatch",
  message: "The name on this application is not the one the form was signed with.",
};

/**
 * May this session file? — the packet's half of the answer (D-PKT15).
 *
 * ⚠ **Written HERE rather than imported from `applicationPacketMarks.ts`, and the reason survived
 * the A5b split unchanged.** That module imports the session, and `applicationReleases.ts` states
 * the rule both splits were made under: the ceremony knows about the session, the session knows
 * nothing about the ceremony, and a cycle is the first symptom of a seam drawn for line count rather
 * than for meaning. "Is this document complete enough to file" is a question about the session, and
 * it is now asked in the module that does the filing — one door further from the ceremony than
 * before, never closer. It reads the table directly: one query and no dependency.
 *
 * ⚠ The expected count comes from `packetDriverMarkCount()` rather than a literal, the same division
 * `record_packet_mark` already draws: the vocabulary lives in TypeScript, and counsel ruling on page
 * 19's duplicated line moves one array rather than an array and a number nobody remembers to change.
 */
export async function packetIsSignedThrough(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  signedName: string,
  applyingAs: ApplyingAs | null,
): Promise<IntakeError | null> {
  const { data } = await admin
    .from("application_packet_marks")
    .select("placement_id, mark, signed_name")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId);
  const rows = (data ?? []) as Array<{ placement_id: string; mark: string; signed_name: string }>;

  // ⚠ DISTINCT placements, not rows. The unique index makes a duplicate impossible today; counting
  // rows would still be the wrong question, because what has to be true is that every PLACE carries
  // a mark, and a count is only a proxy for that while nothing can be marked twice.
  const marked = new Set(rows.map((r) => r.placement_id));
  const missing = driverPlacementIds(applyingAs).filter((id) => !marked.has(id));
  if (missing.length > 0) return PACKET_NOT_SIGNED;
  if (marked.size < packetDriverMarkCount(applyingAs)) return PACKET_NOT_SIGNED;

  /**
   * The SIGNATURE the driver adopted, which `record_packet_mark` has pinned to one value per link
   * per kind since 0340.
   *
   * ⚠ **`mark === "signature"`, and the filter is the whole point (Q-PKT8).** There are two adopted
   * marks, not one: `p05`, `p06` and `p09` take initials, which D-PKT6 calls *"a SECOND adopted mark
   * and not an abbreviation of the first"*. §391.21(b)(12)'s `signed_name` is the applicant's
   * signature, so a comparison that happened to land on an initials row would refuse a packet that
   * was signed through correctly — and which row `rows[0]` is, is PostgREST's choice, so it would
   * refuse intermittently. The three initials rows are evidence of the same ceremony; they are just
   * not the name the filed application is signed with.
   */
  const adopted = rows.find((r) => r.mark === "signature")?.signed_name?.trim();
  if (!adopted || adopted !== signedName.trim()) return PACKET_NAME_MISMATCH;
  return null;
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
  // ⚠ Loaded HERE rather than taken as a parameter (0338). The invitation is what names the org, and
  // a caller that could forget to pass the carrier's published wording is a caller that could open
  // the signing gate on placeholder text. Nothing upstream can get this wrong because nothing
  // upstream is asked.
  const wording = await loadCarrierWording(admin, invitation.org_id);
  // §390.32(d): an electronic §391.21 application must include proof of 7001(c) consent, so the
  // consent comes first or the document we file is not the one the regulation asked for (A4).
  const consent = requireEsignConsent(invitation, wording);
  if (consent) return consent;
  // The submit phase is this path's own to spend (D-APP1). Said plainly rather than neutrally: only
  // the holder of the token reaches this, `GET /:token` already told them the application is in, and
  // "your link is not valid" for a link that plainly is would send them back to the recruiter for a
  // replacement they do not need.
  if (invitation.submitted_at) return ALREADY_SUBMITTED;
  /**
   * ⚠ Read through the shared predicate, not from `approved_at` directly. `applicationAwaitsSignature`
   * is what the office's drawer and the applicant's page both read, and three readings of the same
   * three timestamps are three chances for two screens to disagree about whether a driver may sign.
   */
  if (!applicationAwaitsSignature(phasesOf(invitation))) return NOT_YET_APPROVED;
  // Last of the refusals, in the same position `recordRelease` puts its own: the phase questions are
  // about THIS link and are cheap, the wording question is about the carrier. See WORDING_NOT_FINAL.
  if (applicationWordingIsDraft(wording)) return WORDING_NOT_FINAL;

  /**
   * ⚠ **The packet must be signed through before anything is filed (D-PKT15, owner 2026-09-14).**
   *
   * Until today the Send button was held in the UI and the SERVER would file happily with none of the
   * twenty-two marks — so a packet with blank signature lines was reachable by anything that was not
   * that one screen: a replayed request, a second tab on an older bundle, curl. The one outcome the
   * whole walk exists to prevent had no floor under it.
   *
   * ⚠ **And the signature of record is CHECKED, not accepted.** §391.21(b)(12)'s `signed_name` still
   * travels in the payload, because `driver_applications` is append-only and every historical row
   * must keep re-parsing — but it is no longer a second thing the driver types. It is the mark they
   * adopted, and this refuses a submission whose name disagrees with the one
   * `application_packet_marks` recorded. Deriving beats restating: the name on the filed document and
   * the name on the pages are now the same fact, and the database is what says so.
   */
  // ⚠ `applying_as` from the payload being FILED, never the draft (Q-HM14): the lines this demands
  // and the lines the overlay prints are then decided by the one document that goes into the file.
  const packet = await packetIsSignedThrough(
    admin, invitation.org_id, invitation.id, body.application.signed_name, applyingAsOf(body.application),
  );
  if (packet) return packet;

  /**
   * ⚠ **The identity on `drivers` is what gets filed, whatever the client sent (AF3, D-AF8).** The
   * filed document is built from this request body, and the body is whatever the applicant's tab
   * held — a tab opened before the office corrected the licence still holds the old one. Filed as
   * sent, the application would name a different licence from the one PSP was ordered against, and
   * that disagreement is the one D-AF8 exists to rule out. So the row's three values are laid over
   * the body here, the same overlay the draft save applies (`identityOnRecord`); columns still null
   * — an applicant from before AF3 — leave what they typed alone, for the 0231 projection to file.
   */
  const application = {
    ...body.application,
    ...(await identityOnRecord(admin, invitation.org_id, invitation.driver_id)),
  };

  const { driverPatch, employment } = planApplicationIntake(application);
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
    p_payload: application,
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
