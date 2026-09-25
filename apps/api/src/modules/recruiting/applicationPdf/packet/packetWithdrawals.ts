import { rgb, type PDFDocument, type PDFFont } from "pdf-lib";
import { PACKET_WITHDRAWALS } from "@silvicom/shared";
import { MARK_BASELINE_LIFT, markLineFor } from "./packetMarkGeometry.js";
import { fitText } from "./packetFit.js";

/**
 * The reason a withdrawn line is blank, printed on the line itself (L-1).
 *
 * ── WHY ON THE CARRIER'S PAGE ─────────────────────────────────────────────────────────────────
 * The ruling says the page prints unsigned and the record says why. The packet has no certificate
 * page to carry the why — `render.ts`'s certificate belongs to the §391.21 summary, which a signed
 * packet does not file — and a blank `Applicant's Signature` line on a filed packet, with nothing
 * near it, reads as a signature that failed to record. So the sentence goes where the signature would
 * have gone: the one rectangle on the page that is PROVEN empty, because it is the line measured for
 * the mark (`packetMarkGeometry.ts`). The continuation notice under a grid is the precedent for our
 * words on the carrier's page (Q-PKT10); this is the same move for the same reason.
 *
 * ⚠ Drawn on EVERY render — filed, previewed, read — because the withdrawal is a fact about the
 * paper, not about one link. A filed packet is frozen at filing (`file.ts`), so what a packet filed
 * while L-1 stands prints is what it prints for ever; counsel's answer changes packets filed after it.
 */

/** Small enough to sit inside the 254pt line, large enough to read on a photocopy. */
const WITHDRAWAL_NOTICE_SIZE = 7;
const WITHDRAWAL_NOTICE_MIN_SIZE = 5.5;
const INK = rgb(0.1, 0.1, 0.1);

export function drawWithdrawalNotices(doc: PDFDocument, font: PDFFont): void {
  for (const [placementId, withdrawal] of Object.entries(PACKET_WITHDRAWALS)) {
    const line = markLineFor(placementId);
    if (!line) continue;
    const fit = fitText(font, withdrawal.notice, line.x2 - line.x1 - 4, WITHDRAWAL_NOTICE_SIZE, WITHDRAWAL_NOTICE_MIN_SIZE);
    doc.getPage(line.page - 1).drawText(fit.text, {
      x: line.x1 + 2,
      y: line.y + MARK_BASELINE_LIFT,
      size: fit.size,
      font,
      color: INK,
    });
  }
}
