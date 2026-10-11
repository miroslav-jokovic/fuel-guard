import type { SupabaseClient } from "@supabase/supabase-js";
import { HANDBOOK_CARRIER_PLACEMENT_ID } from "@silvicom/shared";
import { carrierOf, signatureMarkBytes } from "./applicationPdf/sources.js";
import { handbookPdf } from "./applicationPdf/handbook/handbookPdf.js";
import { currentInvitation, handbookMarksForPrint, handbookPrintFacts, type HandbookError } from "./handbookSigning.js";

/**
 * The driver handbook as it stands before it is filed — the driver's reading copy, and since C3s5 the
 * office's preview on the signing row (APPLICATION-FLOW-V2-PLAN D-AW17).
 *
 * ── ONE RENDERING FOR BOTH READERS ────────────────────────────────────────────────────────────
 * The office asks "what will they sign", the driver "what am I signing", and both are answered by the
 * same pages, prefilled the same way: the applicant's name and the SSN's last four (D-HB2), and the
 * places signed so far. A2's lesson is the reason there is one function — the office once previewed an
 * eight-page summary for four days while the driver signed a thirty-one-page packet, and nothing could
 * see it. What differs is the band, and only the office's copy carries one (`PreviewAudience.band`'s
 * reason: a DRAFT stripe on the page somebody is about to sign reads as "not the real document").
 *
 * ⚠ **The SSN prints only once the application is filed**, because that is when it first exists
 * outside the driver's head: the application page asks for it at the signature and sends it straight to
 * `driver_applications` (D-HIRE6 — the draft never holds it). So the office's preview, which comes
 * before sending, shows the line blank. It is not a gap in the preview; there is nothing to print yet.
 *
 * ⚠ The carrier's place stays blank on both: the countersignature is the office's act, drawn only on
 * the document that files it.
 */
export async function handbookReadingCopy(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  invitationId: string,
  band: string | null,
): Promise<Buffer> {
  const [{ marks }, facts, carrier, driverSignature] = await Promise.all([
    handbookMarksForPrint(admin, orgId, invitationId),
    handbookPrintFacts(admin, orgId, driverId, invitationId),
    carrierOf(admin, orgId),
    signatureMarkBytes(admin, orgId, invitationId, "signature", "handbook"),
  ]);
  marks.delete(HANDBOOK_CARRIER_PLACEMENT_ID);
  return handbookPdf({ carrier: { name: carrier.name }, ...facts, marks, driverSignature, countersign: null, band });
}

/** The office's band — the packet preview's words, with the document's own name. */
const HANDBOOK_PREVIEW_BAND = "DRAFT - NOT A SIGNED HANDBOOK";

/**
 * The office previews the handbook from the signing row, before sending it (D-AW17). Streamed, never
 * filed: a preview is not evidence, and a DRAFT in `documents` would outlive the draft it came from.
 *
 * ⚠ Refused once filed, as the packet's preview is: the filed handbook is in the driver's file, and a
 * second rendering of a filed record would be an uncited copy whose bytes do not match the one on file.
 */
export async function handbookPreviewPdf(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<{ pdf: Buffer; filename: string } | HandbookError> {
  const inv = await currentInvitation(admin, orgId, driverId);
  if (!inv) return { code: "not_found", message: "This applicant has no application on file." };
  if (inv.handbook_filed_at) {
    return {
      code: "already_filed",
      message: "The handbook is signed and filed. Open it from the driver's file — that is the copy on record.",
    };
  }
  const pdf = await handbookReadingCopy(admin, orgId, driverId, inv.id, HANDBOOK_PREVIEW_BAND);
  return { pdf, filename: `handbook-${inv.id}-preview.pdf` };
}
