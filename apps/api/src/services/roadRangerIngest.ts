/**
 * Road Ranger ingest: one public page carries both the station list (addresses) and today's TRUCK
 * DIESEL CASH prices ("updated at least daily", stamped). Stations are keyed by a deterministic
 * address slug (the page has no store numbers) and geocoded at ADDRESS level through the shared
 * geocode cache (coord_source='geocoded_address' — better than a city centroid, below an exact export).
 *
 * Gates before any write (same posture as the Pilot fetch): parse gate, completeness floor (the network
 * is ~55 stops), and a cash-diesel median sanity band. Prices land in fuel_prices_posted with
 * price_kind='cash' so they are never silently blended with card/posted quotes. Runs on the posted-price
 * scheduler cadence and from an admin button; idempotent per (source, observed_at).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseRoadRangerPrices, median } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { hereGeocode, mapPool } from "../lib/hereGeocode.js";

const BRAND = "road_ranger";
export const ROAD_RANGER_SOURCE = "roadranger_page";
const PRICES_URL = "https://www.roadrangerusa.com/fuel/check-fuel-prices";
/** The network is ~55 stops; materially less means a partial/changed page. */
const MIN_ROWS = 40;
const DIESEL_MEDIAN_BAND = { min: 2.0, max: 9.0 };
const FETCH_TIMEOUT_MS = 30_000;
const GEOCODE_CONCURRENCY = 4;
const USER_AGENT = "FuelGuard/1.0 (fleet fuel planning; posted-price refresh)";
const cacheKey = (stationKey: string) => `rrsite:${stationKey}`;

export interface RoadRangerFetchResult {
  ok: boolean;
  error?: string;
  rows: number;
  stationsUpserted: number;
  pricesInserted: number;
  geocodeFailed: number;
  skipped: number;
}

export async function runRoadRangerFetch(admin: SupabaseClient, env: Env): Promise<RoadRangerFetchResult> {
  const fail = (error: string, rows = 0): RoadRangerFetchResult => ({
    ok: false, error, rows, stationsUpserted: 0, pricesInserted: 0, geocodeFailed: 0, skipped: 0,
  });

  let html: string;
  try {
    const res = await fetch(PRICES_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return fail(`Fetch failed: HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    return fail(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const parsed = parseRoadRangerPrices(html);
  if (!parsed.headerFound) return fail("Parse gate: fuel-price table not found (markup changed?).");
  if (parsed.rows.length < MIN_ROWS) {
    return fail(`Completeness gate: ${parsed.rows.length} rows < required ${MIN_ROWS} — refusing a partial page.`, parsed.rows.length);
  }
  const med = median(parsed.rows.map((r) => r.truckDieselCash!).filter((n) => n != null));
  if (med == null || med < DIESEL_MEDIAN_BAND.min || med > DIESEL_MEDIAN_BAND.max) {
    return fail(`Sanity gate: median cash diesel ${med ?? "n/a"} outside ${DIESEL_MEDIAN_BAND.min}–${DIESEL_MEDIAN_BAND.max} $/gal — refusing (column drift?).`, parsed.rows.length);
  }

  // Resolve coordinates: cache first, then ADDRESS-level geocode for the misses (cache-through, resolved only).
  const coords = new Map<string, { lat: number; lng: number }>();
  const keys = parsed.rows.map((r) => cacheKey(r.stationKey));
  const { data: cached } = await admin.from("geocode_cache").select("query, lat, lng, resolved").in("query", keys);
  for (const c of (cached ?? []) as Array<{ query: string; lat: number | string | null; lng: number | string | null; resolved: boolean }>) {
    if (c.resolved && c.lat != null && c.lng != null) coords.set(c.query.replace("rrsite:", ""), { lat: Number(c.lat), lng: Number(c.lng) });
  }
  const misses = parsed.rows.filter((r) => !coords.has(r.stationKey));
  const geocoded = await mapPool(misses, GEOCODE_CONCURRENCY, async (r) => ({
    key: r.stationKey,
    pos: await hereGeocode(env, `${r.address}, ${r.city}, ${r.state}, USA`),
  }));
  const resolvedRows = geocoded.filter((g) => g.pos).map((g) => ({
    query: cacheKey(g.key), lat: g.pos!.lat, lng: g.pos!.lng, resolved: true, provider: "here", updated_at: new Date().toISOString(),
  }));
  if (resolvedRows.length) await admin.from("geocode_cache").upsert(resolvedRows, { onConflict: "query" });
  for (const g of geocoded) if (g.pos) coords.set(g.key, g.pos);
  const geocodeFailed = parsed.rows.length - coords.size;

  // Upsert stations for placed rows (address-level precision, flagged as such).
  const nowIso = new Date().toISOString();
  const placed = parsed.rows.filter((r) => coords.has(r.stationKey));
  const stationRows = placed.map((r) => {
    const pos = coords.get(r.stationKey)!;
    return {
      brand: BRAND, store_number: r.stationKey, name: `Road Ranger — ${r.city}, ${r.state}`,
      lat: pos.lat, lng: pos.lng, state: r.state, address: r.address, city: r.city, country: "US",
      has_diesel: true, status: "active", source: ROAD_RANGER_SOURCE,
      coord_source: "geocoded_address", location_updated_at: nowIso, updated_at: nowIso,
    };
  });
  const stationIdByKey = new Map<string, string>();
  const { data: upserted, error: upErr } = await admin
    .from("fuel_stations").upsert(stationRows, { onConflict: "brand,store_number" }).select("id, store_number");
  if (upErr) return fail(`Station upsert failed: ${upErr.message}`, parsed.rows.length);
  for (const row of upserted ?? []) if (row.store_number) stationIdByKey.set(String(row.store_number), row.id as string);
  const stationsUpserted = upserted?.length ?? 0;

  // Replace this batch's prices (idempotent per source+observed_at), price_kind=cash.
  const observedAt = parsed.updatedAtIso ?? nowIso;
  const del = await admin.from("fuel_prices_posted").delete().eq("source", ROAD_RANGER_SOURCE).eq("observed_at", observedAt);
  if (del.error) return fail(`Posted-price replace failed: ${del.error.message}`, parsed.rows.length);
  const priceRows = placed
    .filter((r) => stationIdByKey.has(r.stationKey))
    .map((r) => ({
      station_id: stationIdByKey.get(r.stationKey)!, product: "diesel", price: r.truckDieselCash,
      currency: "USD", unit: "gal", price_kind: "cash", source: ROAD_RANGER_SOURCE, observed_at: observedAt,
    }));
  const ins = await admin.from("fuel_prices_posted").insert(priceRows);
  if (ins.error) return fail(`Posted-price insert failed: ${ins.error.message}`, parsed.rows.length);

  return { ok: true, rows: parsed.rows.length, stationsUpserted, pricesInserted: priceRows.length, geocodeFailed, skipped: parsed.skipped };
}
