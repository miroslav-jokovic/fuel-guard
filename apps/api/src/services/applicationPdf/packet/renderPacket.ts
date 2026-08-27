
/**
 * The carrier's own application packet — the pages that take applicant data (P4, D-PKT1).
 *
 * ── WHAT THIS IS, AND WHAT `render.ts` NEXT DOOR IS ───────────────────────────────────────────
 * `render.ts` prints a §391.21-shaped summary under headings (b)(1)…(b)(12). It is regulation-correct
 * and it is NOT the carrier's application: `docs/plans/recruitment/APPLICATION.xlsx` is, and the
 * owner's "don't change the final application" was about that one. This renderer produces the packet's
 * pages 1, 2, 12, 16 and 26 from the data we already hold.
 *
 * ⚠ **`render.ts` is not deleted and must not be** (D-PKT5). It is what already-filed
 * `qualification_records` point at, and §390.32(d) requires a filed electronic record to still be
 * reproducible. This is the document NEW submissions produce.
 *
 * ── FOUR PAGES OF THE 31, AND THE ARITHMETIC IS NOT SUBTRACTION ───────────────────────────────
 * The packet is 31 pages: 18 SIGN (P5, blocked on counsel), 5 STATIC (P3), 4 that are not the
 * applicant's document at all (the previous-employer request WE send, the interview record, the
 * annual violation review, and — since D-PKT7 — the Seven Day Work Statement, which moved to the hire
 * because §395.8(j)(2) counts the seven days before work BEGINS).
 *
 * ⚠ **Page 26 arrived late, and the reason is worth keeping.** It asks §40.25(j)'s two-year question
 * — *did you test positive or refuse a pre-employment test for a job you applied for but did not
 * get?* — and the plan's inventory recorded that as already collected. It was not: the wizard held
 * two PER-EMPLOYER booleans, `safety_sensitive` and `subject_to_fmcsr`, which ask about a job the
 * driver actually HELD. P4 therefore shipped without this page rather than drawing it with an
 * unanswered checkbox, which would have put a blank mandatory question inside a document somebody
 * signs. P8 added the contract field and the control; the page renders now.
 *
 * ── THE LETTERHEAD IS THE CARRIER'S, THE FOOTER IS THE PACKET'S ───────────────────────────────
 * D-PKT8. `carrier.name`/`carrier.address` come from `organizations` (`legal_address`, 0229), because
 * Silvicom 360 is multi-tenant and a second carrier must never be handed a document with the first one's
 * name on it. The two footer lines are statements about what the document IS, not about who issued
 * it, and are reproduced verbatim.
 *
 * ── EVERY VALUE GOES THROUGH `blank()` ────────────────────────────────────────────────────────
 * Same rule as `render.ts` and for the same reason: this reads STORED payloads.
 * `driver_applications.payload` is historical jsonb, a row filed before a field existed has none of
 * it, and a derivative that throws on an old payload is a qualification file that cannot be produced.
 */

export interface PacketPdfInput {
  carrier: PacketCarrier;
  application: DriverApplication;
  applicationId: string;
  /** Server-stamped, never client-supplied (D-APP9). */
  certifiedAt: string;
  signedName: string;
}

import type { DriverApplication } from "@silvicom/shared";
import { newDrawing } from "../../dqBinder/pdfDraw.js";
import { letterhead, packetFooter, type PacketCarrier } from "./packetDraw.js";
import { page1, page2, page12, page16, page26 } from "./packetPages.js";

export const RENDERED_PACKET_PAGES = [1, 2, 12, 16, 26] as const;

export async function renderApplicationPacketPdf(input: PacketPdfInput): Promise<Buffer> {
  const a = input.application;
  const { doc, done } = newDrawing(`Driver application packet — ${input.signedName}`);

  const draw: Array<(d: PDFKit.PDFDocument) => void> = [
    (d) => page1(d, a, input.certifiedAt),
    (d) => page2(d, a),
    (d) => page12(d, a),
    (d) => page16(d, a),
    (d) => page26(d, a, input.signedName),
  ];

  draw.forEach((render, i) => {
    if (i > 0) doc.addPage();
    letterhead(doc, input.carrier);
    render(doc);
    // Drawn last so a page whose content overflowed still gets its footer where the packet has it.
    packetFooter(doc, RENDERED_PACKET_PAGES[i]!);
  });

  doc.end();
  return done;
}

/** Exported for the questionnaire-coverage test — the ids this renderer reads. */
export const PACKET_QUESTION_IDS = [
  "position",
  "heard_from",
  "legally_work",
  "proof_of_age",
  "may_contact_employers",
  "education",
  "military_service",
  "military_when",
  "other_training",
  "references",
] as const;

