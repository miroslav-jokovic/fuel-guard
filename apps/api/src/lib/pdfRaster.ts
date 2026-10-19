import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import { getDocument, PasswordException, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Opening and painting a PDF page in the API — the one place pdf.js is configured.
 *
 * Promoted out of `document-reading/pages/pdf.ts` (UNIT-FILES-PLAN UF3, D-UF10) when a second module
 * needed a page painted: the evidence module's thumbnails. Module isolation forbids evidence reaching
 * into document-reading's internals, and the configuration below is exactly the part that must not
 * exist twice — a copy that forgot `wasmUrl` would paint every scanned PDF as white paper, silently.
 *
 * pdf.js (`pdfjs-dist`, Apache-2.0 — already the web app's PDF viewer) parses and paints; it paints
 * onto `@napi-rs/canvas` (MIT; Skia, prebuilt per platform, no node-gyp), which pdf.js itself names
 * as its Node canvas. It is a DIRECT, statically imported dependency although pdf.js lists it as
 * optional: pdf.js probes for it at run time and, without it, fails only when a page is painted;
 * imported here, a host missing its platform's binary fails when this module loads, not on the first
 * PDF a driver sends (D-DR3).
 */

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

export type OpenedPdf =
  | { ok: true; doc: PDFDocumentProxy; close: () => Promise<void> }
  | { ok: false; code: "encrypted_pdf" | "decode_failed" };

export async function openPdf(bytes: Buffer): Promise<OpenedPdf> {
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

/** A painted page: 8-bit RGB, no alpha, flattened onto white. */
export interface PaintedPage {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Paint one page at `scale` (1 = 72 DPI, the PDF's own unit). The page's `/Rotate` is applied, so
 * the raster is the page as a person sees it.
 */
export async function paintPdfPage(page: PDFPageProxy, scale: number): Promise<PaintedPage> {
  const viewport = page.getViewport({ scale });
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
  return { data, width, height };
}

/**
 * Page 1, painted so its long edge is `longEdgePx` — what a thumbnail is cut from. Painted at the
 * target size directly rather than at 300 DPI and shrunk: a 320 px thumb from a 3,300 px raster is
 * ~34 MB of RGBA for 40 KB of result, and it is the derive worker, not the reader, paying it.
 */
export async function paintPdfFirstPage(
  bytes: Buffer,
  longEdgePx: number,
): Promise<{ ok: true; page: PaintedPage } | { ok: false; code: "encrypted_pdf" | "decode_failed" }> {
  const opened = await openPdf(bytes);
  if (!opened.ok) return opened;
  try {
    const page = await opened.doc.getPage(1);
    const unit = page.getViewport({ scale: 1 });
    const painted = await paintPdfPage(page, longEdgePx / Math.max(unit.width, unit.height));
    page.cleanup();
    return { ok: true, page: painted };
  } catch {
    return { ok: false, code: "decode_failed" };
  } finally {
    await opened.close();
  }
}
