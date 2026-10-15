import { tokens, type OcrItem, type OcrPage } from "./rowWitness.js";

/**
 * The page scan behind "No hazardous materials on this BOL" (DOCUMENT-READER-PLAN §7B, the 2026-10-14
 * external audit's negative-evidence finding, D-DR24's follow-up).
 *
 * Until now that sentence rested on the two model readers alone: both returned no hazmat line, so the screen
 * said nothing on the paper needs a placard. Two readers missing the same line is exactly the failure two
 * readers cannot see — a hazmat line on a page neither looked at closely, a small line under a long freight
 * list. The OCR engine and a born-digital page's text layer read every character on every read page, so they
 * can say what the readers cannot: whether the page PRINTS anything a hazmat line is made of.
 *
 * What counts as a mark, each a thing §172.202/§172.201 puts on a hazmat line and freight paper does not:
 *   - a UN or NA identification number, as an id-shaped token ("UN1993", "NA 1993") — the one element every
 *     hazmat basic description carries (§172.202(a)(1)), matched exactly as the row witness anchors a line;
 *   - "RQ" anywhere — a reportable quantity is printed with the description or in the HM column
 *     (§172.203(c)), and the word means nothing else on a bill of lading;
 *   - an "X" standing alone in the HM column (§172.201(a)(1)(i)): an item whose whole text is X, below an item
 *     carrying the HM header, inside that header item's width. When the OCR joins the header with its
 *     neighbours ("HM DESCRIPTION OF ARTICLES"), the width is the joined item's — wider than the column, so a
 *     checkbox X under it is counted too. That errs the safe way: a mark found means "check the page", never
 *     a placard.
 *
 * The scan only ever STOPS the negative. A page with no mark proves nothing on its own — the OCR misses
 * characters, and a scan with no OCR at all finds nothing — so the screen says "no hazmat" only when the
 * readers agree too (bolPrefill.ts `noHazmatDoubts`), and never when the scan is absent.
 */

export interface HazmatMark {
  /** The mark as the scan compares it: "UN1993", "RQ", "X". */
  mark: string;
  /** 1-based, in read order. */
  page: number;
  /** The item it was found in, as fractions of the upright page. */
  bbox: { x: number; y: number; w: number; h: number };
}

const ID_RX = /^(UN|NA)\d{4}$/;
const isHmHeader = (t: string[]) => t.includes("HM") || t.some((x, k) => x === "H" && t[k + 1] === "M");

function marksOn(p: OcrPage): { mark: string; item: OcrItem }[] {
  const found: { mark: string; item: OcrItem }[] = [];
  const headers = p.items.filter((i) => isHmHeader(tokens(i.text)));
  for (const item of p.items) {
    const t = tokens(item.text);
    for (const x of t) if (ID_RX.test(x) || x === "RQ") found.push({ mark: x, item });
    const mid = item.box.x + item.box.width / 2;
    const inHmColumn = headers.some((h) => h !== item && item.box.y > h.box.y && mid >= h.box.x && mid <= h.box.x + h.box.width);
    if (t.length === 1 && t[0] === "X" && inHmColumn) found.push({ mark: "X", item });
  }
  return found;
}

/** Every hazmat mark printed on the read pages, in page and then reading order; [] when there is none. */
export function hazmatMarks(pages: readonly OcrPage[]): HazmatMark[] {
  return pages.flatMap((p) =>
    marksOn(p)
      .sort((a, b) => a.item.box.y - b.item.box.y)
      .map(({ mark, item }) => ({
        mark,
        page: p.page,
        bbox: {
          x: Math.max(0, item.box.x / p.width),
          y: Math.max(0, item.box.y / p.height),
          w: Math.min(1, item.box.width / p.width),
          h: Math.min(1, item.box.height / p.height),
        },
      })),
  );
}
