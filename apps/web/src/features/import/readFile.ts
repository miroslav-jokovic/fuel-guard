import Papa from "papaparse";
import type { RawRow } from "@fleetguard/shared";

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
  const text = await file.text();
  const result = Papa.parse<Record<string, string>>(text, {
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
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };

  const headers: string[] = [];
  const headerRow = ws.getRow(1);
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    headers[col - 1] = String(cell.value ?? "").trim();
  });

  const rows: RawRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: RawRow = {};
    let hasValue = false;
    headers.forEach((h, i) => {
      const v = row.getCell(i + 1).value;
      const val = v == null ? null : typeof v === "object" ? String((v as { text?: string }).text ?? v) : (v as string | number);
      obj[h] = val;
      if (val != null && val !== "") hasValue = true;
    });
    if (hasValue) rows.push(obj);
  }
  return { headers, rows };
}
