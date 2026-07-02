import Papa from "papaparse";
import { detectReportKind, type RawRow } from "@fuelguard/shared";

export interface ParsedFile {
  headers: string[];
  rows: RawRow[];
}

/**
 * Safely extract a plain string from an ExcelJS cell value.
 * ExcelJS can return:
 *   - formula cells:   { formula: "...", result: <CellValue> }
 *   - rich-text cells: { richText: [{ text: "..." }, ...] }
 *   - shared-formula:  { sharedFormula: "...", result: <CellValue> }
 *   - plain strings, numbers, booleans, Date objects, null
 * Falling back to "" prevents [object Object] poisoning normKey().
 */
function cellText(raw: unknown): string {
  if (raw == null) return "";
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw !== "object") return String(raw);
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.richText)) {
    return (obj.richText as Array<{ text?: unknown }>)
      .map((r) => (r.text != null ? String(r.text) : ""))
      .join("");
  }
  if (obj.result != null) return cellText(obj.result);
  if (obj.text != null) return String(obj.text);
  return "";
}

/** Read an EFS export (.xlsx or .csv) into header + row objects. ExcelJS is lazy-loaded. */
export async function readFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return readCsv(file);
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return readXlsx(file);
  throw new Error("Unsupported file type — upload an .xlsx or .csv EFS report");
}

async function readCsv(file: File): Promise<ParsedFile> {
  let text = await file.text();
  // Strip UTF-8 BOM if present (common in EFS exports saved from Windows).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  // Parse the WHOLE file as arrays first (quoted fields can legally contain commas and newlines — a
  // naive line split miscounted columns, could miss the header row, and silently dropped data), then
  // locate the header row among the first 8 parsed rows and build objects positionally from it.
  // Require at least 5 non-empty cells — a title row like "Reject Transaction Report" has only 1.
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
  const data = parsed.data.filter((r) => Array.isArray(r));
  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(8, data.length); i++) {
    const cols = (data[i] ?? []).map((c) => String(c ?? "").trim());
    if (cols.filter(Boolean).length >= 5 && detectReportKind(cols) !== "unknown") {
      headerRowIndex = i;
      break;
    }
  }

  const headers = (data[headerRowIndex] ?? []).map((h) => String(h ?? "").trim());
  const rows: RawRow[] = [];
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const cells = data[i] ?? [];
    const obj: RawRow = {};
    let hasValue = false;
    headers.forEach((h, c) => {
      if (!h) return; // unnamed column — no header to key by
      const v = cells[c] != null ? String(cells[c]).trim() : "";
      obj[h] = v === "" ? null : v;
      if (v !== "") hasValue = true;
    });
    if (hasValue) rows.push(obj);
  }
  return { headers: headers.filter(Boolean), rows };
}

interface SheetCandidate {
  parsed: ParsedFile;
  recognized: boolean; // detectReportKind found a known EFS report on this sheet
}

async function readXlsx(file: File): Promise<ParsedFile> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

  // Evaluate EVERY worksheet and pick the BEST candidate: a sheet whose header row detectReportKind
  // recognises beats one it doesn't (EFS workbooks can lead with a summary/title sheet), and among
  // equals the one with the most data rows wins. "First sheet with any rows" picked summaries.
  let best: SheetCandidate | null = null;
  for (const ws of wb.worksheets) {
    // Scan the first 8 rows looking for a row that detectReportKind accepts.
    // Require at least 5 non-empty cells — a title row like "Reject Transaction Report" has only 1.
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

    // Read headers POSITIONALLY (includeEmpty) — with includeEmpty:false an empty header cell
    // mid-row shifted every following column one left, silently landing values under wrong headers.
    const headers: string[] = [];
    ws.getRow(headerRowNum).eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = cellText(cell.value).trim();
    });
    while (headers.length && !headers[headers.length - 1]) headers.pop();
    if (headers.filter(Boolean).length === 0) continue;

    const rows: RawRow[] = [];
    for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const obj: RawRow = {};
      let hasValue = false;
      headers.forEach((h, i) => {
        if (!h) return; // unnamed column — no header to key by
        const v = row.getCell(i + 1).value;
        const val = v == null ? null : (cellText(v) || null);
        obj[h] = val;
        if (val != null && val !== "") hasValue = true;
      });
      if (hasValue) rows.push(obj);
    }
    if (rows.length === 0) continue;

    const cand: SheetCandidate = { parsed: { headers: headers.filter(Boolean), rows }, recognized };
    const beats =
      !best ||
      (cand.recognized && !best.recognized) ||
      (cand.recognized === best.recognized && cand.parsed.rows.length > best.parsed.rows.length);
    if (beats) best = cand;
  }

  return best?.parsed ?? { headers: [], rows: [] };
}
