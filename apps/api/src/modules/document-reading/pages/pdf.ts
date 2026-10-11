import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import { INTAKE_LIMITS, type IntakeRefusalCode } from "@silvicom/shared";
import { getDocument, OPS, PasswordException, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";
import { toCanonicalPage, type CanonicalPage } from "./canonical.js";
import { textLayerOf, type TextRun } from "./textLayer.js";

/**
 * PDF → canonical pages (D-DR3, §3's rasteriser choice, recorded by Step 1.3 on 2026-10-09).
 *
 * pdf.js (`pdfjs-dist`, Apache-2.0 — already the web app's PDF viewer) parses and paints; it paints
 * onto `@napi-rs/canvas` (MIT; Skia, prebuilt per platform, no node-gyp), which pdf.js itself names
 * as its Node canvas. It is a DIRECT, statically imported dependency of the api although pdf.js lists
 * it as optional: pdf.js probes for it at run time and, without it, fails only when a page is
 * painted; imported here, a host missing its platform's binary fails when this module loads, not
 * on the first PDF a driver sends. MuPDF's WASM build was ruled out on licence (AGPL, a hosted
 * service); poppler would need a system package added to the Nixpacks image. The PDF itself is
 * never sent to a model (D-DR3): the model sees exactly the raster the ledger crops.
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

const require = createRequire(import.meta.url);
/**
 * The fonts pdf.js substitutes for the 14 standard PDF fonts, which born-digital BOLs use unembedded
 * (Helvetica, Courier). Without them pdf.js falls back to whatever the host has — a different
 * raster on a laptop and on Railway, which would break the byte-identical promise and the cache key.
 * `useSystemFonts: false` closes the same door from the other side.
 */
const PDFJS_ROOT = join(dirname(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")), "../../");
const STANDARD_FONTS = join(PDFJS_ROOT, "standard_fonts/");
/**
 * pdf.js 6 decodes CCITT fax (`CCITTFaxDecode`) and JBIG2 through `jbig2.wasm`, JPEG 2000 through
 * `openjpeg.wasm`, and ICC-based colour through `qcms_bg.wasm` — all shipped in `pdfjs-dist/wasm/`
 * and found ONLY through `wasmUrl`. Without it the decoder fails to start, pdf.js logs a warning
 * (silenced by `verbosity: 0`), skips the image, and the page renders as clean white paper: no
 * refusal, no error, a "page" the reader would then read as empty. Measured 2026-10-10 on all ten
 * office BOL samples — every one a scanned CCITT G4 PDF, the format a copier's scan-to-PDF and a
 * fax gateway both write — and pinned by "renders a scanned CCITT G4 PDF — the copier and fax
 * gateway format — with its ink on the page".
 */
const PDFJS_WASM = join(PDFJS_ROOT, "wasm/");
const PDFJS_ICC = join(PDFJS_ROOT, "iccs/");

type PdfOutcome = { ok: true; pages: CanonicalPage[] } | { ok: false; code: IntakeRefusalCode };

type Opened = { ok: true; doc: PDFDocumentProxy; close: () => Promise<void> } | { ok: false; code: IntakeRefusalCode };

async function open(bytes: Buffer): Promise<Opened> {
  const task = getDocument({
    // pdf.js transfers (detaches) the buffer it is given; copy so the caller's bytes stay intact.
    data: new Uint8Array(bytes),
    standardFontDataUrl: STANDARD_FONTS,
    wasmUrl: PDFJS_WASM,
    iccUrl: PDFJS_ICC,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    return { ok: true, doc: await task.promise, close: () => task.destroy() };
  } catch (e) {
    await task.destroy();
    // Only a PDF that needs a password to OPEN is refused as encrypted. One encrypted with an owner
    // password alone (print/copy permissions — e-BOL systems emit these) opens and renders with no
    // password, so it is not "password-protected" in the sense the sender's sentence means.
    if (e instanceof PasswordException) return { ok: false, code: "encrypted_pdf" };
    return { ok: false, code: "decode_failed" };
  }
}

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
  const width = Math.round(viewport.width);
  const height = Math.round(viewport.height);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  // @napi-rs/canvas implements the 2D-context surface pdf.js paints through; its TypeScript types are
  // its own, not the DOM's, hence the casts to the parameter types pdf.js declares.
  type RenderParams = Parameters<PDFPageProxy["render"]>[0];
  await page.render({
    canvas: canvas as unknown as RenderParams["canvas"],
    canvasContext: ctx as unknown as RenderParams["canvasContext"],
    viewport,
    background: "rgb(255,255,255)",
  }).promise;
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const { data } = await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    raw: { width, height, channels: 4 },
  })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });

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
  const opened = await open(bytes);
  if (!opened.ok) return opened;
  const { doc, close } = opened;
  try {
    // Counted before a single page is painted: an 80-page PDF costs nothing to refuse.
    if (doc.numPages > INTAKE_LIMITS.maxPdfPages) return { ok: false, code: "too_many_pages" };
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
