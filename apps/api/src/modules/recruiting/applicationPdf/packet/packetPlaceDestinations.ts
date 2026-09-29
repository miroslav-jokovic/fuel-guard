import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { signingPlaceDestination } from "@silvicom/shared";
import { MARK_BASELINE_LIFT, PACKET_MARK_LINES } from "./packetMarkGeometry.js";

/**
 * Name every driver place on the carrier's packet inside the PDF (D-HB12; `signingPlaceDestination`).
 *
 * ── WHY AFTER RENDERING, AND ONLY ON THE READING COPY ─────────────────────────────────────────
 * The packet is the carrier's own file loaded and drawn on, so its places are the measured lines in
 * `packetMarkGeometry.ts`; nothing about them moves with the answers. They are written onto the bytes
 * the driver READS while signing (`applicationReadingCopy.ts`), not onto the filed packet: the walk is
 * the only reader, and a filed §391.51(b)(1) record gains nothing from carrying a signing screen's
 * bookmarks.
 *
 * ⚠ The box is the one the overlay draws the mark into: the rule's span, from just under the rule to
 * the top of the tallest drawn mark (`MARK_BASELINE_LIFT` + the overlay's 18pt ceiling), so the tag and
 * the signature land on the same rectangle.
 *
 * ⚠ `/Dests` on the catalog — the PDF 1.1 form, which pdfjs's `getDestination` reads alongside a name
 * tree. `updateMetadata: false`, because a reading copy's producer and date are not ours to change.
 */
const DRAWN_MARK_MAX_HEIGHT = 18;

export async function withPacketPlaceDestinations(pdf: Uint8Array): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const dests = doc.context.obj({}) as PDFDict;
  for (const line of PACKET_MARK_LINES) {
    if (line.page > doc.getPageCount()) continue;
    const page = doc.getPage(line.page - 1);
    dests.set(
      PDFName.of(signingPlaceDestination(line.id)),
      doc.context.obj([page.ref, PDFName.of("FitR"), line.x1, line.y - 2, line.x2, line.y + MARK_BASELINE_LIFT + DRAWN_MARK_MAX_HEIGHT]),
    );
  }
  doc.catalog.set(PDFName.of("Dests"), dests);
  return Buffer.from(await doc.save());
}
