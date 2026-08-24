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
 * `.xls` is rejected with a convert-to-xlsx prompt.
 */
export async function readReportGrid(input: File | ArrayBuffer): Promise<Grid> {
  const buf = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // "PK" → .xlsx/.xlsm
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0; // legacy .xls

  if (isZip) return readXlsxGrid(buf);
  if (isOle) {
    throw new Error(
      "Legacy .xls binary files are not supported. Open the file in Excel and choose File → Save As → Excel Workbook (.xlsx), then re-upload.",
    );
  }

  const text = new TextDecoder("utf-8").decode(buf);
  const looksHtml = /^\s*<(!doctype|html|table|meta|\?xml)/i.test(text) || /<table[\s>]/i.test(text);
  const grid = looksHtml ? readHtmlGrid(text) : readCsvGrid(text);
  if (grid.length === 0) throw new Error("The report appears to be empty — no rows were found.");
  return grid;
}

