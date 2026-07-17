/**
 * Love's ingest: one uploaded Excel (LovesSearchResults.xlsx) carries the whole network's exact locations
 * AND current posted diesel/DEF prices. Love's has its OWN store-number space (brand='loves', never the
 * Pilot family). Stations upsert on (brand, store_number) with exact coordinates; prices land in
 * fuel_prices_posted (product diesel + def, USD/gal, price_kind='posted'); a fresh ingest fully replaces
 * the source's prior prices (no accumulation). Gates before any write: parse, completeness floor (~650 network), diesel-median sanity.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLovesExport, median, type Cell, type LovesLocationRow } from "@fuelguard/shared";

const BRAND = "loves";
export const LOVES_EXPORT_SOURCE = "loves_export";
const MIN_ROWS = 400; // network is ~650; a partial export must be refused
const DIESEL_MEDIAN_BAND = { min: 2.0, max: 9.0 };

export interface LovesIngestResult {
  ok: boolean;
  error?: string;
  totalRows: number;
  stationsUpserted: number;
  pricesInserted: number;
  skipped: number;
  observedAt: string | null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface LovesWriteResult {
  ok: boolean;
  error?: string;
  stationsUpserted: number;
  pricesInserted: number;
  skipped: number;
}

/**
 * Shared writer: upsert Love's stations (own store-number space) + posted diesel/DEF prices. Used by BOTH
 * the Excel importer and the live API adapter, so their DB shape is identical. Idempotent per
 * (source, observed_at) for prices; stations upsert on (brand, store_number).
 */
export async function upsertLoves(
  admin: SupabaseClient,
  rows: LovesLocationRow[],
  meta: { source: string; observedAt: string },
): Promise<LovesWriteResult> {
  const nowIso = new Date().toISOString();
  const stationRows = rows.map((r) => ({
    brand: BRAND, store_number: r.storeNumber, name: r.name, lat: r.lat, lng: r.lng,
    state: r.state, city: r.city, address: r.address, zip: r.zip, exit: r.exit, country: "US",
    parking_spaces: r.parkingSpaces, has_diesel: r.hasDiesel, has_def: r.hasDef, status: "active",
    source: meta.source, coord_source: "exact_export", location_updated_at: nowIso, updated_at: nowIso,
  }));
  const idByStore = new Map<string, string>();
  let stationsUpserted = 0;
  for (const part of chunk(stationRows, 500)) {
    const { data, error } = await admin
      .from("fuel_stations").upsert(part, { onConflict: "brand,store_number" }).select("id, store_number");
    if (error) return { ok: false, error: `Station upsert failed: ${error.message}`, stationsUpserted, pricesInserted: 0, skipped: 0 };
    for (const row of data ?? []) if (row.store_number) idByStore.set(String(row.store_number), row.id as string);
    stationsUpserted += data?.length ?? 0;
  }

  // Replace the source's prior prices entirely so a fresh upload/sync fully supersedes the old snapshot.
  const del = await admin.from("fuel_prices_posted").delete().eq("source", meta.source);
  if (del.error) return { ok: false, error: `Posted-price replace failed: ${del.error.message}`, stationsUpserted, pricesInserted: 0, skipped: 0 };
  const priceRows: Record<string, unknown>[] = [];
  for (const r of rows) {
    const stationId = idByStore.get(r.storeNumber);
    if (!stationId) continue;
    if (r.dieselPrice != null) priceRows.push({ station_id: stationId, product: "diesel", price: r.dieselPrice, currency: "USD", unit: "gal", price_kind: "posted", source: meta.source, observed_at: meta.observedAt });
    if (r.defPrice != null) priceRows.push({ station_id: stationId, product: "def", price: r.defPrice, currency: "USD", unit: "gal", price_kind: "posted", source: meta.source, observed_at: meta.observedAt });
  }
  let pricesInserted = 0;
  for (const part of chunk(priceRows, 500)) {
    const { error } = await admin.from("fuel_prices_posted").insert(part);
    if (error) return { ok: false, error: `Posted-price insert failed: ${error.message}`, stationsUpserted, pricesInserted, skipped: 0 };
    pricesInserted += part.length;
  }
  return { ok: true, stationsUpserted, pricesInserted, skipped: 0 };
}

export async function ingestLovesExport(admin: SupabaseClient, grid: Cell[][]): Promise<LovesIngestResult> {
  const parsed = parseLovesExport(grid);
  const base = { totalRows: parsed.rows.length, stationsUpserted: 0, pricesInserted: 0, skipped: parsed.skipped, observedAt: parsed.priceObservedAt };
  if (!parsed.headerFound) {
    return { ok: false, error: "Unrecognized file — expected the Love's 'Search Results' export (StoreNumber / Latitude / Diesel columns).", ...base };
  }
  if (parsed.rows.length < MIN_ROWS) {
    return { ok: false, error: `Completeness gate: ${parsed.rows.length} stores < required ${MIN_ROWS} — refusing a partial export.`, ...base };
  }
  const dieselUsd = parsed.rows.map((r) => r.dieselPrice).filter((n): n is number => n != null);
  const med = median(dieselUsd);
  if (med == null || med < DIESEL_MEDIAN_BAND.min || med > DIESEL_MEDIAN_BAND.max) {
    return { ok: false, error: `Sanity gate: median diesel ${med ?? "n/a"} outside ${DIESEL_MEDIAN_BAND.min}-${DIESEL_MEDIAN_BAND.max} $/gal — refusing (column drift?).`, ...base };
  }
  const observedAt = parsed.priceObservedAt ?? new Date().toISOString();
  const w = await upsertLoves(admin, parsed.rows, { source: LOVES_EXPORT_SOURCE, observedAt });
  if (!w.ok) return { ok: false, error: w.error, ...base };
  return { ok: true, ...base, stationsUpserted: w.stationsUpserted, pricesInserted: w.pricesInserted };
}
