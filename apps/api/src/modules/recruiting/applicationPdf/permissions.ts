import type { SupabaseClient } from "@supabase/supabase-js";
import { applicationProgress, liveAuthorization, type AuthorizationPurpose } from "@silvicom/shared";
import { isPreviewError, type PreviewError } from "./preview.js";
import {
  renderPermissionsDocument,
  type PermissionsConsent,
  type PermissionsInstrument,
} from "./permissionsDocument.js";
import { carrierOf, signatureMarkBytes } from "./sources.js";

/**
 * The office's printable record of what an applicant has signed (B2).
 *
 * ── WHY THIS READS THE TABLE ITSELF INSTEAD OF CALLING `authorizationsFor` ────────────────────
 * ⚠ `sources.ts`'s reader is right for the FILED document and wrong here, and the difference is one
 * `.is("revokes", null)`. That filter drops revocation ROWS — it does not drop a grant that a later
 * row revoked. The filed application wants exactly that: it records what was signed on the day it was
 * signed, and a revocation that happened afterwards is not part of that record. This document answers
 * a question in the present tense — *what may the carrier rely on right now* — so it has to see both
 * kinds of row, fold them with `liveAuthorization`, and print the revocation on the instrument it
 * cancelled. Reusing the filed document's reader would have produced a page saying an applicant
 * authorised something they had withdrawn, which is the one error on this document that could cost
 * somebody a lawful basis.
 *
 * ── AND WHY THE REFUSALS ARE THE PREVIEW'S TYPE ───────────────────────────────────────────────
 * Same `{ code, message }` shape, deliberately: the route maps ONE `status()` table over both PDF
 * endpoints, and a second error type would be a second table that drifts from it by one code.
 */

export type PermissionsError = PreviewError;
export const isPermissionsError = isPreviewError;

export interface ApplicationPermissions {
  pdf: Buffer;
  filename: string;
}

interface InvitationRow {
  id: string;
  org_id: string;
  driver_id: string;
  application_sent_at: string | null;
  review_requested_at: string | null;
  approved_at: string | null;
  signing_opened_at: string | null;
  submitted_at: string | null;
}

interface AuthorizationRow {
  id: string;
  purpose: string;
  disclosure_version: string;
  disclosure_text: string;
  intent_statement: string;
  signed_name: string;
  accepted_at: string;
  method: string;
  accepted_ip: string | null;
  accepted_user_agent: string | null;
  revokes: string | null;
  revoke_reason: string | null;
}

/**
 * The grants, each carrying the revocation that cancelled it and whether it is the one in force.
 *
 * ⚠ `liveAuthorization` rather than a predicate written here. It is the fold `AuthorizationsPanel`
 * and `hiringChecklist` both use, and the whole point of taking it from `packages/shared` is that the
 * screen, the checklist and this document cannot disagree about which release is in force.
 */
function foldInstruments(rows: readonly AuthorizationRow[]): PermissionsInstrument[] {
  const revocations = new Map<string, AuthorizationRow>();
  for (const row of rows) if (row.revokes) revocations.set(row.revokes, row);

  const grants = rows.filter((r) => r.revokes === null);
  const liveIds = new Set(
    [...new Set(grants.map((g) => g.purpose))]
      .map((purpose) => liveAuthorization(rows, purpose as AuthorizationPurpose)?.id)
      .filter((id): id is string => id !== undefined),
  );

  return grants.map((auth) => {
    const revocation = revocations.get(auth.id) ?? null;
    return {
      auth,
      live: liveIds.has(auth.id),
      revoked: revocation
        ? { at: revocation.accepted_at, reason: revocation.revoke_reason }
        : null,
    };
  });
}

