import { INTAKE_LIMITS, type IntakeRefusalCode } from "@silvicom/shared";
import { OPS, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";
import { openPdf, paintPdfPage } from "../../../lib/pdfRaster.js";
import { toCanonicalPage, type CanonicalPage } from "./canonical.js";
import { textLayerOf, type TextRun } from "./textLayer.js";

/**
 * PDF → canonical pages (D-DR3, §3's rasteriser choice, recorded by Step 1.3 on 2026-10-09).
 *
 * pdf.js parses and paints onto `@napi-rs/canvas`; how it is configured — fonts, the WASM decoders a
 * scanned PDF needs — lives in `lib/pdfRaster.ts`, promoted there when the evidence module's
 * thumbnails needed a page painted too (UNIT-FILES-PLAN UF3). MuPDF's WASM build was ruled out on
 * licence (AGPL, a hosted service); poppler would need a system package added to the Nixpacks image.
 * The PDF itself is never sent to a model (D-DR3): the model sees exactly the raster the ledger crops.
 */

/** §3: "rasterise each page at 300 DPI". A PDF's unit is the point, 72 to the inch. */
export const PDF_RENDER_DPI = 300;
/**
 * The raster's long-edge ceiling. A BOL is Letter or Legal (3,300 / 4,200 px at 300 DPI); a 17-inch
 * tabloid is 5,100. A page larger than this (an engineering drawing, a 200-inch "page" a broken
 * generator wrote) is rendered at the DPI that fits rather than allocating gigabytes for it — and the
 * DPI it got is recorded on the page, so nothing downstream mistakes it for 300.
 */
export const MAX_RASTER_LONG_EDGE_PX = 6000;

type PdfOutcome = { ok: true; pages: CanonicalPage[] } | { ok: false; code: IntakeRefusalCode };

type GlyphWidths = Map<string, Map<string, number>>;

/**
 * Each font's glyph advances as the page actually uses them: pdf.js's operator list carries every
 * shown glyph with its `unicode` and `width`, under the `setFont` that selected it — the same
 * `loadedName` the text content reports as an item's `fontName`. textLayer.ts weighs word boxes by it.
 */
async function glyphWidthsOf(page: PDFPageProxy): Promise<GlyphWidths> {
  const { fnArray, argsArray } = await page.getOperatorList();
  const widths: GlyphWidths = new Map();
  let font: Map<string, number> | undefined;
  fnArray.forEach((fn, i) => {
    const args = argsArray[i] as unknown[];
    if (fn === OPS.setFont) {
      const name = String(args[0]);
      font = widths.get(name) ?? new Map();
      widths.set(name, font);
    } else if (fn === OPS.showText && font) {
      for (const glyph of args[0] as unknown[]) {
        if (typeof glyph !== "object" || glyph === null) continue; // a TJ kerning number
        const { unicode, width } = glyph as { unicode?: string; width?: number };
        if (unicode && typeof width === "number" && !font.has(unicode)) font.set(unicode, width);
      }
    }
  });
  return widths;
}

function runsOf(
  items: readonly unknown[],
  styles: Record<string, { ascent: number; descent: number }>,
  widths: GlyphWidths,
): TextRun[] {
  return items
    .filter((item): item is TextItem => typeof item === "object" && item !== null && "str" in item)
    .map((item) => ({
      str: item.str,
      transform: item.transform as number[],
      width: item.width,
      // pdf.js reports 0/0 for a font it could not size; one em above the baseline is the fallback.
      ascent: styles[item.fontName]?.ascent || 1,
      descent: styles[item.fontName]?.descent ?? 0,
      glyphWidth: (char: string) => widths.get(item.fontName)?.get(char),
    }));
}

async function renderPage(page: PDFPageProxy, pageNumber: number): Promise<CanonicalPage> {
  const unit = page.getViewport({ scale: 1 }); // includes the page's /Rotate
  const longEdgeIn = Math.max(unit.width, unit.height) / 72;
  const dpi = Math.min(PDF_RENDER_DPI, Math.floor(MAX_RASTER_LONG_EDGE_PX / longEdgeIn));
  const viewport = page.getViewport({ scale: dpi / 72 });
  const { data, width, height } = await paintPdfPage(page, dpi / 72);

  const content = await page.getTextContent();
  const textLayer = textLayerOf(runsOf(content.items, content.styles, await glyphWidthsOf(page)), {
    transform: viewport.transform,
    width: viewport.width,
    height: viewport.height,
  });
  page.cleanup();
  return toCanonicalPage({ data, width, height }, pageNumber, textLayer, dpi);
}

export async function normalisePdf(bytes: Buffer): Promise<PdfOutcome> {
  const opened = await openPdf(bytes);
  if (!opened.ok) return opened;
  const { doc, close } = opened;
  try {
    // Counted before a single page is painted: an 80-page PDF costs nothing to refuse.
    if (doc.numPages > INTAKE_LIMITS.maxPages) return { ok: false, code: "too_many_pages" };
    const pages: CanonicalPage[] = [];
    // Sequential on purpose — one 300 DPI page is ~34 MB of RGBA, and ten in parallel is a worker OOM.
    for (let n = 1; n <= doc.numPages; n++) {
      try {
        pages.push(await renderPage(await doc.getPage(n), n));
      } catch {
        return { ok: false, code: "decode_failed" };
      }
    }
    return { ok: true, pages };
  } finally {
    await close();
  }
}
