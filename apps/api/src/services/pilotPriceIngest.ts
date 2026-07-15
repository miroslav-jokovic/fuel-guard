/**
 * Ingests a Pilot "Better Of Pricing Report" (daily diesel price email) for one org. Parse is pure
 * (@fuelguard/shared); here we geocode Pilot sites and load the global station registry + this day's prices.
 *
 * Geocoding: the report carries only city + state, so we place each site by geocoding the CITY (address
 * search, always resolves) then refining with a POI /discover for the nearest Pilot Travel Center. HERE
 * rate-limits bursts (429), so the HERE helpers retry with backoff, we run at modest concurrency, and we cap
 * the run with a time budget. Results are cached per site in geocode_cache (resolved only), so any site left
 * unplaced by the budget or a transient limit is retried — and instantly resolved — on the next upload. Every
 * report site is (re)placed each load, correcting earlier misses/misplacements.
 *
 * Idempotent per (org, source, effective date): re-loading the same file replaces that day's prices, and
 * stations upsert on (brand, store_number) — so re-uploads never create duplicate stations or prices.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePilotPriceReport, type Cell } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { hereGeocode, mapPool } from "../lib/hereGeocode.js";

const BRAND = "pilot";
const SOURCE = "pilot_email";
const GEOCODE_CONCURRENCY = 6;
const GEOCODE_BUDGET_MS = 150_000;

export interface PilotIngestResult {
  ok: boolean;
  error?: string;
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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const cacheKey = (site: string) => `pilotsite:${site}`;
interface SiteRow { site: string; city: string; state: string }

/** Resolve coordinates for every site (cache-through, city + POI-discover), returns site -> {lat,lng}. */
async function geocodeSites(admin: SupabaseClient, env: Env, sites: SiteRow[]): Promise<Map<string, { lat: number; lng: number }>> {
  const coords = new Map<string, { lat: number; lng: number }>();

  // 1) Cache hits (resolved only).
  const keys = sites.map((s) => cacheKey(s.site));
  for (const part of chunk(keys, 200)) {
    const { data } = await admin.from("geocode_cache").select("query, lat, lng, resolved").in("query", part);
    for (const r of (data ?? []) as Array<{ query: string; lat: number | string | null; lng: number | string | null; resolved: boolean }>) {
      if (r.resolved && r.lat != null && r.lng != null) coords.set(r.query.replace("pilotsite:", ""), { lat: Number(r.lat), lng: Number(r.lng) });
    }
  }

  // 2) Geocode the misses within a time budget (deadline). City centroid (reliable) -> POI refine.
  const misses = sites.filter((s) => !coords.has(s.site));
  const deadline = Date.now() + GEOCODE_BUDGET_MS;
  // City-level geocode (one reliable call per site) so a single upload places them all despite HERE rate
  // limits; a Pilot locations export (exact lat/lng) is the precision upgrade when available.
  const geocoded = await mapPool(misses, GEOCODE_CONCURRENCY, async (s) => {
    if (Date.now() > deadline) return { site: s.site, pos: null as { lat: number; lng: number } | null };
    const pos = await hereGeocode(env, `${s.city}, ${s.state}, USA`);
    return { site: s.site, pos };
  });

  // 3) Cache resolved results only (a failed/skipped site keeps no negative row, so it retries next upload).
  const resolvedRows = geocoded.filter((g) => g.pos).map((g) => ({ query: cacheKey(g.site), lat: g.pos!.lat, lng: g.pos!.lng, resolved: true, provider: "here", updated_at: new Date().toISOString() }));
  for (const part of chunk(resolvedRows, 500)) await admin.from("geocode_cache").upsert(part, { onConflict: "query" });
  for (const g of geocoded) if (g.pos) coords.set(g.site, g.pos);

  return coords;
}

export async function ingestPilotPrices(admin: SupabaseClient, env: Env, orgId: string, grid: Cell[][]): Promise<PilotIngestResult> {
  const parsed = parsePilotPriceReport(grid);

  // Duplicate detection: collapse repeated site rows (last wins) and report how many were collapsed.
  const bySite = new Map<string, (typeof parsed.rows)[number]>();
  for (const r of parsed.rows) bySite.set(r.site, r);
  const duplicatesInFile = parsed.rows.length - bySite.size;

  const base = {
    account: parsed.account, effectiveDate: parsed.effectiveDate, totalRows: parsed.rows.length,
    duplicatesInFile, uniqueSites: bySite.size, stationsUpserted: 0, pricesInserted: 0, geocodeFailed: 0, skipped: parsed.skipped,
  };
  if (!parsed.headerFound) return { ok: false, error: "Unrecognized file — expected a Pilot 'Better Of Pricing Report'.", ...base };
  if (parsed.rows.length === 0) return { ok: false, error: "No price rows found in the report.", ...base };

  const observedAt = parsed.effectiveDate ? new Date(`${parsed.effectiveDate}T12:00:00Z`).toISOString() : new Date().toISOString();
  const sites = [...bySite.values()].map((r) => ({ site: r.site, city: r.city, state: r.state }));

  const coords = await geocodeSites(admin, env, sites);
  const geocodeFailed = sites.length - coords.size;

  // Upsert stations for every placed site (updates coords for existing rows too).
  const stationRows = sites.filter((s) => coords.has(s.site)).map((s) => {
    const pos = coords.get(s.site)!;
    return { brand: BRAND, store_number: s.site, name: `Pilot #${s.site}`, lat: pos.lat, lng: pos.lng, state: s.state, has_diesel: true, source: SOURCE, status: "active", updated_at: new Date().toISOString() };
  });
  const stationIdBySite = new Map<string, string>();
  let stationsUpserted = 0;
  for (const part of chunk(stationRows, 500)) {
    const { data, error } = await admin.from("fuel_stations").upsert(part, { onConflict: "brand,store_number" }).select("id, store_number");
    if (error) return { ok: false, error: `Station upsert failed: ${error.message}`, ...base, geocodeFailed };
    for (const row of data ?? []) if (row.store_number) stationIdBySite.set(String(row.store_number), row.id as string);
    stationsUpserted += data?.length ?? 0;
  }

  // Replace this effective-date's Pilot prices (idempotent re-load — no duplicate prices).
  await admin.from("fuel_prices").delete().eq("org_id", orgId).eq("source", SOURCE).eq("observed_at", observedAt);
  const priceRows: Record<string, unknown>[] = [];
  for (const [site, row] of bySite) {
    const stationId = stationIdBySite.get(site);
    if (!stationId) continue; // unplaced -> no station -> no price this load (retried next upload)
    priceRows.push({ org_id: orgId, station_id: stationId, product: row.product, posted_price: row.postedPrice, net_price: row.netPrice, source: SOURCE, observed_at: observedAt });
  }
  let pricesInserted = 0;
  for (const part of chunk(priceRows, 500)) {
    const { error } = await admin.from("fuel_prices").insert(part);
    if (error) return { ok: false, error: `Price insert failed: ${error.message}`, ...base, stationsUpserted, geocodeFailed };
    pricesInserted += part.length;
  }

  return { ok: true, ...base, stationsUpserted, geocodeFailed, pricesInserted };
}
