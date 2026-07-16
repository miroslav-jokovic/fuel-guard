/**
 * Parser for Road Ranger's public fuel-price page (roadrangerusa.com/fuel/check-fuel-prices) — a
 * server-rendered Drupal table, verified against the REAL 2026-07 page (56 rows): columns
 * `Location | Unleaded | E85 | Car Diesel (Cash) | Truck Diesel (Cash)`, each location as
 * `<div class="address">…</div><div class="city-state">City, ST</div>` inside the row's <th>, plus a
 * "Data last updated: M/D/YYYY H:MM:SS AM/PM CDT" stamp ("updated at least daily" per the page).
 *
 * IMPORTANT price semantics: Road Ranger publishes CASH prices — rows must be stored with
 * price_kind='cash', never blended silently with card/posted quotes. The page carries no store numbers
 * or coordinates: stations are keyed by a deterministic slug of (address, city, state) and geocoded at
 * the ADDRESS level by the ingest (coord_source='geocoded_address').
 */

export interface RoadRangerRow {
  /** Deterministic station key (the brand's store_number surrogate): slug of address+city+state. */
  stationKey: string;
  address: string;
  city: string;
  state: string;
  /** Truck-lane diesel, cash price, USD/gal. */
  truckDieselCash: number | null;
}

export interface RoadRangerParse {
  headerFound: boolean;
  rows: RoadRangerRow[];
  /** ISO timestamp parsed from "Data last updated" (null when the stamp is missing/unparseable). */
  updatedAtIso: string | null;
  /** Near-miss rows dropped (no address/state or no parseable truck-diesel price). */
  skipped: number;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** "$4.999" -> 4.999; "N/A"/blank -> null. */
function price(s: string): number | null {
  const m = /\$\s*([\d.]+)/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Deterministic, punctuation-insensitive station key (stable across cosmetic address edits is NOT
 *  guaranteed — a changed address string is a new key; the ingest reports orphaned keys). */
export function roadRangerStationKey(address: string, city: string, state: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${norm(address)}_${norm(city)}-${norm(state)}`.slice(0, 80);
}

/** "7/16/2026 1:30:40 PM CDT" -> ISO (CDT/CST handled explicitly; the page stamps US Central time). */
export function parseCentralTimestamp(text: string): string | null {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)\s*(CDT|CST)?/i.exec(text);
  if (!m) return null;
  let hour = Number(m[4]) % 12;
  if (/pm/i.test(m[7]!)) hour += 12;
  const offset = (m[8] ?? "CDT").toUpperCase() === "CST" ? 6 : 5; // hours behind UTC
  const utc = Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour + offset, Number(m[5]), Number(m[6]));
  return Number.isFinite(utc) ? new Date(utc).toISOString() : null;
}

export function parseRoadRangerPrices(html: string): RoadRangerParse {
  const tableStart = html.search(/<table[^>]*rr-fuel-prices/i);
  if (tableStart === -1 || !/Truck Diesel/i.test(html)) {
    return { headerFound: false, rows: [], updatedAtIso: null, skipped: 0 };
  }
  const tableEnd = html.indexOf("</table>", tableStart);
  const table = html.slice(tableStart, tableEnd === -1 ? undefined : tableEnd);

  const updatedMatch = /last updated:\s*([^<]+)/i.exec(html);
  const updatedAtIso = updatedMatch ? parseCentralTimestamp(updatedMatch[1]!) : null;

  const rows: RoadRangerRow[] = [];
  let skipped = 0;
  for (const tr of table.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
    const address = strip(/<div class="address">([\s\S]*?)<\/div>/.exec(tr)?.[1] ?? "");
    const cityState = strip(/<div class="city-state">([\s\S]*?)<\/div>/.exec(tr)?.[1] ?? "");
    if (!address || !cityState) continue; // header row
    const cs = /^(.+),\s*([A-Za-z]{2})$/.exec(cityState);
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]!));
    // Column order: Unleaded, E85, Car Diesel (Cash), Truck Diesel (Cash).
    const truckDiesel = cells.length >= 4 ? price(cells[3]!) : null;
    if (!cs || truckDiesel == null) {
      skipped++;
      continue;
    }
    const city = cs[1]!.trim();
    const state = cs[2]!.toUpperCase();
    rows.push({ stationKey: roadRangerStationKey(address, city, state), address, city, state, truckDieselCash: truckDiesel });
  }
  return { headerFound: true, rows, updatedAtIso, skipped };
}
