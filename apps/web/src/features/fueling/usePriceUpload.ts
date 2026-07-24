import type * as ExcelJS from "exceljs";
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

/** Decode a Pilot price report (.xlsx) into a raw cell grid, client-side. ExcelJS is lazy-loaded. */
export async function readReportGrid(file: File): Promise<(string | number | null)[][]> {
  const ExcelJS = await import("exceljs");
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The file has no sheets.");
  const grid: (string | number | null)[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const raw = (row.values as (ExcelJS.CellValue | undefined)[]).slice(1);
    grid.push(
      raw.map((v): string | number | null => {
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
      })
    );
  });
  return grid;
}

/** Upload a decoded report grid to the server for parse + geocode + upsert. */
export async function uploadPriceReport(file: File): Promise<PriceIngestResult> {
  const grid = await readReportGrid(file);
  const res = await apiFetch<PriceIngestResult>("/api/fueling/prices", { method: "POST", body: { grid } });
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the price report");
  return res.data;
}
