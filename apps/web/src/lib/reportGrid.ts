/**
 * Vendor report file → raw cell grid, client-side. Shared decoder, not a fueling concern: the fuel-price
 * upload, the station import and the statement reconciliation all take arbitrary carrier files, so this
 * lives in `lib/` rather than inside one feature (`lint:boundaries` — promote shared code, don't
 * allow-list a cross-feature reach).
 *
 * The format is sniffed from MAGIC BYTES, never the extension: enterprise "reports" are routinely a
 * `.xls` that is really an HTML table, or a `.csv`. PDFs are handled separately by `@/lib/pdfWords`,
 * because a positioned-text document has no cell grid to produce.
 */
import type * as ExcelJS from "exceljs";
import Papa from "papaparse";

export type Cell = string | number | null;
export type Grid = Cell[][];

/** ExcelJS cell → scalar. ExcelJS returns formula/rich-text/hyperlink objects, numbers, strings, dates. */
function cellToScalar(v: ExcelJS.CellValue | undefined): Cell {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("result" in v) {
      const r = (v as { result?: ExcelJS.CellValue }).result;
      return typeof r === "number" || typeof r === "string" ? r : null;
    }
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((rt) => rt.text).join("");
    if ("text" in v) return String((v as ExcelJS.CellHyperlinkValue).text);
  }
  return null;
}

/** True modern spreadsheet (.xlsx/.xlsm are zip archives). ExcelJS is lazy-loaded. */
async function readXlsxGrid(buf: ArrayBuffer): Promise<Grid> {
  const ExcelJSMod = await import("exceljs");
  const wb = new ExcelJSMod.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The workbook has no sheets.");
  const grid: Grid = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const raw = (row.values as (ExcelJS.CellValue | undefined)[]).slice(1);
    grid.push(raw.map(cellToScalar));
  });
  return grid;
}


/**
 * Genuine Excel 97-2003 binary (BIFF8), which the carrier's daily Pilot price report actually is.
 *
 * This used to be a hard rejection telling the reader to open the file in Excel and re-save it — fine
 * for one file, and the reason ninety of them sat unimported. ExcelJS cannot read BIFF8 and Papa is
 * CSV, so a second decoder is genuinely needed rather than nice to have.
 *
 * Lazy-imported exactly like ExcelJS and pdfjs: it is ~1 MB and only an upload pays for it.
 */
async function readLegacyXlsGrid(buf: ArrayBuffer): Promise<Grid> {
  const XLSX = await import("@vendor/sheetjs/xlsx.mjs");
  // `cellDates` so a date cell arrives as a Date rather than an Excel serial — `parsePilotPriceReport`
  // and `parsePilotFuelReport` both already handle Date, and a bare 46174 reads as a number.
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
  const first = wb.SheetNames[0];
  if (!first) throw new Error("The workbook has no sheets.");
  const sheet = wb.Sheets[first];
  if (!sheet) throw new Error("The workbook has no sheets.");
  // `header: 1` gives rows as arrays — the same shape the other decoders produce. `defval: null` keeps
  // blank cells as positions rather than collapsing them, so column indexes stay aligned across rows.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true });
  return rows.map((row) =>
    (Array.isArray(row) ? row : []).map((v) => {
      if (v == null || v === "") return null;
      if (typeof v === "number" || typeof v === "string") return v;
      if (v instanceof Date) return v.toISOString();
      if (typeof v === "boolean") return Number(v);
      return String(v);
    }),
  );
}

/** Many fuel-price "reports" are an HTML <table> saved with an .xls extension. Parse the biggest table. */
function readHtmlGrid(text: string): Grid {
  const doc = new DOMParser().parseFromString(text, "text/html");
  const tables = Array.from(doc.querySelectorAll("table"));
  const table = tables.sort((a, b) => b.querySelectorAll("tr").length - a.querySelectorAll("tr").length)[0];
  if (!table) throw new Error("No table found in the report.");
  const grid: Grid = [];
  table.querySelectorAll("tr").forEach((tr) => {
    const cells: Cell[] = Array.from(tr.querySelectorAll("th,td")).map((c) => {
      const t = (c.textContent ?? "").trim();
      return t === "" ? null : t;
    });
    grid.push(cells);
  });
  return grid;
}

/** Plain CSV/TSV text. Quoted fields with commas/newlines are handled by Papa. */
function readCsvGrid(text: string): Grid {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip UTF-8 BOM
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
  return (parsed.data as string[][])
    .filter((r) => Array.isArray(r))
    .map((row) => row.map((c) => (c == null || c === "" ? null : c)));
}

/**
 * Decode a fuel-price report into a raw cell grid, client-side, sniffing the ACTUAL format by magic
 * bytes rather than trusting the extension. Enterprise reports are routinely a `.xls` that is really an
 * HTML table (or CSV). Modern spreadsheets (.xlsx/.xlsm) go through ExcelJS; genuine legacy binary OLE
 * `.xls` goes through the vendored SheetJS build (see `vendor/sheetjs/README.md` for why it is
 * vendored rather than installed).
 */
export async function readReportGrid(input: File | ArrayBuffer): Promise<Grid> {
  const buf = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // "PK" → .xlsx/.xlsm
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0; // legacy .xls

  if (isZip) return readXlsxGrid(buf);
  if (isOle) return readLegacyXlsGrid(buf);

  const text = new TextDecoder("utf-8").decode(buf);
  const looksHtml = /^\s*<(!doctype|html|table|meta|\?xml)/i.test(text) || /<table[\s>]/i.test(text);
  const grid = looksHtml ? readHtmlGrid(text) : readCsvGrid(text);
  if (grid.length === 0) throw new Error("The report appears to be empty — no rows were found.");
  return grid;
}

