import type { Bbox, PageRotation } from "@silvicom/shared";
import type { TextLayer } from "../pages/canonical.js";
import type { OcrItem, OcrPage } from "./rowWitness.js";

/**
 * A born-digital PDF's own text as a ROW-BOUND witness (DOCUMENT-READER-PLAN §7B step A4, Phase 2.7, D-DR3).
 *
 * The text layer is the PDF's characters exactly as the shipper's system wrote them, so on the fields the
 * row witness judges — a line's count, weight and quantity (rowWitness.ts) — it says what the OCR engine
 * says, without the engine's 0/O and 3/8 confusions and at no cost: the normaliser already stored it on the
 * page row at intake (pdf.ts → `document_pages.text_layer`, 0448). It is judged by the SAME row rules as the
 * OCR (rowOf/rowBacks), because the measured trap is the same: a whole-page presence check backs a wrong "9
 * drums" with the "9" printed as the hazard class elsewhere on the page. Exact characters do not fix a wrong
 * binding; only the row does.
 *
 * Like the OCR it reads no value of its own and abstains whenever the row is ambiguous. It is a separate
 * witness from the OCR, not a replacement: on a born-digital page both run, and a disagreement between them
 * is itself something to look at (a text layer can differ from what is drawn — white text, a stale overlay).
 *
 * All read pages or none. A text layer exists only on a born-digital PDF page (a scan or a photo has none).
 * An assembly that mixes a born-digital page with a photographed one gets no text-layer witness at all: the
 * row's anchor count (rowWitness.ts) must see every page, or a line printed on the photo would let the
 * anchor on the PDF page — a second mention of the same id — pass for its row. The same rule `ocrPages`
 * applies to a page the engine failed on.
 *
 * Coordinates. The words are boxed as fractions of the page as STORED; P2's verdict may turn the page before
 * it is read (Q-DR19 — a landscape form inside a portrait page), and the row is found in reading order, so
 * each box is turned the same clockwise quarter-turns the sent copy is. The page is reported 1 × 1, so the
 * row's box comes out as fractions, as the OCR's does from its pixels.
 */

export interface PageText { textLayer: TextLayer | null; rotation: PageRotation }

/** A box turned clockwise by `rotation` degrees within the unit page. */
export function turnBox(b: Bbox, rotation: PageRotation): Bbox {
  switch (rotation) {
    case 90: return { x: 1 - (b.y + b.h), y: b.x, w: b.h, h: b.w };
    case 180: return { x: 1 - (b.x + b.w), y: 1 - (b.y + b.h), w: b.w, h: b.h };
    case 270: return { x: b.y, y: 1 - (b.x + b.w), w: b.h, h: b.w };
    default: return b;
  }
}

/** Whether two boxes share a printed line: they overlap vertically by at least half the shorter one's height. */
const sameLine = (a: OcrItem["box"], b: OcrItem["box"]) =>
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) >= Math.min(a.height, b.height) / 2;

/**
 * The words of one page as LINE items, the shape the OCR engine reports. The text layer boxes each word
 * (textLayer.ts), but an id printed "UN 1263" is two words, and the row witness finds its anchor within one
 * item (rowWitness.ts joins "UN 1263" to "UN1263" only inside an item's text) — word by word, every id
 * printed with a space would abstain. Consecutive words on the same line (pdf.js gives them in content
 * order) are joined with a space under one box.
 */
function lineItems(words: TextLayer["words"], rotation: PageRotation): OcrItem[] {
  const items: OcrItem[] = [];
  for (const w of words) {
    const b = turnBox(w.bbox, rotation);
    const box = { x: b.x, y: b.y, width: b.w, height: b.h };
    const last = items.at(-1);
    if (last && sameLine(last.box, box)) {
      const x = Math.min(last.box.x, box.x);
      const y = Math.min(last.box.y, box.y);
      last.box = {
        x, y,
        width: Math.max(last.box.x + last.box.width, box.x + box.width) - x,
        height: Math.max(last.box.y + last.box.height, box.y + box.height) - y,
      };
      last.text = `${last.text} ${w.text}`;
    } else items.push({ text: w.text, box });
  }
  return items;
}

/** The read pages' text layers as row-witness pages (1-based, in read order), or null unless every page has one. */
export function textLayerPages(pages: readonly PageText[]): OcrPage[] | null {
  if (pages.length === 0 || pages.some((p) => !p.textLayer || p.textLayer.words.length === 0)) return null;
  return pages.map((p, k) => ({ page: k + 1, width: 1, height: 1, items: lineItems(p.textLayer!.words, p.rotation) }));
}
