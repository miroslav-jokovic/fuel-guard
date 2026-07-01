import Papa from "papaparse";
import { detectReportKind, type RawRow } from "@fuelguard/shared";

export interface ParsedFile {
  headers: string[];
  rows: RawRow[];
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

  // EFS CSVs sometimes have a title line before the actual header row.
  // Scan the first 8 lines and use the first one that detectReportKind recognises.
  // Require at least 5 columns — a title row like "Reject Transaction Report" has only 1.
  const lines = text.split(/\r?\n/);
  let headerLineIndex = 0;
  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const cols = lines[i]!.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length >= 5 && detectReportKind(cols) !== "unknown") {
      headerLineIndex = i;
      break;
    }
  }
  const trimmedText = lines.slice(headerLineIndex).join("\n");

  const result = Papa.parse<Record<string, string>>(trimmedText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const rows = result.data as RawRow[];
  const headers = result.meta.fields ?? (rows[0] ? Object.keys(rows[0]) : []);
  return { headers, rows };
}

async function readXlsx(file: File): Promise<ParsedFile> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

  // Try each worksheet in order; pick the first one that has a recognisable EFS header row.
  for (const ws of wb.worksheets) {
    // Scan the first 8 rows looking for a row that detectReportKind accepts.
    // EFS exports often have a title row (e.g. "Transaction Report – June 2026") before headers.
    // Require at least 5 cells — a title row like "Reject Transaction Report" has only 1.
    let headerRowNum = 1;
    for (let r = 1; r <= Math.min(8, ws.rowCount); r++) {
      const candidate: string[] = [];
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
        candidate.push(String(cell.value ?? "").trim());
      });
      if (candidate.length >= 5 && detectReportKind(candidate) !== "unknown") {
        headerRowNum = r;
        break;
      }
    }

    const headers: string[] = [];
    ws.getRow(headerRowNum).eachCell({ includeEmpty: false }, (cell, col) => {
      headers[col - 1] = String(cell.value ?? "").trim();
    });
    if (headers.length === 0) continue;

    const rows: RawRow[] = [];
    for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const obj: RawRow = {};
      let hasValue = false;
      headers.forEach((h, i) => {
        const v = row.getCell(i + 1).value;
        const val =
          v == null
            ? null
            : typeof v === "object"
              ? String((v as { text?: string; result?: unknown }).text ?? (v as { result?: unknown }).result ?? v)
              : (v as string | number);
        obj[h] = val;
        if (val != null && val !== "") hasValue = true;
      });
      if (hasValue) rows.push(obj);
    }
    if (rows.length > 0) return { headers, rows };
  }

  return { headers: [], rows: [] };
}
