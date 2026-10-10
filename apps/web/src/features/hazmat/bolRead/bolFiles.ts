import { ASSEMBLY_MAX_PAGES, INTAKE_LIMITS, INTAKE_MIMES, INTAKE_REFUSALS } from "@silvicom/shared";

/**
 * The photos a dispatcher has picked for ONE bill of lading, before anything is sent (DOCUMENT-READER-PLAN
 * §7A, N2; D-DR14). Drivers send a BOL as several photos — to Samsara, or by text to a dispatcher — so the
 * calculator takes several files and treats them as the pages of one document, in the order shown. The
 * dispatcher can untick a photo (a placard shot, a retake) and move one earlier or later; the order of the
 * ticked files is the order `POST /api/documents/assemblies` receives, and so the order the reader reads.
 *
 * Pure, so the list's rules are tested without a browser; the panel only renders it.
 */

export type IntakeMime = (typeof INTAKE_MIMES)[number];

export interface BolFile {
  /** Stable across reorders, for `v-for` keys and the thumbnail's object URL. */
  key: string;
  file: File;
  mime: IntakeMime;
  included: boolean;
}

/** What the browser's file picker offers: the intake's formats by extension, so phones show camera + gallery + files. */
export const BOL_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";

const BY_EXTENSION: Record<string, IntakeMime> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif",
};

/**
 * The file's intake type. The browser's own `type` first; then the extension, because Chrome and Firefox
 * on a desktop report an iPhone's HEIC photo as `""` — refusing it would refuse the photos drivers send.
 */
export function mimeOf(file: Pick<File, "name" | "type">): IntakeMime | null {
  if ((INTAKE_MIMES as readonly string[]).includes(file.type)) return file.type as IntakeMime;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return BY_EXTENSION[ext] ?? null;
}

/** Why a file cannot be sent at all, in the intake's own sentence — the same one the server would answer. */
export function fileProblem(file: Pick<File, "name" | "type" | "size">): string | null {
  if (!mimeOf(file)) return INTAKE_REFUSALS.unsupported_format;
  if (file.size > INTAKE_LIMITS.maxBytes) return INTAKE_REFUSALS.too_large;
  if (file.size === 0) return INTAKE_REFUSALS.decode_failed;
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
export function addFiles(current: readonly BolFile[], picked: readonly File[], newKey: () => string): AddResult {
  const files = [...current];
  const skipped: AddResult["skipped"] = [];
  const seen = new Set(current.map((f) => identity(f.file)));
  for (const file of picked) {
    const problem = fileProblem(file);
    if (problem) { skipped.push({ name: file.name, reason: problem }); continue; }
    if (seen.has(identity(file))) { skipped.push({ name: file.name, reason: "Already added." }); continue; }
    if (files.length >= ASSEMBLY_MAX_PAGES) {
      skipped.push({ name: file.name, reason: `One document holds at most ${ASSEMBLY_MAX_PAGES} pages.` });
      continue;
    }
    seen.add(identity(file));
    files.push({ key: newKey(), file, mime: mimeOf(file)!, included: true });
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

/** A thumbnail the browser can draw itself; PDF and HEIC show a file tile instead. */
export const canPreview = (mime: IntakeMime): boolean => mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
