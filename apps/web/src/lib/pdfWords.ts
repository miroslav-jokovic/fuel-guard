/**
 * PDF → positioned words, in the browser. The decode edge for vendor statements that arrive as PDF.
 *
 * Kept deliberately thin: everything that decides MEANING lives in `@silvicom/shared`
 * (`parsePilotStatement`, `splitTextRun`), so it is pure and unit-tested. This module only turns a File
 * into `{ text, x, y, page }` and normalises pdfjs's coordinate system.
 *
 * pdfjs is dynamically imported, exactly like ExcelJS in `usePriceUpload` — it is a large dependency and
 * only an upload should pay for it.
 */
import { splitTextRun, type StatementWord } from "@silvicom/shared";

/** Guards against a mis-picked file turning into a multi-minute parse. Statements run ~25 pages. */
const MAX_PAGES = 400;

let workerConfigured = false;

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!workerConfigured) {
    // Vite resolves `?url` to the emitted asset; the worker keeps parsing off the main thread so a
    // 25-page statement doesn't freeze the page.
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    workerConfigured = true;
  }
  return pdfjs;
}

/** True when the bytes really are a PDF — sniffed, never trusted from the extension. */
export function looksLikePdf(buf: ArrayBuffer): boolean {
  const h = new Uint8Array(buf.slice(0, 5));
  return h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46; // "%PDF"
}

/**
 * Every word in the document with its position. Origin is top-left and y increases downward, matching
 * how the statement parser reasons about rows; pdfjs reports a baseline measured up from the bottom, so
 * it is flipped here once rather than in the parser.
 */
export async function readPdfWords(buf: ArrayBuffer): Promise<StatementWord[]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
  const doc = await task.promise;
  try {
    if (doc.numPages > MAX_PAGES) {
      throw new Error(`That PDF has ${doc.numPages} pages — too large to be a fuel statement.`);
    }
    const words: StatementWord[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      try {
        const height = page.getViewport({ scale: 1 }).height;
        const content = await page.getTextContent();
        for (const item of content.items) {
          if (!("str" in item)) continue; // marked-content markers carry no text
          words.push(
            ...splitTextRun({
              text: item.str,
              x: item.transform[4] as number,
              y: height - (item.transform[5] as number),
              page: p,
              width: item.width ?? 0,
            }),
          );
        }
      } finally {
        page.cleanup();
      }
    }
    return words;
  } finally {
    await task.destroy(); // releases the worker; a leaked one survives every subsequent upload
  }
}
