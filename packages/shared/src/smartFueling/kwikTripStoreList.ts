/**
 * Parser for the Kwik Trip / Kwik Star public store list (kwiktrip.com/maps-downloads/store-list) —
 * a server-rendered TablePress table, verified against the REAL 2026-07 page (936 rows): columns
 * `Store Number | Store Name | Address | City | State | Zip | Phone | Latitude | Longitude | Car Wash |
 * Sells Gas | Sells Diesel | Sells CNG | Sells LNG | Sells DEF | Sells E85`, exact coordinates on every row.
 *
 * TRUCK SAFETY FILTER: "Sells Diesel" means the AUTO island — most Kwik Trip c-stores cannot take a
 * Class-8. `composeKwikTripStations` therefore admits ONLY stores on the chain's official Truck-Friendly
 * list (kwikTripTruckFriendly.ts) that also sell diesel; everything else never enters the registry.
 * Robots.txt is permissive for this page; the table is quarterly-refresh data, not a price feed.
 */
import { KWIK_TRIP_TRUCK_FRIENDLY_STORES } from "./kwikTripTruckFriendly.js";

export interface KwikTripStoreRow {
  storeNumber: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  sellsDiesel: boolean;
  sellsDef: boolean;
}

export interface KwikTripStoreListParse {
  headerFound: boolean;
  rows: KwikTripStoreRow[];
  /** Data rows dropped for concrete defects (missing store #, bad coords). */
  skipped: number;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const yes = (s: string | undefined) => (s ?? "").trim().toLowerCase() === "yes";
const latOk = (n: number) => Number.isFinite(n) && n > 17 && n < 72;
const lngOk = (n: number) => Number.isFinite(n) && n > -170 && n < -50;

export function parseKwikTripStoreList(html: string): KwikTripStoreListParse {
  // Anchor on the header labels, not the TablePress id (an id can change; the labels are the contract).
  const headIdx = html.search(/<th[^>]*>\s*Store Number\s*<\/th>/i);
  if (headIdx === -1 || !/<th[^>]*>\s*Latitude\s*<\/th>/i.test(html)) {
    return { headerFound: false, rows: [], skipped: 0 };
  }

  const rows: KwikTripStoreRow[] = [];
  let skipped = 0;
  for (const tr of html.slice(headIdx).match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]!));
    if (cells.length < 16) continue; // header/blank rows
    const [storeNumber, name, address, city, state, zip, phone, latS, lngS, , , diesel, , , def] = cells;
    const lat = Number(latS);
    const lng = Number(lngS);
    if (!storeNumber || !/^\d+$/.test(storeNumber) || !latOk(lat) || !lngOk(lng)) {
      skipped++;
      continue;
    }
    rows.push({
      storeNumber, name: name || `Kwik Trip #${storeNumber}`,
      address: address || null, city: city || null, state: (state || "").toUpperCase() || null,
      zip: zip || null, phone: phone || null, lat, lng,
      sellsDiesel: yes(diesel), sellsDef: yes(def),
    });
  }
  return { headerFound: true, rows, skipped };
}

export interface KwikTripStationsResult {
  /** Truck-plannable stations only: official Truck-Friendly list ∩ sells diesel. */
  stations: KwikTripStoreRow[];
  /** Table stores on the Truck-Friendly list that do NOT sell diesel (should be ~0 — QA signal). */
  truckFriendlyNoDiesel: number;
  /** Truck-Friendly store numbers absent from the live table (new/renumbered stores — QA signal). */
  truckFriendlyNotInTable: number;
}

export function composeKwikTripStations(rows: KwikTripStoreRow[]): KwikTripStationsResult {
  const byNumber = new Map(rows.map((r) => [r.storeNumber, r]));
  const stations: KwikTripStoreRow[] = [];
  let noDiesel = 0;
  let notInTable = 0;
  for (const sn of KWIK_TRIP_TRUCK_FRIENDLY_STORES) {
    const row = byNumber.get(sn);
    if (!row) {
      notInTable++;
      continue;
    }
    if (!row.sellsDiesel) {
      noDiesel++;
      continue;
    }
    stations.push(row);
  }
  return { stations, truckFriendlyNoDiesel: noDiesel, truckFriendlyNotInTable: notInTable };
}
