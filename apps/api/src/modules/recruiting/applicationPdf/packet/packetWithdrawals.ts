import { rgb, type PDFDocument, type PDFFont } from "pdf-lib";
import { PACKET_WITHDRAWALS } from "@silvicom/shared";
import { MARK_BASELINE_LIFT, markLineFor } from "./packetMarkGeometry.js";
import { fitAtSize, fitGroupSize, fitText } from "./packetFit.js";

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

/**
 * ⚠ **Two lines when one will not hold it, and never an ellipsis** (D-PKT19, 2026-09-25). Page 4's
 * and page 19's lines are 254–258pt and take the notice on one line; page 15's signature is the
 * first cell of a six-field grid, 103pt wide, and at the 5.5pt floor the notice is ~150pt. Fitted on
 * one line it printed `Not signed here. Signed electronically…` — the half that says where the
 * signature WENT was the half cut. So it breaks at the word nearest the middle and stacks upward
 * into the space a signature would have taken: measured on page 15, 16.6pt between the rule and the
 * last line of the release above it, which two lines at 6pt clear.
 */
const WITHDRAWAL_NOTICE_LEADING = 1.2;

function noticeLines(font: PDFFont, notice: string, width: number): { lines: string[]; size: number } {
  const one = fitText(font, notice, width, WITHDRAWAL_NOTICE_SIZE, WITHDRAWAL_NOTICE_MIN_SIZE);
  if (!one.cut) return { lines: [one.text], size: one.size };
  const words = notice.split(/\s+/);
  let best = 1;
  for (let i = 1; i < words.length; i++) {
    const gap = (k: number) =>
      Math.abs(font.widthOfTextAtSize(words.slice(0, k).join(" "), 1) - font.widthOfTextAtSize(words.slice(k).join(" "), 1));
    if (gap(i) < gap(best)) best = i;
  }
  const halves = [words.slice(0, best).join(" "), words.slice(best).join(" ")];
  const size = fitGroupSize(font, halves.map((text) => ({ text, width })), WITHDRAWAL_NOTICE_SIZE, WITHDRAWAL_NOTICE_MIN_SIZE);
  return { lines: halves.map((h) => fitAtSize(font, h, width, size).text), size };
}

export function drawWithdrawalNotices(doc: PDFDocument, font: PDFFont): void {
  for (const [placementId, withdrawal] of Object.entries(PACKET_WITHDRAWALS)) {
    const line = markLineFor(placementId);
    if (!line) continue;
    const { lines, size } = noticeLines(font, withdrawal.notice, line.x2 - line.x1 - 4);
    // The first line highest, so the notice reads top to bottom and a text extractor reads it in order.
    lines.forEach((text, i) => {
      doc.getPage(line.page - 1).drawText(text, {
        x: line.x1 + 2,
        y: line.y + MARK_BASELINE_LIFT + (lines.length - 1 - i) * size * WITHDRAWAL_NOTICE_LEADING,
        size,
        font,
        color: INK,
      });
    });
  }
}
