import { detectReportKind, type RawRow } from "@fuelguard/shared";

/**
 * Server-side EFS report reader: turns delivered file bytes into the same `{ headers, rows }` shape the
 * browser reader (apps/web/src/features/import/readFile.ts) produced, so the shared parser downstream
 * behaves identically. CSV is parsed by a self-contained RFC-4180 tokenizer (no dependency, fully
 * unit-tested). XLSX is decoded by exceljs, loaded via a RUNTIME dynamic import so this module
 * type-checks and the API boots even before `exceljs` is installed — an .xlsx delivered before the
 * dependency is present fails with a clear, quarantinable error rather than crashing the process.
 */

export interface ParsedFile {
  headers: string[];
  rows: RawRow[];
}

export type FileSource = "csv" | "xlsx";

/** Classify by extension. Anything else is unsupported and should be quarantined by the caller. */
export function fileSourceFor(filename: string): FileSource | null {
  const name = filename.toLowerCase();
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "xlsx";
  return null;
}

export async function readEfsBuffer(filename: string, buf: Buffer): Promise<ParsedFile> {
  const kind = fileSourceFor(filename);
  if (kind === "csv") return parseCsv(buf.toString("utf8"));
  if (kind === "xlsx") return readXlsx(buf);
  throw new Error(`Unsupported EFS file type: ${filename} (expected .csv or .xlsx)`);
}

// ── CSV ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * RFC-4180 tokenizer: fields may be quoted; quoted fields may contain commas, CRLF/newlines, and
 * escaped quotes (""). A naive line/comma split miscounts columns and silently drops data — the same
 * failure the web reader's comments call out. Handles LF, CRLF and lone-CR line endings.
 */
export function tokenizeCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let sawAny = false; // did the current row have any content (so a trailing newline doesn't add [""])

  const endField = () => {
    row.push(field);
    field = "";
    sawAny = true;
  };
  const endRow = () => {
    row.push(field);
    field = "";
    rows.push(row);
    row = [];
    sawAny = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      endField();
    } else if (c === "\n") {
      endRow();
    } else if (c === "\r") {
      if (text[i + 1] === "\n") continue; // CRLF — let the \n end the row
      endRow(); // lone CR
    } else {
      field += c;
      sawAny = true;
    }
  }
  // Flush a final unterminated row (no trailing newline).
  if (sawAny || field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Parse an EFS CSV export into header + row objects. Mirrors the web reader: strip a UTF-8 BOM, drop
 * fully-empty rows, then locate the header row among the first 8 rows (an EFS export can lead with a
 * title row like "Reject Transaction Report") by requiring ≥5 non-empty cells that detectReportKind
 * recognizes, and build row objects positionally from that header.
 */
export function parseCsv(input: string): ParsedFile {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const data = tokenizeCsv(text)
    .map((r) => r.map((c) => (c ?? "").trim()))
    .filter((r) => r.some((c) => c !== ""));

  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(8, data.length); i++) {
    const cols = data[i] ?? [];
    if (cols.filter(Boolean).length >= 5 && detectReportKind(cols) !== "unknown") {
      headerRowIndex = i;
      break;
    }
  }

  const headers = (data[headerRowIndex] ?? []).map((h) => h.trim());
  const rows: RawRow[] = [];
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const cells = data[i] ?? [];
    const obj: RawRow = {};
    let hasValue = false;
    headers.forEach((h, c) => {
      if (!h) return; // unnamed column — no header to key by
      const v = (cells[c] ?? "").trim();
      obj[h] = v === "" ? null : v;
      if (v !== "") hasValue = true;
    });
    if (hasValue) rows.push(obj);
  }
  return { headers: headers.filter(Boolean), rows };
}

// ── XLSX (exceljs, runtime-loaded) ──────────────────────────────────────────────────────────────────

/** Minimal shapes we use from exceljs — kept local so this file needs no @types/exceljs to compile. */
interface XlsxCell {
  value: unknown;
}
interface XlsxRow {
  eachCell(opts: { includeEmpty: boolean }, cb: (cell: XlsxCell, col: number) => void): void;
  getCell(col: number): XlsxCell;
}
interface XlsxWorksheet {
  rowCount: number;
  getRow(r: number): XlsxRow;
}

/** Safely coerce an exceljs cell value (formula/richText/date/primitive) to a string, like the web reader. */
function cellText(raw: unknown): string {
  if (raw == null) return "";
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw !== "object") return String(raw);
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.richText)) {
    return (obj.richText as { text?: unknown }[]).map((r) => (r.text != null ? String(r.text) : "")).join("");
  }
  if (obj.result != null) return cellText(obj.result);
  if (obj.text != null) return String(obj.text);
  return "";
}

async function loadExcelJs(): Promise<{ Workbook: new () => { xlsx: { load(b: Buffer): Promise<unknown> }; worksheets: XlsxWorksheet[] } }> {
  // Non-literal specifier: TypeScript does not resolve it, so this compiles without exceljs installed.
  const specifier = "exceljs";
  try {
    const mod = (await import(specifier)) as { default?: unknown };
    const ExcelJS = (mod.default ?? mod) as { Workbook: new () => { xlsx: { load(b: Buffer): Promise<unknown> }; worksheets: XlsxWorksheet[] } };
    if (!ExcelJS?.Workbook) throw new Error("exceljs loaded but Workbook missing");
    return ExcelJS;
  } catch (e) {
    throw new Error(
      `Cannot read .xlsx: the 'exceljs' dependency is not available (${e instanceof Error ? e.message : String(e)}). ` +
        `Run 'pnpm install' after adding exceljs, or deliver the EFS report as .csv.`,
      { cause: e },
    );
  }
}

/**
 * Decode an XLSX EFS export. Picks the BEST worksheet (a sheet whose header row detectReportKind
 * recognizes beats one it doesn't; among equals, the one with the most data rows), reading headers
 * positionally so an empty header cell mid-row doesn't shift following columns. Faithful to the web reader.
 */
async function readXlsx(buf: Buffer): Promise<ParsedFile> {
  const ExcelJS = await loadExcelJs();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  let best: { parsed: ParsedFile; recognized: boolean } | null = null;
  for (const ws of wb.worksheets) {
    let headerRowNum = 1;
    let recognized = false;
    for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
      const candidate: string[] = [];
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
        candidate.push(cellText(cell.value).trim());
      });
      if (candidate.length >= 5 && detectReportKind(candidate) !== "unknown") {
        headerRowNum = r;
        recognized = true;
        break;
      }
    }

    const headers: string[] = [];
    ws.getRow(headerRowNum).eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = cellText(cell.value).trim();
    });
    while (headers.length && !headers[headers.length - 1]) headers.pop();
    if (headers.filter(Boolean).length === 0) continue;

    const rows: RawRow[] = [];
    for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
      const rowObj = ws.getRow(r);
      const obj: RawRow = {};
      let hasValue = false;
      headers.forEach((h, i) => {
        if (!h) return;
        const v = rowObj.getCell(i + 1).value;
        const val = v == null ? null : cellText(v) || null;
        obj[h] = val;
        if (val != null && val !== "") hasValue = true;
      });
      if (hasValue) rows.push(obj);
    }
    if (rows.length === 0) continue;

    const cand = { parsed: { headers: headers.filter(Boolean), rows }, recognized };
    const beats =
      !best ||
      (cand.recognized && !best.recognized) ||
      (cand.recognized === best.recognized && cand.parsed.rows.length > best.parsed.rows.length);
    if (beats) best = cand;
  }

  return best?.parsed ?? { headers: [], rows: [] };
}
