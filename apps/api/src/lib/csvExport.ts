import { csvCell } from "@silvicom/shared";

/**
 * A scoped, server-rendered CSV of a filtered list (FUEL-P2, D-FUI15).
 *
 * ── WHY THE SERVER RENDERS IT AND THE BROWSER DOES NOT ──────────────────────────────────────────
 * Every export in the fuel section before P2 was `downloadCsv(rows.value)` — the rows the browser was
 * holding. On the fuel lists that is ONE PAGE out of a filtered set that reaches five figures, so
 * "truck 654's August, as a file" would have produced twenty rows and said nothing about the rest.
 *
 * ── A TRUNCATED EXPORT IS THE DEFECT, NOT THE FALLBACK ──────────────────────────────────────────
 * PostgREST answers at most 1,000 rows whatever the request asks for (measured on the hosted project,
 * 2026-09-04), so an export pages. Two things follow. Paging needs a UNIQUE tiebreaker — a tied sort is
 * not a total order, and the first full financial projection failed on exactly that — so each caller
 * orders by its natural key AND by `id`. And beyond `MAX_EXPORT_ROWS` the answer is a refusal naming
 * the count, never a file that quietly stops: a spreadsheet with no last row looks complete.
 *
 * ⚠ These helpers do NOT scope anything to an org. The service role bypasses RLS, so every caller adds
 * its own `.eq("org_id", …)`, and `expectOrgScoped` asserts it there.
 */

/** Rows past which an export refuses rather than truncates. ~6 MB of CSV; a busy month is ~3,000. */
export const MAX_EXPORT_ROWS = 50_000;

/** One PostgREST page. The server caps responses at 1,000 whatever is asked for. */
const PAGE = 1_000;

export interface ExportScope {
  /** What the file covers, printed on the file — see `scopeLine`. */
  title: string;
  from: string | null;
  to: string | null;
  /** How many trucks the reader selected; 0 means the whole fleet. */
  trucks: number;
  generatedAt: string;
}

export interface CsvExport {
  csv: string;
  rows: number;
}

/** More rows than the export will produce, with the count so the caller can say how much to narrow. */
export class ExportTooLargeError extends Error {
  constructor(public readonly rows: number) {
    super(`That selection is ${rows.toLocaleString("en-US")} rows.`);
    this.name = "ExportTooLargeError";
  }
}

/**
 * The first line of every file, and the reason it is there.
 *
 * `ReportExportButton` prints the scope beside the button so the coupling between the filter bar and
 * the document is visible. D-FUI15 asks for the same sentence ON the artefact, because a file outlives
 * its download: a CSV in an email six weeks later has no filter bar above it, and "is this all of
 * August or only the two trucks we were arguing about" is the question that makes somebody re-run it.
 *
 * It is a `#` comment line, which Excel and Sheets import as a one-cell first row a reader can see and
 * delete. The alternative — scope in the filename only — loses it the first time anybody renames the
 * file, which is the first thing anybody does.
 */
export function scopeLine(s: ExportScope, rows: number): string {
  const window = s.from && s.to ? `${s.from} → ${s.to}` : s.from ? `from ${s.from}` : s.to ? `to ${s.to}` : "all dates";
  const trucks = s.trucks === 0 ? "all trucks" : `${s.trucks} truck${s.trucks === 1 ? "" : "s"}`;
  return `# ${s.title} · ${window} · ${trucks} · ${rows.toLocaleString("en-US")} rows · generated ${s.generatedAt}`;
}

const line = (values: readonly unknown[]): string => values.map(csvCell).join(",");

/** Header, rows, and the scope line above them — the shape every export produces. */
export function renderCsv(
  scope: ExportScope,
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): CsvExport {
  return {
    csv: [scopeLine(scope, rows.length), line(headers), ...rows.map(line)].join("\r\n"),
    rows: rows.length,
  };
}

/**
 * Page a filtered read to completion, or refuse.
 *
 * `build` is handed the range and returns the query, so the caller keeps its own table, columns,
 * filters and order. The count comes from the FIRST page's `count: "exact"` — one round trip rather
 * than two, and it is the number the refusal quotes.
 */
export async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null; count: number | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error, count } = await build(start, start + PAGE - 1);
    if (error) throw new Error(error.message);
    if (start === 0 && (count ?? 0) > MAX_EXPORT_ROWS) throw new ExportTooLargeError(count ?? 0);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < PAGE) return out;
    // A guard rather than a promise: `count` already refused an oversized set, and this catches a
    // count that lied — a concurrent insert — instead of paging forever.
    if (out.length >= MAX_EXPORT_ROWS) throw new ExportTooLargeError(out.length);
  }
}
