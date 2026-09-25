import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET, handbookPlacementById, handbookStatus, type HandbookMark, type HandbookStatus } from "@silvicom/shared";
import { adoptedPacketMarks } from "./applicationPacketMarks.js";
import { carrierOf, signatureMarkBytes } from "./applicationPdf/sources.js";
import { handbookPdf } from "./applicationPdf/handbook/handbookPdf.js";
import { HANDBOOK_VERSION } from "./applicationPdf/handbook/handbookText.js";
import {
  isIntakeError,
  requireEsignConsent,
  resolveInvitation,
  type IntakeError,
  type SubmitContext,
} from "./applicationIntake.js";
import { loadCarrierWording } from "./carrierWording.js";
import { handbookMarksForPrint, handbookPlacesSigned, handbookPrintFacts } from "./handbookSigning.js";

/**
 * The driver handbook, signed on screen — the driver's half, on their own link (HANDBOOK-SIGNING-PLAN.md
 * HB3; D-HB1).
 *
 * ── WHY THE TOKEN IS ENOUGH ───────────────────────────────────────────────────────────────────
 * `applicationCopy.ts`'s argument holds: this link already signed the application in this person's
 * name. What bounds it is the ORDER the office sets: nothing here works until the application is
 * filed AND the office has opened handbook signing at the desk (0374 refuses a mark otherwise,
 * HB022/HB023), and nothing works after the handbook is filed (HB024).
 *
 * ── THE SIGNATURE IS THE ONE THEY ALREADY ADOPTED ─────────────────────────────────────────────
 * The handbook comes after the packet (D-HB1), so the driver's adopted signature exists. Each place is
 * signed with that name — never a new one typed here — and printed with that picture, so the handbook
 * and the application cannot carry two different signatures for one person on one morning.
 */

export const HANDBOOK_NOT_FILED_YET: IntakeError = {
  code: "handbook_application_not_filed",
  message: "The handbook is signed after your application. Finish signing your application first.",
};
export const HANDBOOK_NOT_OPENED: IntakeError = {
  code: "handbook_not_opened",
  message: "The carrier opens the handbook for signing in their office. Ask them when you are there.",
};
export const HANDBOOK_ALREADY_FILED: IntakeError = {
  code: "handbook_already_filed",
  message: "Your handbook is already signed and filed.",
};
export const HANDBOOK_PLACE_ALREADY_SIGNED: IntakeError = {
  code: "handbook_place_already_signed",
  message: "You have already signed there.",
};
export const HANDBOOK_NO_SIGNATURE: IntakeError = {
  code: "handbook_no_adopted_signature",
  message: "We could not find the signature you adopted for your application. Ask the carrier for help.",
};

/** The link's view of the handbook, for `GET /:token` — null until the application is filed. */
export async function linkHandbookStatus(
  admin: SupabaseClient,
  invitation: { id: string; org_id: string; submitted_at: string | null; handbook_signing_opened_at?: string | null; handbook_filed_at?: string | null },
): Promise<HandbookStatus | null> {
  if (!invitation.submitted_at) return null;
  return handbookStatus({
    submittedAt: invitation.submitted_at,
    openedAt: invitation.handbook_signing_opened_at ?? null,
    filedAt: invitation.handbook_filed_at ?? null,
    signedPlacementIds: await handbookPlacesSigned(admin, invitation.org_id, invitation.id),
  });
}

