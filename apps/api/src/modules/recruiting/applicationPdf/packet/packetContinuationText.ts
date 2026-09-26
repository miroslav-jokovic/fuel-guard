import type { PDFFont } from "pdf-lib";

/**
 * How the continuation sheet measures text against a column — fit, clip, and wrap.
 *
 * ⚠ **Split out of `packetContinuation.ts` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §8.5, C1)**, at the
 * 450-line warning, along the seam between measuring a string and laying out a page: these three
 * take a font, a string and a width and know nothing about the sheet. They moved unchanged with
 * their comments; `packetContinuation.ts` imports them and re-exports `wrap`, which its test reads
 * from there.
 */

/**
 * The largest size at or below `start` whose text fits, floored at 5pt.
 *
 * ⚠ **The comment here used to say "Shrink to fit, never overrun" and neither half was true**
 * (AUD-2). It returns the floor whether or not the text fits at it, exactly as `packetOverlay.ts`'s
 * `fittedSize` did — the two were written together and were wrong together. Every surviving caller
 * now either passes the result straight to `clipped()` or is a single line of our own copy whose
 * length this module controls, so the floor can no longer reach the page uncut. Answers do not come
 * through here at all any more: they WRAP.
 */
export function fitted(font: PDFFont, text: string, width: number, start: number): number {
  for (let size = start; size > 5; size -= 0.5) {
    if (font.widthOfTextAtSize(text, size) <= width) return size;
  }
  return 5;
}

/**
 * Cut a string to what fits at its floor size, with an ellipsis.
 *
 * ⚠ **Shrinking alone is not enough and the sheet proved it.** `NATURE OF ACCIDENT (HEAD-ON,
 * REAR-END, ROLLOVER, ETC.)` does not fit an even fifth of the text width even at 5pt, so it ran
 * straight through `FATALITIES NUMBER` beside it — two headings on top of each other, on the sheet
 * that exists so nothing is lost.
 *
 * ⚠ **Applied to HEADINGS and to our own copy, never to an answer** — and the second half of that
 * rule changed on 2026-09-19. It used to end *"a value too long for its column shrinks to 5pt and is
 * allowed to be small"*, which was measured to be false: at 5pt the fourth accident's description
 * still did not fit and ran through the column beside it. An answer now WRAPS instead, which is the
 * option this page has and the carrier's 15.2pt rows do not. The first half stands: a truncated
 * column name is still readable beside the page it continues, and a truncated conviction is the
 * silent loss this whole sheet prevents.
 */
export function clipped(font: PDFFont, text: string, width: number, size: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * Break text onto as many lines as it needs, by word.
 *
 * ⚠ **A word wider than the column is broken by character rather than left to overrun** — the one
 * case word-wrapping alone cannot answer, and not hypothetical: the sheet's columns are a fifth of
 * the page and `Featherstonehaugh-Villanueva` is wider than that at 8.5pt. Breaking a surname is
 * ugly; drawing it through the next column is the defect this file was opened to fix.
 *
 * ⚠ **Exported for its own test only.** It makes the claim this whole module now rests on — *no line
 * that comes back is wider than the width it was given* — and that claim cannot be read back off a
 * produced page, because a drawn page's coordinates stop being trustworthy once pdf-lib has
 * bracketed the carrier's content in `q … Q`. So it is pinned directly, by "breaks a word that is
 * itself wider than the column, rather than letting it run"; what the RENDERER does with the lines
 * is pinned by "is drawn as several lines, not one run that overruns", which counts runs rather
 * than reading words, because rejoining wrapped lines reproduces the original sentence.
 */
export function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  const flush = (): void => {
    if (line) out.push(line);
    line = "";
  };
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    flush();
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
      let take = rest;
      while (take.length > 1 && font.widthOfTextAtSize(take, size) > width) take = take.slice(0, -1);
      out.push(take);
      rest = rest.slice(take.length);
    }
    line = rest;
  }
  flush();
  return out;
}
