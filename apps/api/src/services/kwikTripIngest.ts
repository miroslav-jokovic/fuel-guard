/**
 * Kwik Trip / Kwik Star network sync: fetches the chain's public store list (server-rendered table,
 * exact coordinates) and loads ONLY truck-plannable stations — the official Truck-Friendly list ∩
 * sells-diesel (see kwikTripStoreList.ts for why "Sells Diesel" alone is not truck-accessible).
 *
 * Locations are quarterly-refresh reference data: this runs from an admin button (and is safe to re-run
 * any time — upsert on (brand, store_number)). Gates before any write: parse gate (table found) and a
 * completeness floor on the raw table, so a broken page can never empty the network.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseKwikTripStoreList, composeKwikTripStations } from "@fuelguard/shared";
import type { Env } from "../env.js";

const BRAND = "kwik_trip";
const SOURCE = "kwiktrip_store_list";
const STORE_LIST_URL = "https://www.kwiktrip.com/maps-downloads/store-list";
/** The full table is ~900+ stores; materially less means a partial/changed page. */
const MIN_TABLE_ROWS = 700;
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = "FuelGuard/1.0 (fleet fuel planning; station registry sync)";

export interface KwikTripSyncResult {
  ok: boolean;
  error?: string;
  tableRows: number;
  stationsUpserted: number;
  /** QA signals from the truck-friendly composition (see kwikTripStoreList.ts). */
  truckFriendlyNoDiesel: number;
  truckFriendlyNotInTable: number;
  skipped: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function runKwikTripSync(admin: SupabaseClient, _env: Env): Promise<KwikTripSyncResult> {
  const fail = (error: string, tableRows = 0): KwikTripSyncResult => ({
    ok: false, error, tableRows, stationsUpserted: 0, truckFriendlyNoDiesel: 0, truckFriendlyNotInTable: 0, skipped: 0,
  });

  let html: string;
  try {
    const res = await fetch(STORE_LIST_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return fail(`Fetch failed: HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    return fail(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const parsed = parseKwikTripStoreList(html);
  if (!parsed.headerFound) return fail("Parse gate: store-list table not found (markup changed?).");
  if (parsed.rows.length < MIN_TABLE_ROWS) {
    return fail(`Completeness gate: ${parsed.rows.length} table rows < required ${MIN_TABLE_ROWS} — refusing a partial table.`, parsed.rows.length);
  }

  const composed = composeKwikTripStations(parsed.rows);
  const nowIso = new Date().toISOString();
  const stationRows = composed.stations.map((s) => ({
    brand: BRAND,
    store_number: s.storeNumber,
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    state: s.state,
    address: s.address,
    city: s.city,
    zip: s.zip,
    phone: s.phone,
    country: "US",
    has_diesel: true, // by construction: truck-friendly ∩ sells diesel
    has_def: s.sellsDef,
    status: "active",
    source: SOURCE,
    coord_source: "exact_export",
    location_updated_at: nowIso,
    updated_at: nowIso,
  }));

  let stationsUpserted = 0;
  for (const part of chunk(stationRows, 500)) {
    const { data, error } = await admin.from("fuel_stations").upsert(part, { onConflict: "brand,store_number" }).select("id");
    if (error) return { ...fail(`Station upsert failed: ${error.message}`, parsed.rows.length), stationsUpserted };
    stationsUpserted += data?.length ?? 0;
  }

  return {
    ok: true, tableRows: parsed.rows.length, stationsUpserted,
    truckFriendlyNoDiesel: composed.truckFriendlyNoDiesel,
    truckFriendlyNotInTable: composed.truckFriendlyNotInTable,
    skipped: parsed.skipped,
  };
}