export async function applicationPermissionsPdf(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  now: Date = new Date(),
): Promise<ApplicationPermissions | PermissionsError> {
  const { data } = await admin
    .from("application_invitations")
    // The service role bypasses RLS, so the org filter is the only thing between two carriers.
    .select("id, org_id, driver_id, application_sent_at, review_requested_at, approved_at, signing_opened_at, submitted_at")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .maybeSingle();
  const invitation = (data as InvitationRow | null) ?? null;
  if (!invitation) {
    return { code: "application_not_found", message: "There is no application on this invitation." };
  }

  const { data: authRows } = await admin
    .from("driver_authorizations")
    .select(
      "id, purpose, disclosure_version, disclosure_text, intent_statement, signed_name, accepted_at, "
      + "method, accepted_ip, accepted_user_agent, revokes, revoke_reason",
    )
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .order("accepted_at", { ascending: true });
  const rows = (authRows ?? []) as unknown as AuthorizationRow[];

  const { data: consentRow } = await admin
    .from("esign_consents")
    .select(
      "disclosure_version, disclosure_text, intent_statement, consented_at, withdrawn_at, "
      + "applicant_ip, applicant_user_agent",
    )
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  const consent = (consentRow ?? null) as PermissionsConsent | null;

  const instruments = foldInstruments(rows);
  if (!consent && instruments.length === 0) {
    /**
     * ⚠ A sentence on the screen rather than a document with five "Not signed yet" rows on it. The
     * office prints these and posts them, and a printed page headed *Signed permissions* that records
     * nothing signed is a piece of paper that can only be misread. The same judgement `preview.ts`
     * makes for a link nobody has typed into.
     */
    return {
      code: "nothing_signed_yet",
      message:
        "This applicant has not signed anything yet, so there is nothing to print. The permissions "
        + "are the first thing they are asked for after they open their link.",
    };
  }

  const { data: driverRow } = await admin
    .from("drivers")
    .select("first_name, last_name")
    .eq("org_id", orgId)
    .eq("id", invitation.driver_id)
    .maybeSingle();
  const driver = (driverRow ?? null) as { first_name: string | null; last_name: string | null } | null;

  /**
   * The certification, once there is one — and this is the read that keeps the certificate page
   * honest after the application is filed. Keyed on the invitation because that is what this whole
   * document is keyed on; `driver_applications` carries `invitation_id` for exactly this join.
   */
  const { data: appRow } = await admin
    .from("driver_applications")
    .select("id, signed_name, certified_at, applicant_ip, applicant_user_agent")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  const application = appRow as {
    id: string;
    signed_name: string;
    certified_at: string;
    applicant_ip: string | null;
    applicant_user_agent: string | null;
  } | null;

  const { data: draftRow } = await admin
    .from("application_drafts")
    .select("invitation_id")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  const hasDraft = draftRow !== null;

  const pdf = await renderPermissionsDocument({
    carrier: await carrierOf(admin, orgId),
    applicant: { first_name: driver?.first_name ?? null, last_name: driver?.last_name ?? null },
    invitationId: invitation.id,
    renderedAt: now,
    instruments,
    consent,
    // The applicant's own drawn mark, if they gave one — the same decoration the filed document puts
    // beside the same typed names (D-APP8). Every failure to read it costs the squiggle, never the
    // document; `signatureMarkBytes` is where that is enforced.
    signatureMark: await signatureMarkBytes(admin, orgId, invitationId),
    certification: application
      ? {
          applicationId: application.id,
          signedName: application.signed_name,
          certifiedAt: application.certified_at,
          applicantIp: application.applicant_ip,
          applicantUserAgent: application.applicant_user_agent,
        }
      : null,
    /**
     * ⚠ The draft is read for ONE bit — whether there is one — and that is the whole reason the read
     * is here. `applicationProgress` cannot tell *not opened* from *filling it in* without it, and
     * the alternative was to pass a value chosen because nothing prints it today. A field that is
     * true only as long as nobody looks at it is how a document comes to assert something nobody
     * checked; `permissionsDocument.ts` says where this one is and is not drawn.
     */
    stage: applicationProgress(
      {
        applicationSentAt: invitation.application_sent_at,
        reviewRequestedAt: invitation.review_requested_at,
        approvedAt: invitation.approved_at,
        signingOpenedAt: invitation.signing_opened_at,
        submittedAt: invitation.submitted_at,
      },
      hasDraft,
    ),
  });

  return { pdf, filename: `permissions-${invitation.id}.pdf` };
}
