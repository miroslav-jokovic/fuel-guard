import { z } from "zod";
import { recordId } from "../recordId.js";
import { tollProviderSchema } from "./tollContract.js";

/**
 * A toll provider's statement, as uploaded (TOLLS-PER-TRUCK-PLAN.md TL4a).
 *
 * ── THE FILE IS KEPT BEFORE ANY READER EXISTS, ON PURPOSE ────────────────────────────────────
 * The readers (TL5) are written from the providers' real files, and the office's way of handing those
 * over is this screen. So TL4a stores each statement exactly as it arrived, checked to be the file
 * that was picked and to be a statement-shaped file (PDF, spreadsheet, CSV), and nothing more. The
 * tolls inside are read later from the stored bytes, so nothing is ever uploaded twice. Until then
 * the list says "Not read yet" in so many words: a stored file is not a counted toll.
 *
 * ── THE FORMAT IS READ FROM THE BYTES, NEVER THE NAME (D-TL5) ────────────────────────────────
 * Agencies routinely send an HTML table named `.xls`; Excel re-saves CSVs as `.xlsx`. The format a
 * reader will meet is the one inside, so that is what is recorded, and a picture or a Word file named
 * `.pdf` is refused here rather than discovered by the reader months later.
 */

export const TOLL_STATEMENT_FORMATS = ["pdf", "xlsx", "ods", "xls", "html", "csv"] as const;
export type TollStatementFormat = (typeof TOLL_STATEMENT_FORMATS)[number];

export const TOLL_STATEMENT_FORMAT_LABEL: Record<TollStatementFormat, string> = {
  pdf: "PDF",
  xlsx: "Excel",
  ods: "OpenDocument",
  xls: "Excel 97–2003",
  html: "Web page table",
  csv: "CSV",
};

/** One statement file, 25 MB at most — the bucket refuses more (0626). */
export const TOLL_STATEMENT_MAX_BYTES = 25 * 1024 * 1024;

/** What the picker offers. A hint only: the bytes decide (`tollStatementFormatOf`). */
export const TOLL_STATEMENT_ACCEPT = ".pdf,.csv,.txt,.xlsx,.xlsm,.xls,.ods,.htm,.html";

const ODS_MIME = "application/vnd.oasis.opendocument.spreadsheet";

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let i = from; i < Math.min(to, bytes.length); i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

/**
 * What a statement file is, from its first bytes; null when it is none of the formats a toll
 * provider sends. Pass at least the first 64 KB: an OpenDocument file says so in its first entry,
 * an Excel workbook names its `xl/` parts within the first few.
 */
export function tollStatementFormatOf(bytes: Uint8Array): TollStatementFormat | null {
  if (bytes.length === 0) return null;
  // The PDF header may follow a few bytes of junk; readers accept it within the first kilobyte.
  if (ascii(bytes, 0, 1024).includes("%PDF-")) return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const head = ascii(bytes, 0, 64 * 1024);
    if (head.includes(ODS_MIME)) return "ods";
    if (head.includes("xl/")) return "xlsx";
    return null; // a zip, but a Word file, an archive of photos, anything but a workbook
  }
  if ([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((b, i) => bytes[i] === b)) return "xls";
  const sample = bytes.subarray(0, 8192);
  if (sample.includes(0)) return null; // binary: a picture, an executable
  const text = ascii(sample, 0, sample.length).replace(/^\xef\xbb\xbf/, "");
  if (/^\s*<(!doctype|html|table|meta|\?xml)/i.test(text) || /<table[\s>]/i.test(text)) return "html";
  return text.trim().length > 0 ? "csv" : null;
}

const fileNameSchema = z
  .string()
  .trim()
  .min(1, "The file has no name.")
  .max(200, "Rename the file to 200 characters or fewer.")
  .refine((s) => !/[/\\]/.test(s), "A file name cannot hold a slash.");

const byteSizeSchema = z
  .number()
  .int()
  .min(1, "The file is empty.")
  .max(TOLL_STATEMENT_MAX_BYTES, "A statement file can be 25 MB at most.");

/** POST /api/tolls/statements/upload — a place to put the bytes. */
export const tollStatementUploadSchema = z.object({
  provider: tollProviderSchema,
  fileName: fileNameSchema,
  byteSize: byteSizeSchema,
});
export type TollStatementUpload = z.infer<typeof tollStatementUploadSchema>;

/** POST /api/tolls/statements — the bytes are there; keep them if they are what was picked. */
export const tollStatementConfirmSchema = z.object({
  fileId: recordId(),
  provider: tollProviderSchema,
  fileName: fileNameSchema,
  byteSize: byteSizeSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "The file's fingerprint is malformed."),
});
export type TollStatementConfirm = z.infer<typeof tollStatementConfirmSchema>;

/** POST /api/tolls/statements/:id/remove — a wrong file stays listed, crossed out, with why. */
export const tollStatementRemoveSchema = z.object({
  reason: z.string().trim().min(3, "Say in a few words what was wrong.").max(300),
});
export type TollStatementRemove = z.infer<typeof tollStatementRemoveSchema>;

export interface TollStatementDto {
  id: string;
  provider: z.infer<typeof tollProviderSchema>;
  fileName: string;
  format: TollStatementFormat;
  byteSize: number;
  uploadedAt: string;
  uploadedByName: string | null;
  /** Filled when the statement is read (TL5); null until then. */
  periodStart: string | null;
  periodEnd: string | null;
  printedTotal: number | null;
  readAt: string | null;
  removedAt: string | null;
  removedByName: string | null;
  removeReason: string | null;
}
