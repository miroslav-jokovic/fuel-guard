/**
 * CSV download, client-side.
 *
 * The carrier's next step with any of these figures is a spreadsheet or an email to Pilot, so every
 * table on the spend surface offers its rows as a file. Kept in `lib/` rather than a feature because
 * four tabs use it.
 */

/**
 * RFC 4180 quoting, plus a formula guard: a value starting `=`, `+`, `-` or `@` is prefixed with an
 * apostrophe so a spreadsheet treats it as text. Station names and the vendor's P.O. field are free
 * text, and a cell beginning `=` executes the moment the file is opened.
 *
 * ⚠ A value that is simply a NUMBER is exempt, including a negative one. The guard's naive form
 * neutralises `-12.50` too, which turns every negative dollar figure in these exports into text and
 * makes the column unsummable — defeating the reason anyone downloads a CSV. A leading `-` followed by
 * digits is arithmetic, not an injection vector.
 */
function cell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  const isNumeric = s !== "" && Number.isFinite(Number(s));
  const safe = !isNumeric && /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n");
}

/** Trigger a download of the given rows as `filename`. */
export function downloadCsv(filename: string, headers: readonly string[], rows: readonly unknown[][]): void {
  // BOM so Excel reads it as UTF-8 — city names carry accents and the ¢ sign appears in headers.
  const blob = new Blob(["﻿", toCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
