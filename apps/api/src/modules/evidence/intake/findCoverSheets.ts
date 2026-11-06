import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import sharp from "sharp";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { isBlankPage, parseCoverSheetPayload } from "@silvicom/shared";
import { openPdf, paintPdfPage } from "../../../lib/pdfRaster.js";

/**
 * Which pages of a scanned PDF are driver cover sheets, and whose (DRIVER-PAPER-INTAKE-PLAN PI1/PI2).
 * Intake cuts the file at each one; every page after a sheet, up to the next, is that driver's.
 *
 * ── HOW A PAGE IS LOOKED AT ──────────────────────────────────────────────────────────────────────
 * Each page is painted at 150 dpi — the sheet's symbol is 3½" (coverSheetPdf.ts), so its modules are
 * ~10 px wide there, far above what the decoder needs, and a 250-page stack is painted in seconds
 * rather than the reader's 300 dpi minutes — and handed to ZXing as a grayscale PNG, QR only. A page
 * with a QR that is not one of our sheets (a carrier's own form can carry one) is not a sheet.
 *
 * The decoder's WASM is read from this package's own copy, never fetched (the web loads its copy from
 * its own origin for the same reason, `lib/barcode/barcodeReader.ts`). Pages are painted one at a
 * time: at 150 dpi a letter page is ~6 MB, and the stack can be long.
 */
export interface FoundCoverSheet {
  /** 1-based page number in the file. */
  page: number;
  driverId: string;
}

const SCAN_DPI = 150;
const require = createRequire(import.meta.url);
let prepared = false;

function prepareDecoder(): void {
  if (prepared) return;
  const wasmBinary = readFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm"));
  prepareZXingModule({ overrides: { wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) as ArrayBuffer }, fireImmediately: false });
  prepared = true;
}

/** The driver a page's QR names, or null — exported so a caller holding a painted page can ask too. */
export async function coverSheetOnImage(png: Buffer): Promise<string | null> {
  prepareDecoder();
  const results = await readBarcodes(new Uint8Array(png), { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 4 });
  for (const r of results) {
    const driverId = r.isValid ? parseCoverSheetPayload(r.text) : null;
    if (driverId) return driverId;
  }
  return null;
}

export type ScanStackOutcome =
  | { ok: true; pageCount: number; sheets: FoundCoverSheet[]; blankPages: number[] }
  | { ok: false; code: "encrypted_pdf" | "decode_failed" | "too_many_pages" };

/**
 * One pass over a stack (PI2): each page painted once, asked whether it is a cover sheet and, if not,
 * whether it is blank (`isBlankPage`, the threshold's reasoning is there). `maxPages` is checked before
 * a page is painted, as the reader's own intake does — a 2,000-page file costs nothing to refuse.
 */
export async function scanStack(pdf: Buffer, maxPages = Number.POSITIVE_INFINITY): Promise<ScanStackOutcome> {
  const opened = await openPdf(pdf);
  if (!opened.ok) return opened;
  const { doc, close } = opened;
  try {
    if (doc.numPages > maxPages) return { ok: false, code: "too_many_pages" };
    const sheets: FoundCoverSheet[] = [];
    const blankPages: number[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const painted = await paintPdfPage(page, SCAN_DPI / 72);
      page.cleanup();
      const grey = sharp(painted.data, { raw: { width: painted.width, height: painted.height, channels: 3 } }).grayscale();
      const driverId = await coverSheetOnImage(await grey.clone().png({ compressionLevel: 1 }).toBuffer());
      if (driverId) {
        sheets.push({ page: n, driverId });
        continue;
      }
      const raw = await grey.raw().toBuffer();
      if (isBlankPage(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength))) blankPages.push(n);
    }
    return { ok: true, pageCount: doc.numPages, sheets, blankPages };
  } catch {
    return { ok: false, code: "decode_failed" };
  } finally {
    await close();
  }
}

export type FindCoverSheetsOutcome =
  | { ok: true; pageCount: number; sheets: FoundCoverSheet[] }
  | { ok: false; code: "encrypted_pdf" | "decode_failed" };

/** The cover sheets alone (PI1's question). */
export async function findCoverSheets(pdf: Buffer): Promise<FindCoverSheetsOutcome> {
  const r = await scanStack(pdf);
  if (!r.ok) return r.code === "too_many_pages" ? { ok: false, code: "decode_failed" } : { ok: false, code: r.code };
  return { ok: true, pageCount: r.pageCount, sheets: r.sheets };
}
