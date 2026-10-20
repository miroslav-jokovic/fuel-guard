import { pageBox } from "./pageGeometry.js";
import { tokens, type OcrItem, type OcrPage } from "./rowWitness.js";

/**
 * The OCR engine (and a born-digital page's text layer) as a witness on the shipper's certification
 * (READER-CORRECTNESS-PLAN R-M3). Production read 350d2f27 (Mayo Products BOL 14182, 2026-10-19): pass A read
 * the printed, signed §172.204 statement as present, pass B returned null — one reader abstaining, not the two
 * disagreeing — and `paper_certification` stopped. The statement is fixed wording, so a non-model reader can
 * say whether its words are on the page.
 *
 * What counts as the statement: §172.204(a)'s two permitted texts, by the words that make each one —
 *   (a)(1) "This is to CERTIFY that the above-named materials are properly CLASSIFIED, DESCRIBED, PACKAGED,
 *          MARKED and LABELED, and are in proper condition for transportation …";
 *   (a)(2) "I hereby DECLARE that the contents of this consignment are fully and accurately DESCRIBED … and are
 *          CLASSIFIED, PACKAGED, MARKED and LABELLED/placarded …".
 * Every word of one set, within WINDOW consecutive words of the page in reading order. A word the OCR misread
 * ("conignor", as it did on that page) means not found — the witness only ever backs, so a miss costs a stop,
 * never a false "present".
 *
 * It backs ONLY "present". It cannot tell a statement from a page that prints it unsigned or crossed out, and
 * it never stands alone: the audit takes it only beside a reader that read the statement as present while
 * the other abstained (paperAudit.ts). A reader that read it as ABSENT is a disagreement no witness settles.
 */

const SETS: readonly (readonly RegExp[])[] = [
  [/^CERTIF(Y|IES|IED)$/, /^CLASSIFIED$/, /^DESCRIBED$/, /^PACKAGED$/, /^MARKED$/, /^LABEL{1,2}ED$/],
  [/^DECLARES?$/, /^CLASSIFIED$/, /^DESCRIBED$/, /^PACKAGED$/, /^MARKED$/, /^LABEL{1,2}ED$/],
];
/** The statements are 30–45 words; a set spread wider than this is words from different places on the page. */
const WINDOW = 60;

/** The page's words in reading order: items by line (top, then left), each item's tokens. */
function wordsOf(p: OcrPage): { word: string; item: OcrItem }[] {
  const items = [...p.items].sort((a, b) => {
    const sameLine = Math.abs(a.box.y - b.box.y) < Math.min(a.box.height, b.box.height) / 2;
    return sameLine ? a.box.x - b.box.x : a.box.y - b.box.y;
  });
  return items.flatMap((item) => tokens(item.text).map((word) => ({ word, item })));
}

/** Where the statement is printed, or null when no page shows every word of either text close together. */
export function certificationShown(pages: readonly OcrPage[]): { page: number; bbox: { x: number; y: number; w: number; h: number } } | null {
  for (const p of pages) {
    const words = wordsOf(p);
    for (const set of SETS) {
      for (let start = 0; start < words.length; start++) {
        if (!set.some((rx) => rx.test(words[start]!.word))) continue;
        const span = words.slice(start, start + WINDOW);
        if (!set.every((rx) => span.some((w) => rx.test(w.word)))) continue;
        const hit = span.filter((w) => set.some((rx) => rx.test(w.word))).map((w) => w.item.box);
        const x = Math.min(...hit.map((b) => b.x));
        const y = Math.min(...hit.map((b) => b.y));
        const right = Math.max(...hit.map((b) => b.x + b.width));
        const bottom = Math.max(...hit.map((b) => b.y + b.height));
        return { page: p.page, bbox: pageBox(p, { x, y, width: right - x, height: bottom - y }) };
      }
    }
  }
  return null;
}
