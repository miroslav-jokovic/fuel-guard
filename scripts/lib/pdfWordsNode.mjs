/**
 * PDF → positioned words, in Node — the same `{ text, x, y, page }` the browser's
 * `apps/web/src/lib/pdfWords.ts` produces, for local checks that run a shared reader over files
 * which must never enter the repo (toll statements carry account numbers; TOLLS-PER-TRUCK-PLAN TL5).
 *
 * It mirrors the browser decoder rather than re-deriving positions some other way, because the
 * point of the local check is to prove what the browser will read: same pdfjs, same y-flip, same
 * `splitTextRun`. Keep the two in step.
 */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { splitTextRun } from "../../packages/shared/dist/index.js";

const require = createRequire(import.meta.url);

export async function readPdfWordsNode(path) {
  const pdfjs = await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs", { paths: [new URL("../../apps/web", import.meta.url).pathname] }));
  const data = new Uint8Array(await readFile(path));
  const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false });
  const doc = await task.promise;
  const words = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const { height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item)) continue;
        words.push(...splitTextRun({ text: item.str, x: item.transform[4], y: height - item.transform[5], page: p, width: item.width ?? 0 }));
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return words;
}
