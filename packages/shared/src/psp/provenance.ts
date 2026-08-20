/**
 * Where a filed PSP record came from — read from the row, never inferred from its shape (P9).
 *
 * Two paths write a `psp_report` qualification record and they are not interchangeable. One was
 * bought through the API and parsed: its `detail` carries counted inspections and crashes, and the
 * transaction is in `psp_requests` with a status and a billing flag. The other is a PDF somebody
 * uploaded from the portal: it satisfies the file and nothing machine-read it.
 *
 * ── WHY A STORED FIELD AND NOT A HEURISTIC ─────────────────────────────────────────────────────
 * The tempting shortcut is "if it has an inspection count it was ordered". That is an inference from
 * absence, and it is wrong in the one case that matters: an ordered record for a driver with no
 * inspections at all also has no counts worth showing, and would be mislabelled as an import — a
 * clean record and an unexamined one look identical from the outside (D-PSP5). So the writer states
 * the source and the reader believes it.
 *
 * `unknown` is a real answer, not a fallback for tidiness: a record written before this field
 * existed genuinely does not say where it came from, and saying so is better than guessing.
 */

export const PSP_SOURCE_API = "psp_api";
export const PSP_SOURCE_IMPORT = "portal_import";

/** Kept for the import path's own use — the same string, named for what it means there. */
export const PSP_IMPORT_SOURCE = PSP_SOURCE_IMPORT;

export type PspRecordSource = "psp_api" | "portal_import" | "unknown";

export const PSP_SOURCE_LABELS: Record<PspRecordSource, string> = {
  psp_api: "Ordered",
  portal_import: "Imported",
  unknown: "Source not recorded",
};

export function pspRecordSource(detail: Record<string, unknown> | null | undefined): PspRecordSource {
  const source = detail?.["source"];
  if (source === PSP_SOURCE_API) return "psp_api";
  if (source === PSP_SOURCE_IMPORT) return "portal_import";
  return "unknown";
}

/** True only for a record that says it was imported. An `unknown` record is NOT treated as one. */
export const isImportedPspRecord = (detail: Record<string, unknown> | null | undefined): boolean =>
  pspRecordSource(detail) === "portal_import";

/**
 * Whether this record carries structured inspection and crash data.
 *
 * Asked as its own question rather than derived from the source, because the two can come apart: a
 * future OCR path would be neither `psp_api` nor unread. The import writes `structured: false`
 * explicitly and the API path's records are structured, so an `unknown` record answers false — the
 * safe direction, since the consequence of a wrong `true` is rendering counts nothing produced.
 */
export const hasStructuredPspData = (detail: Record<string, unknown> | null | undefined): boolean =>
  detail?.["structured"] === true || pspRecordSource(detail) === "psp_api";
