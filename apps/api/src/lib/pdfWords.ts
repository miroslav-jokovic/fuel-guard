/**
 * PDF → positioned words, on the server — the same `{ text, x, y, page }` the browser's
 * `apps/web/src/lib/pdfWords.ts` produces, so a shared statement reader sees identical input either
 * side (TOLLS-PER-TRUCK-PLAN TL4b).
 *
 * WHY the server reads the PDF itself: a toll statement is evidence for every per-truck figure built
 * on it (D-TL8). The fuel statements send the browser's words and re-run the parse server-side; a
 * toll statement goes one step further — the API opens the bytes it stored and checked (0627's
 * size + SHA-256), so not even the words are taken on the browser's word.
 *
 * Mirrors the browser decoder deliberately: same pdf.js, same top-left origin (y flipped once here),
 * same `splitTextRun`. `scripts/lib/pdfWordsNode.mjs` is the third copy, for the local real-file
 * check; keep the three in step.
 */
import { splitTextRun, type StatementWord } from "@silvicom/shared";
import { openPdf } from "./pdfRaster.js";

/** Statements run ≤ 50 pages (E-ZPass 44, measured); anything far larger is not one. */
const MAX_PAGES = 400;

export type PdfWordsOutcome =
  | { ok: true; words: StatementWord[] }
  | { ok: false; reason: "encrypted_pdf" | "decode_failed" | "too_many_pages" | "no_text" };

export async function readPdfWords(bytes: Buffer): Promise<PdfWordsOutcome> {
  const opened = await openPdf(bytes);
  if (!opened.ok) return { ok: false, reason: opened.code };
  const { doc, close } = opened;
  try {
    if (doc.numPages > MAX_PAGES) return { ok: false, reason: "too_many_pages" };
    const words: StatementWord[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      try {
        const height = page.getViewport({ scale: 1 }).height;
        const content = await page.getTextContent();
        for (const item of content.items) {
          if (!("str" in item)) continue; // marked-content markers carry no text
          words.push(
            ...splitTextRun({ text: item.str, x: item.transform[4] as number, y: height - (item.transform[5] as number), page: p, width: item.width ?? 0 }),
          );
        }
      } finally {
        page.cleanup();
      }
    }
    // A scan has pages and no words. D-TL7: money is never read from an image.
    if (words.length === 0) return { ok: false, reason: "no_text" };
    return { ok: true, words };
  } finally {
    await close();
  }
}
