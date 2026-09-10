import { fetchObjectUrl } from "@/lib/api";

/**
 * The two things anybody does with an inspection's PDF: open it, or keep it.
 *
 * ── ONE FETCH, TWO VERBS, THREE CALLERS ───────────────────────────────────────────────────────
 * The report page, the print drawer and the register's row menu all reach the same API routes
 * (`report.pdf` for a filed report, `preview.pdf` for a draft, `overlay.pdf` for a pre-printed
 * pad). Those routes sit behind `requireAuth`, so a plain `window.open` or an `<a href>` on the API
 * path carries no Authorization header and answers 401 — the bytes have to be fetched with the
 * session token and handed to the browser as a blob. That fetch lived in two components as two
 * copies of the same eight lines until 2026-09-10, when the register grew a Download action and
 * would have been the third.
 *
 * ── DOWNLOAD IS NOT "OPEN AND LET THEM SAVE" ──────────────────────────────────────────────────
 * The owner's ask: get the PDF without opening the inspection, and without a preview tab. An
 * anchor with `download` set hands the blob straight to the browser's save flow, named — an
 * office filing eleven reports into a DOT folder should not have to rename eleven "report.pdf"s.
 *
 * The object URL is revoked on a delay in both verbs rather than immediately: a new tab has to have
 * loaded it, and a download has to have started, before the URL stops meaning anything.
 */

const REVOKE_AFTER_MS = 60_000;

/** The API path for an inspection's page: the filed report, or the draft's preview. */
export function inspectionPdfPath(inspection: { id: string; status: "draft" | "final" }): string {
  return `/api/maintenance/inspections/${inspection.id}/${inspection.status === "final" ? "report" : "preview"}.pdf`;
}

/**
 * What the saved file is called. The unit and the date are what somebody looks for in a folder;
 * "preview" is in the name for a draft so it cannot be mistaken for the filed record.
 */
export function inspectionPdfFilename(inspection: {
  unit_number: string | null;
  inspected_on: string;
  status: "draft" | "final";
}): string {
  const unit = (inspection.unit_number ?? "unit").replace(/[^A-Za-z0-9-]+/g, "_");
  const stem = `annual-inspection-${unit}-${inspection.inspected_on}`;
  return inspection.status === "final" ? `${stem}.pdf` : `${stem}-preview.pdf`;
}

/** Open the PDF in a new tab. Throws with the API's own sentence when it cannot be fetched. */
export async function openInspectionPdf(path: string): Promise<void> {
  const url = await fetchObjectUrl(path);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/** Save the PDF under `filename` without opening it. Throws with the API's own sentence on failure. */
export async function downloadInspectionPdf(path: string, filename: string): Promise<void> {
  const url = await fetchObjectUrl(path);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
