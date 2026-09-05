/**
 * CSV download, client-side.
 *
 * The carrier's next step with any of these figures is a spreadsheet or an email to Pilot, so every
 * table on the spend surface offers its rows as a file. Kept in `lib/` rather than a feature because
 * four tabs use it.
 */

/**
 * ⚠ The quoting and the formula guard live in `@silvicom/shared` since FUEL-P2 — `csvCell`, with this
 * file's own numeric exemption and this file's argument for it. There were two implementations of one
 * rule and they had drifted; P2 needed a SERVER-side CSV for five fuel lists and would otherwise have
 * had to choose between them. What stays here is the browser half: a download.
 */
import { toCsvGrid } from "@silvicom/shared";

export { toCsvGrid as toCsv };

/** Trigger a download of the given rows as `filename`. */
export function downloadCsv(filename: string, headers: readonly string[], rows: readonly unknown[][]): void {
  // BOM so Excel reads it as UTF-8 — city names carry accents and the ¢ sign appears in headers.
  const blob = new Blob(["﻿", toCsvGrid(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
