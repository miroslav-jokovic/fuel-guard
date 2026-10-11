import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET, handbookPlacementById, handbookStatus, type HandbookMark, type LinkHandbookStatus } from "@silvicom/shared";
import { adoptedPacketMarks } from "./applicationPacketMarks.js";
import { HANDBOOK_VERSION } from "./applicationPdf/handbook/handbookText.js";
import {
  isIntakeError,
  requireEsignConsent,
  resolveInvitation,
  type IntakeError,
  type SubmitContext,
} from "./applicationIntake.js";
import { loadCarrierWording } from "./carrierWording.js";
import { handbookPlacesSigned } from "./handbookSigning.js";
import { handbookReadingCopy } from "./handbookPreview.js";
import { adoptionForMark } from "./documentAdoption.js";

/**
 * The driver handbook, signed on screen — the driver's half, on their own link (HANDBOOK-SIGNING-PLAN.md
 * HB3; D-HB1).
 *
 * ── WHY THE TOKEN IS ENOUGH ───────────────────────────────────────────────────────────────────
 * `applicationCopy.ts`'s argument holds: this link already signed the application in this person's
 * name. What bounds it is the ORDER: nothing here works until the office has sent the envelope AND the
 * application is filed (0374 refuses a mark otherwise, HB022/HB023 as 0382 left them), and nothing works
 * after the handbook is filed (HB024).
 *
 * ── ONE ENVELOPE (D-AW16, C3s4b) ──────────────────────────────────────────────────────────────
 * The envelope the office sent (`signing_opened_at`) opens the handbook — there is no second press at
 * the desk any more — so the driver who files the packet goes straight on to these five places on the
 * same phone and link. The sent link's 72 hours and its five-strike stop (C3s3a) guard them too.
 *
 * ── THE SIGNATURE IS THE ONE THEY ALREADY ADOPTED ─────────────────────────────────────────────
 * Since C3s2a it is the link's ADOPTION (D-AW15): screen 13 made it before the permissions, so every
 * link that reaches the handbook has one. Each place is signed with its typed text — never a new one
 * typed here — records its `adoption_id`, and is printed with its picture, so the handbook and the
 * application cannot carry two different signatures for one person on one morning. A link whose
 * adoption never saved (A8b) signs with the packet's adopted name, as the handbook always did.
 *
 * ⚠ The C0b workaround that let a handbook adopt its own signature (A-1) is gone: it existed for one
 * invitation filed before the packet was signed on screen, `d61557dc`, which P2 purged; production
 * holds no invitation it could apply to (measured 2026-09-28).
 */

export const HANDBOOK_NOT_FILED_YET: IntakeError = {
  code: "handbook_application_not_filed",
  message: "The handbook is signed after your application. Finish signing your application first.",
};
/**
 * ⚠ Unreachable on a filed application, which is the only kind that gets this far: the packet's first
 * place is refused until the envelope is sent (DR036). Kept as the cheap twin of HB023.
 */
export const HANDBOOK_NOT_OPENED: IntakeError = {
  code: "handbook_not_opened",
  message: "The carrier has not sent your application for signing. Ask them when you are there.",
};
export const HANDBOOK_ALREADY_FILED: IntakeError = {
  code: "handbook_already_filed",
  message: "Your handbook is already signed and filed.",
};
export const HANDBOOK_PLACE_ALREADY_SIGNED: IntakeError = {
  code: "handbook_place_already_signed",
  message: "You have already signed there.",
};
export const HANDBOOK_CHANGED: IntakeError = {
  code: "handbook_changed",
  message: "The handbook changed since this page opened. Reload the page to read the current handbook, then sign.",
};
export const HANDBOOK_NO_SIGNATURE: IntakeError = {
  code: "handbook_no_adopted_signature",
  message: "We could not find the signature you adopted for your application. Ask the carrier for help.",
};

/** The link's view of the handbook, for `GET /:token` — null until the application is filed. */
export async function linkHandbookStatus(
  admin: SupabaseClient,
  invitation: { id: string; org_id: string; submitted_at: string | null; signing_opened_at?: string | null; handbook_filed_at?: string | null },
): Promise<LinkHandbookStatus | null> {
  if (!invitation.submitted_at) return null;
  const signedPlacementIds = await handbookPlacesSigned(admin, invitation.org_id, invitation.id);
  return {
    ...handbookStatus({
      submittedAt: invitation.submitted_at,
      openedAt: invitation.signing_opened_at ?? null,
      filedAt: invitation.handbook_filed_at ?? null,
      signedPlacementIds,
    }),
    version: HANDBOOK_VERSION,
  };
}

/** The name and adoption this place is signed with, or the refusal that says why there is none. */
async function handbookSignature(
  admin: SupabaseClient,
  invitation: { id: string; org_id: string },
): Promise<{ name: string; adoptionId: string | null } | IntakeError> {
  const adoption = await adoptionForMark(admin, invitation.org_id, invitation.id, "handbook", "signature");
  if (adoption && isIntakeError(adoption)) return adoption;
  if (adoption) return { name: adoption.typedText, adoptionId: adoption.id };
  const packet = (await adoptedPacketMarks(admin, invitation.org_id, invitation.id)).signature;
  return packet ? { name: packet, adoptionId: null } : HANDBOOK_NO_SIGNATURE;
}

export async function recordHandbookMark(
  admin: SupabaseClient,
  token: string,
  body: HandbookMark,
  ctx: SubmitContext,
  now: Date,
): Promise<LinkHandbookStatus | IntakeError> {
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
  if (!invitation.signing_opened_at) return refused(HANDBOOK_NOT_OPENED);

  // A-6: the place is recorded under the text the driver READ, and that must be the current text.
  if (body.handbook_version !== HANDBOOK_VERSION) return refused(HANDBOOK_CHANGED);

  const placement = handbookPlacementById(body.placement_id)!;
  const adopted = await handbookSignature(admin, invitation);
  if (isIntakeError(adopted)) return refused(adopted);

  const { error } = await admin.from("handbook_marks").insert({
    org_id: invitation.org_id,
    invitation_id: invitation.id,
    placement_id: placement.id,
    party: "driver",
    handbook_version: HANDBOOK_VERSION,
    signed_name: adopted.name,
    adoption_id: adopted.adoptionId,
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
  if (!invitation.signing_opened_at) return HANDBOOK_NOT_OPENED;

  if (invitation.handbook_filed_at) {
    const filed = await filedHandbookBytes(admin, invitation.org_id, invitation.driver_id, invitation.id);
    if (filed) return { pdf: filed, filename: "driver-handbook-signed.pdf" };
  }
  // The office's preview draws the same pages (D-AW17, C3s5) — one rendering, `handbookPreview.ts`.
  const pdf = await handbookReadingCopy(admin, invitation.org_id, invitation.driver_id, invitation.id, null);
  return { pdf, filename: "driver-handbook.pdf" };
}
