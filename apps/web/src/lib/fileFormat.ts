import { FORMAT_MIMES, SNIFF_BYTES, sniffFormat, type SourceFormat } from "@silvicom/shared";

/**
 * What a picked file IS, read from its first bytes — the same sniff the document reader's intake runs
 * (`@silvicom/shared` documentFormats.ts) — and the content type an upload should declare for it.
 *
 * Every upload used to declare `file.type`, the browser's guess from the file name. That guess is wrong in
 * the two cases the office meets every day: desktop Chrome and Firefox type an iPhone HEIC as `""`, which
 * every server allowlist refuses, and a Google Voice photo is a JPEG named `.jfif`, which the pickers'
 * hand-typed ".jpg,.jpeg" lists would not even offer (10/12/2026). The bytes do not have either problem.
 */
export async function formatOf(file: Blob): Promise<SourceFormat | null> {
  return sniffFormat(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
}

/**
 * The content type to declare for `file` when the upload takes only `allowed`: the canonical mime of the
 * format its bytes are, or null when that is not one of them (or not a format at all) — the caller's
 * sentence then names what it takes.
 */
export async function uploadContentType<T extends string>(file: Blob, allowed: readonly T[]): Promise<T | null> {
  const format = await formatOf(file);
  if (!format) return null;
  const mime = FORMAT_MIMES[format][0];
  return (allowed as readonly string[]).includes(mime) ? (mime as T) : null;
}
