import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriverApplication } from "@silvicom/shared";
import { renderPacketDocument } from "./packetDocument.js";

/**
 * ⚠ The words `render.ts` stamps on a preview, repeated here rather than imported, and the choice is
 * deliberate. They are not one fact in two places: `render.ts` bands the §391.21 summary and this
 * bands the carrier's packet, and the two documents are allowed to diverge — if the summary's wording
 * ever changes for a reason about the summary, this must not follow it silently. What they share is a
 * sentence an office has learned to recognise, and `preview.test.ts` asserts this one on the page.
 */
const PREVIEW_BAND = "DRAFT - NOT A SIGNED APPLICATION";

/**
 * The application as a printable document BEFORE anybody has signed it (F6).
 *
 * ── WHY THE OFFICE NEEDS THIS ─────────────────────────────────────────────────────────────────
 * The review drawer shows the answers on a screen, which answers "what did they say". It does not
 * answer the things an office actually does with an application: read it away from the desk, print
 * it, put it in front of somebody who does not have a login, or post it to a terminal. Until this,
 * the ONLY way to get the §391.21 document out of this product was to wait for the driver to certify
 * it — and the whole point of the two-visit flow is that the office reads it first.
 *
 * ── IT IS THE SAME RENDERER, AND THAT IS THE STEP ─────────────────────────────────────────────
 * `renderPacketDocument` over `application_drafts.payload` instead of `driver_applications.payload`.
 * Not a second draft-shaped renderer: the office is previewing the document that will be FILED, and
 * a second rendering of the same answers would be a second source of truth. Every page carries the
 * band saying it certifies nothing.
 *
 * ⚠ **That sentence was true when it was written and false a day later, which is the whole of A2.**
 * It argued at length that this was deliberately the same renderer as the filing — correct on
 * 2026-09-13, when F6 shipped and `file.ts` also rendered `render.ts`'s §391.21 summary. The packet
 * renderer landed on 2026-09-14 and changed what the filing renders; **nothing changed this file, and
 * no test compared the two**, so for four days the office read an eight-page summary and the driver
 * signed the carrier's thirty-one-page packet. No gate could see it: both files typechecked, both
 * were tested, and each test asserted its own renderer. The assertion that did not exist is the one
 * `preview.test.ts` now carries — *the office's preview and the driver's filing are the same
 * document* — and it compares PAGE COUNTS from one payload, because that is the difference a reader
 * would notice first and the one no amount of per-renderer testing can catch.
 *
 * ⚠ **`marks: []`, and NOT `file.ts`'s marks-based switch** (§1a C4). A preview happens before
 * signing, so it always has zero marks; applying the filed document's switch here would render the
 * summary for ever and this step would do nothing. `render.ts` stays, untouched, for already-filed
 * records only.
 *
 * ── ⚠ WHAT THIS PREVIEW STOPPED SHOWING, AND WHERE IT GOES ────────────────────────────────────
 * The summary carried three things the carrier's packet has no page for: which releases the office
 * holds, the e-sign consent, and the §391.21(b)(12) certification block with its progress line. They
 * are not lost facts — they are facts on the wrong document. **B2 is the step that gives them their
 * own banded interim PDF** (the four authorizations + the §7001(c) consent + the certificate of
 * completion), which is the right home for them: the office's question *"what has this applicant
 * signed so far"* is not the same question as *"what will they sign"*, and answering both on one
 * sheet is what made the preview diverge from the filing in the first place. Until B2, the releases
 * are on the applicant's record behind the Permissions row (B6's `AuthorizationsPanel`).
 *
 * ── AND WHY IT REFUSES ONCE THE APPLICATION IS FILED ──────────────────────────────────────────
 * ⚠ A certified application already HAS a document — rendered at submit, hashed into
 * `documents.sha256`, cited by the §391.51(b)(1) `qualification_records` row, and offered on the
 * applicant's own page ("Open the application"). Re-rendering it here would hand somebody a second,
 * uncited copy of a filed federal record whose bytes do not match the one in the file. So this
 * refuses and says where the real one is.
 */

export interface PreviewError {
  code: string;
  message: string;
}

export const isPreviewError = (v: unknown): v is PreviewError =>
  typeof v === "object" && v !== null && "code" in v && "message" in v;

interface InvitationRow {
  id: string;
  org_id: string;
  driver_id: string;
  submitted_at: string | null;
}

export interface ApplicationPreview {
  pdf: Buffer;
  /** What the browser saves it as. "preview" is in the name so it cannot be mistaken for the filing. */
  filename: string;
}

export async function applicationPreviewPdf(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<ApplicationPreview | PreviewError> {
  const { data } = await admin
    .from("application_invitations")
    // The service role bypasses RLS, so the org filter is the only thing between two carriers.
    // ⚠ The two phase stamps came out with A2: they fed the summary's progress line, and the
    // carrier's packet has no page for it. `submitted_at` stays — it is the already-filed refusal.
    .select("id, org_id, driver_id, submitted_at")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .maybeSingle();
  const invitation = (data as InvitationRow | null) ?? null;
  if (!invitation) {
    return { code: "application_not_found", message: "There is no application on this invitation." };
  }
  if (invitation.submitted_at) {
    return {
      code: "already_filed",
      message:
        "This application has been signed and filed. Open the filed application on the applicant's "
        + "page — that is the copy in the qualification file.",
    };
  }

  const { data: draft } = await admin
    .from("application_drafts")
    .select("payload")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  const payload = (draft as { payload?: Record<string, unknown> } | null)?.payload ?? null;
  if (!payload) {
    return {
      code: "nothing_to_preview",
      message: "They have not filled anything in yet, so there is nothing to print.",
    };
  }

  const pdf = await renderPacketDocument({
    /**
     * ⚠ **Empty, and it is the point of this step rather than a gap** (§1a C4). Blank signature
     * lines under a DRAFT band are exactly what the carrier's paper looks like before anybody signs
     * it, which is what an office previewing an unsigned application is asking to see.
     */
    marks: [],
    /**
     * ⚠ Cast, not parsed — deliberately, and it is the same rule `file.ts` renders filed payloads
     * under. This is stored jsonb written by a form that has changed shape before and will again; a
     * preview that refused to draw because one key does not match today's contract would be exactly
     * the failure `packetDraw.ts`'s `blank()`/`?? []` discipline exists to prevent. The office is
     * owed the document as it stands, gaps and all. The BINDING parse happens at certification.
     */
    application: payload as DriverApplication,
    /**
     * ⚠ Empty rather than today's date. `certifiedAt` is page 1's `Date:` and it is the date the
     * applicant CERTIFIED — server-stamped, never invented (D-APP9). Nobody has certified anything
     * here, and `date("")` draws nothing, so the line stays blank like the signature above it. A
     * preview that dated page 1 would be a document asserting an act that has not happened.
     */
    certifiedAt: "",
    /**
     * ⚠ The one line of this module that could forge something, kept empty for `preview.test.ts`'s
     * *"signs nothing"*. This is page 22's `Driver name Print`, drawn beside the signature lines;
     * the applicant's own name is two fields away in the payload, and printing it here would put a
     * name where a signature belongs on a document nobody has signed.
     */
    signedName: "",
    // ⚠ Null, and it would be ignored anyway — A3 made the drawn mark follow the MARKS, and there
    // are none. Named rather than omitted so the next reader does not go looking for the read.
    drawnMark: null,
    // ⚠ Same words as `render.ts` stamps, so the office reads the phrase it has always read on a
    // preview even though the paper underneath it changed.
    band: PREVIEW_BAND,
  });

  return { pdf, filename: `application-${invitation.id}-preview.pdf` };
}