export async function recordHandbookMark(
  admin: SupabaseClient,
  token: string,
  body: HandbookMark,
  ctx: SubmitContext,
  now: Date,
): Promise<HandbookStatus | IntakeError> {
  // A refused mark says so in the log, with nothing identifying (the packet's A0 lesson).
  const refused = (error: IntakeError): IntakeError => {
    console.warn("[handbook-mark] refused", { code: error.code, placement: body.placement_id });
    return error;
  };
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return refused(invitation);
  const consent = requireEsignConsent(invitation, await loadCarrierWording(admin, invitation.org_id));
  if (consent) return refused(consent);

  // The cheap refusals, in 0374's order. The trigger checks them all again at the insert.
  if (!invitation.submitted_at) return refused(HANDBOOK_NOT_FILED_YET);
  if (invitation.handbook_filed_at) return refused(HANDBOOK_ALREADY_FILED);
  if (!invitation.handbook_signing_opened_at) return refused(HANDBOOK_NOT_OPENED);

  const placement = handbookPlacementById(body.placement_id)!;
  const adopted = (await adoptedPacketMarks(admin, invitation.org_id, invitation.id)).signature;
  if (!adopted) return refused(HANDBOOK_NO_SIGNATURE);

  const { error } = await admin.from("handbook_marks").insert({
    org_id: invitation.org_id,
    invitation_id: invitation.id,
    placement_id: placement.id,
    party: "driver",
    handbook_version: HANDBOOK_VERSION,
    signed_name: adopted,
    affirmed: placement.what,
    signed_ip: ctx.ip,
    signed_user_agent: ctx.userAgent,
  });
  if (error) {
    if (error.code === "23505") return refused(HANDBOOK_PLACE_ALREADY_SIGNED);
    if (error.code === "HB022") return refused(HANDBOOK_NOT_FILED_YET);
    if (error.code === "HB023") return refused(HANDBOOK_NOT_OPENED);
    if (error.code === "HB024") return refused(HANDBOOK_ALREADY_FILED);
    return refused({ code: "handbook_mark_failed", message: "That signature did not go through. Try again." });
  }
  return (await linkHandbookStatus(admin, invitation))!;
}

/** The filed handbook's stored bytes, found through its record — never through `documents` by kind. */
async function filedHandbookBytes(admin: SupabaseClient, orgId: string, driverId: string, invitationId: string): Promise<Buffer | null> {
  const { data: record } = await admin
    .from("qualification_records")
    .select("document_id")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .eq("kind", "handbook")
    .eq("detail->>invitation_id", invitationId)
    .not("document_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const documentId = ((record ?? []) as Array<{ document_id: string }>)[0]?.document_id;
  if (!documentId) return null;
  const { data: doc } = await admin.from("documents").select("storage_path").eq("org_id", orgId).eq("id", documentId).maybeSingle();
  const path = (doc as { storage_path?: string } | null)?.storage_path;
  if (!path) return null;
  const file = await admin.storage.from(DOCUMENTS_BUCKET).download(path);
  return file.data ? Buffer.from(await file.data.arrayBuffer()) : null;
}

/**
 * The handbook as the driver reads it on their link: the carrier's pages with the places signed so far.
 * Once filed, the FILED copy — countersignature and all — which is their copy of what they agreed to.
 *
 * ⚠ Bytes, not a URL, for `/:token/packet`'s reason while signing: nothing is stored until it is filed.
 */
export async function applicantHandbookPdf(
  admin: SupabaseClient,
  token: string,
  now: Date,
): Promise<{ pdf: Buffer; filename: string } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  if (!invitation.submitted_at) return HANDBOOK_NOT_FILED_YET;
  if (!invitation.handbook_signing_opened_at) return HANDBOOK_NOT_OPENED;

  if (invitation.handbook_filed_at) {
    const filed = await filedHandbookBytes(admin, invitation.org_id, invitation.driver_id, invitation.id);
    if (filed) return { pdf: filed, filename: "driver-handbook-signed.pdf" };
  }
  const [{ marks }, facts, carrier, driverSignature] = await Promise.all([
    handbookMarksForPrint(admin, invitation.org_id, invitation.id),
    handbookPrintFacts(admin, invitation.org_id, invitation.driver_id, invitation.id),
    carrierOf(admin, invitation.org_id),
    signatureMarkBytes(admin, invitation.org_id, invitation.id, "signature"),
  ]);
  // The carrier's place stays blank on the reading copy: the countersignature is the office's act,
  // and it is drawn only on the document that files it.
  marks.delete("h4c");
  const pdf = await handbookPdf({ carrier: { name: carrier.name }, ...facts, marks, driverSignature, countersign: null });
  return { pdf, filename: "driver-handbook.pdf" };
}
