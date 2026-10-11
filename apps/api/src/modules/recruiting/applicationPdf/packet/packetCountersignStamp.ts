import { PDFDocument, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import { embedPdfFace, pdfUnicodeText } from "../../../../lib/pdfFonts.js";
import { MARK_BASELINE_LIFT } from "./packetMarkGeometry.js";
import { countersignLineFor } from "./packetCountersignGeometry.js";
import { fitText } from "./packetFit.js";

/**
 * The carrier's countersignature, STAMPED onto the driver's filed packet (Q-HB1; HANDBOOK-SIGNING-PLAN.md
 * §6.2, D-HB7, D-HB9).
 *
 * ── WHY STAMP THE FILED BYTES, AND NEVER RENDER THE PACKET AGAIN ─────────────────────────────
 * The driver's packet is filed at their certification and frozen (`file.ts`). The countersigned copy
 * is a second document, and it must differ from the first in the four carrier lines and in nothing
 * else. Rendering again from the evidence would use the renderer as it is ON THE DAY OF THE
 * COUNTERSIGN, so a spelling patch (D-PKT20) or an overlay fix merged in between would make the two
 * "copies" of one federal record disagree in places nobody signed, which is F6's objection to a
 * second, uncited rendering (`preview.ts`). So this loads the filed bytes and draws on top of them.
 * Pinned by `packetCountersignStamp.test.ts`:
 * "changes nothing on any other page, and keeps the filed document's metadata".
 *
 * ⚠ `updateMetadata: false`: pdf-lib otherwise rewrites the producer and the modification date, which
 * is a change to the filed document nobody asked for.
 */

export interface PacketCountersignStamp {
  /** The carrier placement ids to sign — the countersignature row's `placements`. */
  placements: readonly string[];
  /** The Representative's signature PNG, or null to print the typed name instead. */
  signature: Buffer | null;
  fullName: string;
  title: string;
  /** The office user who applied the signature (D-HB3). */
  appliedBy: string;
  /** The countersign's calendar day, MM/DD/YYYY (memory: dates-are-mmddyyyy-from-one-definition). */
  signedOn: string;
}

/** The drawn signature's ceiling, the driver's (`packetOverlay.ts`): it sits on the rule, not over the page. */
const MARK_MAX_HEIGHT = 18;
const TYPED_SIZE = 11;
const TYPED_MIN_SIZE = 6;
const DATE_SIZE = 10;
/** The applied-by line: the smallest type on the page, and no smaller than the continuation notice's floor. */
const CAPTION_SIZE = 7;
const CAPTION_MIN_SIZE = 5;
const INK = rgb(0.1, 0.1, 0.1);
/** `pdfDraw.ts`'s muted grey: the caption says who applied the mark, it is not part of it. */
const CAPTION_INK = rgb(0.4, 0.4, 0.4);

/** A picture that will not decode costs the picture, never the document (`packetOverlay.ts`'s `embedMark`). */
async function embedSignature(doc: PDFDocument, bytes: Buffer | null): Promise<PDFImage | null> {
  if (!bytes) return null;
  try {
    return await doc.embedPng(bytes);
  } catch {
    return null;
  }
}

/** The caption: who signed, who applied it, and when — the fact the handbook prints on every page. */
export const countersignCaption = (s: Pick<PacketCountersignStamp, "fullName" | "title" | "appliedBy" | "signedOn">): string =>
  `${s.fullName}, ${s.title} · applied by ${s.appliedBy} in Silvicom 360 · ${s.signedOn}`;

function drawFitted(page: ReturnType<PDFDocument["getPage"]>, font: PDFFont, text: string, x: number, y: number,
  width: number, size: number, floor: number, color = INK): void {
  const fit = fitText(font, pdfUnicodeText(text), width, size, floor);
  page.drawText(fit.text, { x, y, size: fit.size, font, color });
}

/**
 * Draw the carrier's marks onto the filed packet and return the countersigned copy.
 *
 * ⚠ Throws when a placement's page is not in the document: the caller stamps only a packet (the
 * §391.21 summary has no carrier lines, and its row's `placements` is empty), so a short document is a
 * broken invariant, not a case to draw around.
 */
export async function stampPacketCountersignature(source: Uint8Array, stamp: PacketCountersignStamp): Promise<Buffer> {
  const doc = await PDFDocument.load(source, { ignoreEncryption: true, updateMetadata: false });
  const font = await embedPdfFace(doc, "italic");
  const picture = await embedSignature(doc, stamp.signature);
  const caption = countersignCaption(stamp);

  for (const id of stamp.placements) {
    const line = countersignLineFor(id);
    if (!line) continue;
    if (line.page > doc.getPageCount()) {
      throw new Error(`packet countersign: page ${line.page} is not in a ${doc.getPageCount()}-page document`);
    }
    const page = doc.getPage(line.page - 1);
    const width = line.x2 - line.x1;
    const baseline = line.y + MARK_BASELINE_LIFT;

    if (picture) {
      const scale = Math.min(MARK_MAX_HEIGHT / picture.height, (width * 0.9) / picture.width);
      page.drawImage(picture, { x: line.x1 + 2, y: baseline, width: picture.width * scale, height: picture.height * scale });
    } else {
      drawFitted(page, font, stamp.fullName, line.x1 + 2, baseline, width - 4, TYPED_SIZE, TYPED_MIN_SIZE);
    }
    if (line.date) {
      drawFitted(page, font, stamp.signedOn, line.date.x1 + 2, line.date.y + MARK_BASELINE_LIFT,
        line.date.x2 - line.date.x1 - 4, DATE_SIZE, TYPED_MIN_SIZE);
    }
    drawFitted(page, font, caption, line.caption.x, line.caption.y, line.caption.x2 - line.caption.x,
      CAPTION_SIZE, CAPTION_MIN_SIZE, CAPTION_INK);
  }
  return Buffer.from(await doc.save());
}
