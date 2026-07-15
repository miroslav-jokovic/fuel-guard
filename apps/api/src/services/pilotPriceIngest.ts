/**
 * Ingests a Pilot "Better Of Pricing Report" (daily diesel price email) for one org. The parse is pure
 * (@fuelguard/shared); here we geocode any NEW Pilot sites via HERE, upsert the global station registry,
 * and replace this effective-date's price rows. Read-only w.r.t. Samsara. Idempotent per (org, source,
 * effective date): re-loading the same file replaces that day's prices rather than duplicating them.
 *
 * Cost profile: the first load geocodes every site (~hundreds of HERE calls, bounded concurrency); once a
 * site exists in fuel_stations it is never re-geocoded, so subsequent daily loads only insert prices.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePilotPriceReport, type Cell } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { hereGeocode, mapPool } from "../lib/hereGeocode.js";

const BRAND = "pilot";
const SOURCE = "pilot_email";
const GEOCODE_CONCURRENCY = 12;

export interface PilotIngestResult {
  ok: boolean;
  error?: string;
  account: string | null;
  effectiveDate: string | null;
  totalRows: number;
  stationsCreated: number;
  pricesInserted: number;
  geocodeFailed: number;
  skipped: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function ingestPilotPrices(admin: SupabaseClient, env: Env, orgId: string, grid: Cell[][]): Promise<PilotIngestResult> {
  const parsed = parsePilotPriceReport(grid);
  const base = { account: parsed.account, effectiveDate: parsed.effectiveDate, totalRows: parsed.rows.length, stationsCreated: 0, pricesInserted: 0, geocodeFailed: 0, skipped: parsed.skipped };
  if (!parsed.headerFound) {
    return { ok: false, error: "Unrecognized file — expected a Pilot 'Better Of Pricing Report'.", ...base };
  }
  if (parsed.rows.length === 0) {
    return { ok: false, error: "No price rows found in the report.", ...base };
  }

  // Effective date at noon UTC so the calendar date can't shift under a timezone.
  const observedAt = parsed.effectiveDate ? new Date(`${parsed.effectiveDate}T12:00:00Z`).toISOString() : new Date().toISOString();

  // Last row wins per site (defensive against a site listed twice).
  const bySite = new Map<string, (typeof parsed.rows)[number]>();
  for (const r of parsed.rows) bySite.set(r.site, r);
  const sites = [...bySite.keys()];

  // Which sites already have a station? (global registry, keyed brand+store_number)
  const existing = new Map<string, string>(); // site -> station_id
  for (const part of chunk(sites, 200)) {
    const { data } = await admin.from("fuel_stations").select("id, store_number").eq("brand", BRAND).in("store_number", part);
    for (const row of data ?? []) if (row.store_number) existing.set(String(row.store_number), row.id as string);
  }

  // Geocode + insert the new sites.
  const newSites = sites.filter((s) => !existing.has(s));
  const geocoded = await mapPool(newSites, GEOCODE_CONCURRENCY, async (site) => {
    const row = bySite.get(site)!;
    const pos = await hereGeocode(env, `Pilot Travel Center, ${row.city}, ${row.state}, USA`);
    return { site, row, pos };
  });

  let geocodeFailed = 0;
  const toInsert: Record<string, unknown>[] = [];
  for (const g of geocoded) {
    if (!g.pos) {
      geocodeFailed++;
      continue;
    }
    toInsert.push({
      brand: BRAND,
      store_number: g.site,
      name: `Pilot #${g.site}`,
      lat: g.pos.lat,
      lng: g.pos.lng,
      state: g.row.state,
      has_diesel: true,
      source: SOURCE,
      status: "active",
    });
  }
  let stationsCreated = 0;
  for (const part of chunk(toInsert, 500)) {
    const { data, error } = await admin.from("fuel_stations").upsert(part, { onConflict: "brand,store_number" }).select("id, store_number");
    if (error) return { ok: false, error: `Station upsert failed: ${error.message}`, ...base, geocodeFailed };
    for (const row of data ?? []) if (row.store_number) existing.set(String(row.store_number), row.id as string);
    stationsCreated += data?.length ?? 0;
  }

  // Replace this effective-date's Pilot prices for the org (idempotent re-load).
  await admin.from("fuel_prices").delete().eq("org_id", orgId).eq("source", SOURCE).eq("observed_at", observedAt);

  const priceRows: Record<string, unknown>[] = [];
  for (const [site, row] of bySite) {
    const stationId = existing.get(site);
    if (!stationId) continue; // geocode failed -> no station -> skip its price this load
    priceRows.push({
      org_id: orgId,
      station_id: stationId,
      product: row.product,
      posted_price: row.postedPrice,
      net_price: row.netPrice,
      source: SOURCE,
      observed_at: observedAt,
    });
  }
  let pricesInserted = 0;
  for (const part of chunk(priceRows, 500)) {
    const { error } = await admin.from("fuel_prices").insert(part);
    if (error) return { ok: false, error: `Price insert failed: ${error.message}`, ...base, stationsCreated, geocodeFailed };
    pricesInserted += part.length;
  }

  return { ok: true, ...base, stationsCreated, geocodeFailed, pricesInserted };
}
