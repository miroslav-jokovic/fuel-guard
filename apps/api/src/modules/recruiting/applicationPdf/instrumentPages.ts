import { DANGER, MARGIN, body, caption, field, heading } from "../../../lib/pdfDraw.js";
import { purposeLabel } from "./certificate.js";

/**
 * How ONE signed instrument prints — the page that shows the exact text somebody agreed to (B2).
 *
 * ── WHY THIS IS A MODULE AND NOT TWO COPIES ───────────────────────────────────────────────────
 * Two documents draw these pages now: `render.ts`'s §391.21 summary, which files them with the
 * application, and B2's permissions PDF, which is the office's answer to *"what has this applicant
 * signed so far"* before anything is filed. The pages are the same pages — a heading, the version,
 * the disclosure text as it was stored, the intent sentence, the typed name and the date.
 *
 * ⚠ **A2 is why they are not written twice.** For four days the office previewed one renderer while
 * the driver signed another; both typechecked, both were tested, and each test asserted its own
 * document, so nothing could see that the two had diverged. The instrument page is the part of this
 * document a dispute is actually about — FCRA §604(b)(2) is a question about *which wording was
 * shown* — so it is the last place a second implementation should exist. `permissions.test.ts`
 * still runs one instrument through both callers, because a shared function is a claim to test too.
 *
 * ── WHAT THE CALLERS ARE ALLOWED TO DIFFER ON ─────────────────────────────────────────────────
 * Exactly one thing: `standing` — whether the instrument is still in force. The filed application
 * never passes it, because `authorizationsFor` drops revocation rows and a grant it drew WAS in force
 * when it was drawn. The permissions PDF renders what the carrier holds TODAY, revocations included,
 * so it has a line to add and the filed document does not. Everything else is identical, deliberately,
 * and the extraction was behaviour-preserving: `render.ts` passes nothing and draws the same bytes.
 */

/**
 * A value, or an em dash — the same rule every page of these documents follows.
 *
 * ⚠ Declared here rather than imported from `render.ts`, for the reason `certificate.ts` gives for
 * its own copy: `render.ts` imports THIS module, and reaching back for a four-token helper would
 * make the pair circular at runtime.
 */
const blank = (v: string | null | undefined): string => (v && v.trim() !== "" ? v : "—");
const date = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "—");

/**
 * The note, when the caller has one, in the house's DANGER ink and at reading size.
 *
 * ⚠ Not `muted()`, and the rasterised page is why. A revoked release and a withdrawn consent are the
 * most load-bearing sentences these pages carry — they are the difference between a lawful basis and
 * the absence of one — and drawn muted they came out the same weight and colour as *"Version
 * v0-draft"*, a line nobody reads. ⚠ It is also the one place in this family where colour is allowed
 * to carry meaning, and it does not carry it alone: the word REVOKED is the first thing in the
 * sentence, so a photocopy in black and white says the same thing (D-AVI22's rule, which is about a
 * preview whose INK differs from the filing — this line exists on neither filing nor preview).
 */
function note(doc: PDFKit.PDFDocument, text: string): void {
  body(doc, text, DANGER);
  doc.moveDown(0.4);
}

/** What an instrument page needs, which is the columns `driver_authorizations` stores the text in. */
export interface SignedInstrument {
  purpose: string;
  disclosure_version: string;
  disclosure_text: string;
  intent_statement: string;
  signed_name: string;
  accepted_at: string;
}

/** The 15 U.S.C. 7001(c) consent, which is its own table (0227) and not a fifth instrument. */
export interface SignedConsent {
  disclosure_version: string;
  disclosure_text: string;
  intent_statement: string;
  consented_at: string;
}

const MARK_WIDTH = 170;
const MARK_HEIGHT = 52;

/**
 * The drawn mark, beside the name it decorates (A8b, D-APP8).
 *
 * ⚠ Wrapped, and the reason is the whole of D-APP8. pdfkit throws on anything that is not a PNG or a
 * JPEG, and these bytes came from a canvas on a stranger's phone through a bucket. A truncated upload
 * must cost the squiggle and never the document — a §391.51(b)(1) record that cannot be produced
 * because an ornament would not decode is precisely the §390.32(d) failure this renderer exists to
 * prevent.
 *
 * ⚠ And the room check is not politeness. `doc.image` will happily draw below the bottom margin and
 * off the sheet, and the page it would need is not added for it the way pdfkit adds one for text —
 * so a mark that does not fit is simply lost, silently, on whichever instrument happened to have the
 * longest disclosure.
 */
export function drawnMark(doc: PDFKit.PDFDocument, mark: Buffer | null): void {
  if (!mark) return;
  try {
    if (doc.page.height - doc.page.margins.bottom - doc.y < MARK_HEIGHT + 12) doc.addPage();
    doc.image(mark, MARGIN, doc.y, { fit: [MARK_WIDTH, MARK_HEIGHT] });
    doc.x = MARGIN;
    doc.y += MARK_HEIGHT + 6;
  } catch (e) {
    console.warn("[application] the drawn signature mark could not be rendered", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * The consent page: the six clauses as they were composed and shown, then the agreement itself.
 *
 * `standing` is the withdrawal when there has been one. 7001(c)(1)(B)(i)(II) makes withdrawal a
 * right, and 0227 records it as a column rather than a delete precisely because it does not undo the
 * signatures already given — so the page still prints the consent, and says underneath that the
 * electronic path was closed on a date.
 */
export function consentPage(
  doc: PDFKit.PDFDocument,
  consent: SignedConsent,
  standing?: string | null,
): void {
  doc.addPage();
  heading(doc, "Consent to transact electronically");
  caption(doc, `15 U.S.C. 7001(c) · version ${consent.disclosure_version}`);
  if (standing) note(doc, standing);
  body(doc, blank(consent.disclosure_text));
  doc.moveDown(0.5);
  body(doc, blank(consent.intent_statement));
  field(doc, "Agreed", date(consent.consented_at));
}

/**
 * One instrument, showing the text that was signed — from the ROW, never from today's constant.
 *
 * ⚠ The LABEL, not the token. This read `Authorization — fcra_disclosure` until X7: a machine
 * vocabulary on a page whose reader is an auditor or a court, which is the same defect D-AX3 fixed on
 * the driver's screen. An unknown purpose falls back to what was stored rather than rendering nothing.
 */
export function instrumentPage(
  doc: PDFKit.PDFDocument,
  auth: SignedInstrument,
  mark: Buffer | null,
  standing?: string | null,
): void {
  doc.addPage();
  heading(doc, `Authorization — ${purposeLabel(auth.purpose)}`);
  caption(doc, `Version ${auth.disclosure_version}`);
  if (standing) note(doc, standing);
  // The exact text that was signed, from the row, not from today's constant: a document showing
  // current wording beside an old signature would misrepresent what somebody agreed to.
  body(doc, blank(auth.disclosure_text));
  doc.moveDown(0.5);
  body(doc, blank(auth.intent_statement));
  doc.moveDown(0.4);
  field(doc, "Signed", blank(auth.signed_name));
  drawnMark(doc, mark);
  field(doc, "Date", date(auth.accepted_at));
}
