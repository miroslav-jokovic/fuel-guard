import {
  ASSEMBLY_MAX_PAGES, FORMAT_EXTENSIONS, FORMAT_MIMES, INTAKE_LIMITS, INTAKE_REFUSALS, SOURCE_FORMATS, type SourceFormat,
} from "@silvicom/shared";
// The intake's own sniff, so a file is never refused here that the server would read (lib/fileFormat.ts).
import { formatOf } from "@/lib/fileFormat";

/**
 * The photos a dispatcher has picked for ONE bill of lading, before anything is sent (DOCUMENT-READER-PLAN
 * §7A, N2; D-DR14). Drivers send a BOL as several photos — to Samsara, or by text to a dispatcher — so the
 * calculator takes several files and treats them as the pages of one document, in the order shown. The
 * dispatcher can untick a photo (a placard shot, a retake) and move one earlier or later; the order of the
 * ticked files is the order `POST /api/documents/assemblies` receives, and so the order the reader reads.
 *
 * Pure apart from reading each file's first bytes, so the list's rules are tested without a browser; the
 * panel only renders it.
 */

/** The canonical mime of each format — what the upload declares once the bytes have said what the file is. */
export type IntakeMime = (typeof FORMAT_MIMES)[SourceFormat][0];

export interface BolFile {
  /** Stable across reorders, for `v-for` keys and the thumbnail's object URL. */
  key: string;
  file: File;
  mime: IntakeMime;
  included: boolean;
}

/**
 * What the browser's file picker offers. `image/*` so a phone shows camera + gallery and nothing image-like is
 * greyed out; then every format's extensions, because a desktop dialog filters by name and Google Voice saves
 * a JPEG as `.jfif`. The picker only steers — `formatOf` reads the bytes and decides.
 */
export const BOL_ACCEPT = ["image/*", "application/pdf", ...SOURCE_FORMATS.flatMap((f) => FORMAT_EXTENSIONS[f])].join(",");

/** Why a file cannot be sent at all, in the intake's own sentence — the same one the server would answer. */
export function fileProblem(file: Pick<File, "size">, format: SourceFormat | null): string | null {
  if (file.size === 0) return INTAKE_REFUSALS.decode_failed;
  if (!format) return INTAKE_REFUSALS.unsupported_format;
  if (file.size > INTAKE_LIMITS.maxBytes) return INTAKE_REFUSALS.too_large;
  return null;
}

/** A file picked twice (the same photo dropped again) is the same file: name, size and modified time. */
const identity = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

export interface AddResult {
  files: BolFile[];
  /** Files left out, each with the reason, for the panel to say. */
  skipped: { name: string; reason: string }[];
}

/**
 * Append `picked` after the files already there, in the order picked, skipping any that cannot be sent or
 * are already in the list, and any past `ASSEMBLY_MAX_PAGES` files (one document's page limit — a PDF can
 * still carry more pages than files, and the server counts those).
 */
export async function addFiles(current: readonly BolFile[], picked: readonly File[], newKey: () => string): Promise<AddResult> {
  const files = [...current];
  const skipped: AddResult["skipped"] = [];
  const seen = new Set(current.map((f) => identity(f.file)));
  for (const file of picked) {
    const format = file.size > 0 ? await formatOf(file) : null;
    const problem = fileProblem(file, format);
    if (problem) { skipped.push({ name: file.name, reason: problem }); continue; }
    if (seen.has(identity(file))) { skipped.push({ name: file.name, reason: "Already added." }); continue; }
    if (files.length >= ASSEMBLY_MAX_PAGES) {
      skipped.push({ name: file.name, reason: `One document holds at most ${ASSEMBLY_MAX_PAGES} pages.` });
      continue;
    }
    seen.add(identity(file));
    files.push({ key: newKey(), file, mime: FORMAT_MIMES[format!][0], included: true });
  }
  return { files, skipped };
}

/** Move the file at `index` one place earlier (-1) or later (+1); a move past either end changes nothing. */
export function moveFile(files: readonly BolFile[], index: number, by: -1 | 1): BolFile[] {
  const to = index + by;
  if (index < 0 || index >= files.length || to < 0 || to >= files.length) return [...files];
  const next = [...files];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

export const toggleFile = (files: readonly BolFile[], key: string): BolFile[] =>
  files.map((f) => (f.key === key ? { ...f, included: !f.included } : f));

export const removeFile = (files: readonly BolFile[], key: string): BolFile[] => files.filter((f) => f.key !== key);

/** The ticked files, in the order shown — the document's pages. */
export const includedFiles = (files: readonly BolFile[]): BolFile[] => files.filter((f) => f.included);

/** A thumbnail every browser can draw itself; PDF, HEIC and TIFF show a file tile instead. */
const PREVIEWABLE: readonly IntakeMime[] = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
export const canPreview = (mime: IntakeMime): boolean => PREVIEWABLE.includes(mime);
