import { apiFetch } from "@/lib/api";
import { readReportGrid } from "./usePriceUpload";

export interface LocationsIngestResult {
  ok: boolean;
  totalRows: number;
  updated: number;
  inserted: number;
  skipped: number;
  unknownBrandNames: string[];
  missingFromExport: number;
  movedFar: number;
}

export interface PostedIngestResult {
  ok: boolean;
  stationRows: number;
  pricesInserted: number;
  unmatched: number;
  skipped: number;
}

/** Upload the Pilot "Download All Locations" export (.csv) — exact coordinates into the global registry. */
export async function uploadLocationsExport(file: File): Promise<LocationsIngestResult> {
  const grid = await readReportGrid(file); // SheetJS reads .csv and .xlsx identically into a cell grid
  const res = await apiFetch<LocationsIngestResult>("/api/fueling/locations", { method: "POST", body: { grid } });
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the locations export");
  return res.data;
}

/** Upload the public "Download Fuel Prices" export (.xlsx) — network-wide POSTED prices (global layer). */
export async function uploadPostedPrices(file: File): Promise<PostedIngestResult> {
  const grid = await readReportGrid(file);
  const res = await apiFetch<PostedIngestResult>("/api/fueling/posted-prices", { method: "POST", body: { grid } });
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the posted prices");
  return res.data;
}

/** Trigger the automated posted-price page fetch now (same reliability gates as the scheduler). */
export async function fetchPostedPricesNow(): Promise<PostedIngestResult> {
  const res = await apiFetch<PostedIngestResult>("/api/fueling/posted-prices/fetch", { method: "POST" });
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Posted-price fetch failed");
  return res.data;
}
