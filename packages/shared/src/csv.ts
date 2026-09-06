/**
 * One rule for what a CSV cell may contain, for every exporter in the product (FUEL-P2).
 *
 * ── WHY IT MOVED HERE ───────────────────────────────────────────────────────────────────────────
 * There were two of them. `dashboard.ts` held the API's (RFC-4180 quoting plus the S-1 formula guard)
 * and `apps/web/src/lib/csv.ts` held the browser's — the same rule written twice, and they had already
 * drifted on the case that matters most to a finance reader:
 *
 *     shared:  -12.50  →  '-12.50      (text, and the column will not sum)
 *     web:     -12.50  →  -12.50       (a number, which is what somebody downloaded a CSV for)
 *
 * The web version is right and says why in its own header: the naive guard neutralises every negative
 * dollar figure, "which defeats the reason anyone downloads a CSV. A leading `-` followed by digits is
 * arithmetic, not an injection vector." P2 needed a server-side CSV for five fuel lists and would have
 * had to pick one of the two — so instead there is now one, and it is the one with the argument.
 *
 * ── WHAT THE GUARD IS FOR ───────────────────────────────────────────────────────────────────────
 * Audit finding S-1. A cell beginning `=`, `+`, `-` or `@` (or a leading tab or CR) is read as a
 * FORMULA by Excel and Sheets and executes when the file is opened. Station names, driver names and
 * the vendor's free-text fields are exported verbatim from a feed nobody in this company controls, so
 * they are prefixed with an apostrophe, which those tools strip on display.
 *
 * A value that is simply a NUMBER is exempt, negative ones included — `Number.isFinite` decides, so
 * `-12.50` and `+1.5` pass through and `-SUM(A1)` does not.
 */

/** One cell: the formula guard, then RFC-4180 quoting. */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  const isNumeric = s !== "" && Number.isFinite(Number(s));
  const safe = !isNumeric && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * A grid — ordered headers and rows of values — as CSV.
 *
 * CRLF, which is what RFC 4180 specifies and what the browser exporter has always emitted; Excel,
 * Sheets and every `read_csv` accept it.
 */
export function toCsvGrid(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");
}

/** The same thing, for callers that hold objects and a column map. */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
): string {
  return toCsvGrid(
    columns.map((c) => c.header),
    rows.map((r) => columns.map((c) => r[c.key])),
  );
}
