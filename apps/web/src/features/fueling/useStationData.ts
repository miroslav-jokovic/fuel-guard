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

export interface KwikTripSyncResult {
  ok: boolean;
  tableRows: number;
  stationsUpserted: number;
  truckFriendlyNoDiesel: number;
  truckFriendlyNotInTable: number;
  skipped: number;
}

/** Sync the Kwik Trip network (official truck-friendly stores only) into the shared registry. */
export async function syncKwikTrip(): Promise<KwikTripSyncResult> {
  const res = await apiFetch<KwikTripSyncResult>("/api/fueling/networks/kwiktrip/sync", { method: "POST" });
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Kwik Trip sync failed");
  return res.data;
}

export interface RoadRangerFetchResult {
  ok: boolean;
  rows: number;
  stationsUpserted: number;
  pricesInserted: number;
  geocodeFailed: number;
  skipped: number;
}

/** Fetch Road Ranger stations + today's truck-diesel cash prices. */
export async function fetchRoadRanger(): Promise<RoadRangerFetchResult> {
  const res = await apiFetch<RoadRangerFetchResult>("/api/fueling/networks/roadranger/fetch", { method: "POST" });
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Road Ranger fetch failed");
  return res.data;
}
