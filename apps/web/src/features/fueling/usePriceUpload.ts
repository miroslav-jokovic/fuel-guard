import type * as ExcelJS from "exceljs";
import Papa from "papaparse";
import { apiFetch } from "@/lib/api";

export interface PriceIngestResult {
  ok: boolean;
  account: string | null;
  effectiveDate: string | null;
  totalRows: number;
  duplicatesInFile: number;
  uniqueSites: number;
  stationsUpserted: number;
  pricesInserted: number;
  geocodeFailed: number;
  skipped: number;
}

type Cell = string | number | null;
type Grid = Cell[][];

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

/** SheetJS cell → scalar (mirrors cellToScalar): keep numbers/strings, boolean→number, Date→ISO, blank→null. */
function xlsCellToScalar(v: unknown): Cell {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return Number(v);
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Legacy binary .xls (BIFF, 1997–2003 — an OLE compound file, NOT a zip, so ExcelJS can't read it).
 * SheetJS is lazy-loaded (only .xls uploads pull the chunk). We emit the same dense, 0-indexed cell grid
 * as the ExcelJS path so the shared parser (parsePilotPriceReport) sees identical rows/columns.
 */
async function readXlsGrid(buf: ArrayBuffer): Promise<Grid> {
  const { read, utils } = await import("xlsx");
  const wb = read(new Uint8Array(buf), { type: "array", cellDates: true });
  const name = wb.SheetNames[0];
  if (!name) throw new Error("The workbook has no sheets.");
  const ws = wb.Sheets[name];
  const rows = utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: true, defval: null });
  return rows.map((row) => (Array.isArray(row) ? row.map(xlsCellToScalar) : []));
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
 * HTML table (or CSV) — feeding those to ExcelJS threw "can't find end of central directory". Genuine
 * modern spreadsheets go through ExcelJS; legacy binary `.xls` (1997–2003) is decoded with SheetJS (lazy-loaded).
 */
export async function readReportGrid(file: File): Promise<Grid> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // "PK" → .xlsx/.xlsm
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0; // legacy .xls

  if (isZip) return readXlsxGrid(buf);
  if (isOle) {
    try {
      return await readXlsGrid(buf);
    } catch {
      // A genuinely corrupt/password-protected .xls — give the one reliable workaround.
      throw new Error(
        "We couldn't read this .xls file. If it keeps failing, open it in Excel and choose File → Save As → Excel Workbook (.xlsx), then re-upload.",
      );
    }
  }

  const text = new TextDecoder("utf-8").decode(buf);
  const looksHtml = /^\s*<(!doctype|html|table|meta|\?xml)/i.test(text) || /<table[\s>]/i.test(text);
  const grid = looksHtml ? readHtmlGrid(text) : readCsvGrid(text);
  if (grid.length === 0) throw new Error("The report appears to be empty — no rows were found.");
  return grid;
}

/** Upload a decoded report grid to the server for parse + geocode + upsert. */
export async function uploadPriceReport(file: File): Promise<PriceIngestResult> {
  const grid = await readReportGrid(file);
  const res = await apiFetch<PriceIngestResult>("/api/fueling/prices", { method: "POST", body: { grid } });
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the price report");
  return res.data;
}
