export { openPdf as openInspectionPdf, downloadPdf as downloadInspectionPdf } from "@/lib/documentDownload";

/**
 * Which PDF an inspection means, and what the saved file is called.
 *
 * ── ONE FETCH, TWO VERBS, FOUR CALLERS ────────────────────────────────────────────────────────
 * The report page, the print drawer and the register's row menu all reach the same API routes
 * (`report.pdf` for a filed report, `preview.pdf` for a draft, `overlay.pdf` for a pre-printed pad).
 * The FETCH behind them moved to `@/lib/documentDownload` on 2026-09-11, when the application preview
 * became the fourth caller from a different feature — `lint:boundaries` forbids importing another
 * feature's internals, and a second copy of those twelve lines would have been the wrong answer to a
 * rule that is right. The two verbs are re-exported under their old names so the three callers here
 * did not have to move with it.
 *
 * ── DOWNLOAD IS NOT "OPEN AND LET THEM SAVE" ──────────────────────────────────────────────────
 * The owner's ask: get the PDF without opening the inspection, and without a preview tab. An
 * anchor with `download` set hands the blob straight to the browser's save flow, named — an
 * office filing eleven reports into a DOT folder should not have to rename eleven "report.pdf"s.
 */

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
