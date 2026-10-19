import type { RoadsideInspectionDto } from "@silvicom/shared";

/**
 * Which inspection a dropped officer's report belongs to, from its FILE NAME only (INSPECTION-CHALLENGE-PLAN
 * IC15's bulk upload, owner 2026-10-19). Proposed, never filed on its own: a person confirms every file.
 *
 * ── WHY THE NAME AND NOT THE PAPER ──────────────────────────────────────────────────────────────
 * A filed document is frozen (0146, append-only), so reading the paper first and choosing its inspection
 * afterwards would mean re-filing it. The name is known before anything is filed; the reader's check
 * (IC10, `report_number_mismatch`) still says so on the driver card if the paper turns out to be another
 * inspection's.
 *
 * ── A WHOLE WORD OF THE NAME, NEVER A SUBSTRING ────────────────────────────────────────────────
 * Measured 2026-10-19: every one of our 1,387 report numbers is ten characters and many are all digits
 * (`3282002265`), so a phone's `IMG_20261014123456` holds a ten-digit run by chance. A name matches only a
 * word that IS the report number, or the number with its state in front (`IL3282002265`, how some states
 * print it) — and only when exactly one inspection matches.
 */
export function matchReportFile(
  fileName: string,
  inspections: readonly Pick<RoadsideInspectionDto, "id" | "reportNumber" | "reportState">[],
): string | null {
  const stem = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const words = new Set(stem.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
  const hits = inspections.filter((i) => {
    const n = i.reportNumber?.trim().toUpperCase();
    if (!n) return false;
    return words.has(n) || (!!i.reportState && words.has(`${i.reportState.trim().toUpperCase()}${n}`));
  });
  return hits.length === 1 ? hits[0]!.id : null;
}
