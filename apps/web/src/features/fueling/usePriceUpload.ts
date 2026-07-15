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

/** Decode a Pilot price report (.xls/.xlsx) into a raw cell grid, client-side. SheetJS is lazy-loaded. */
export async function readReportGrid(file: File): Promise<(string | number | null)[][]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) throw new Error("The file has no sheets.");
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true }) as (string | number | null)[][];
}

/** Upload a decoded report grid to the server for parse + geocode + upsert. */
export async function uploadPriceReport(file: File): Promise<PriceIngestResult> {
  const grid = await readReportGrid(file);
  const res = await apiFetch<PriceIngestResult>("/api/fueling/prices", { method: "POST", body: { grid } });
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the price report");
  return res.data;
}
