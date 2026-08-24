/**
 * Fuel-price report upload. The file decode lives in `@/lib/reportGrid` (shared with the station import
 * and statement reconciliation); this module is the price-ingest call on top of it.
 */
import { apiFetch } from "@/lib/api";
import { readReportGrid } from "@/lib/reportGrid";

export { readReportGrid };
export type { Cell, Grid } from "@/lib/reportGrid";

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

/** Upload a decoded report grid to the server for parse + geocode + upsert. */
export async function uploadPriceReport(file: File): Promise<PriceIngestResult> {
  const grid = await readReportGrid(file);
  const res = await apiFetch<PriceIngestResult>("/api/fueling/prices", { method: "POST", body: { grid } });
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the price report");
  return res.data;
}
