/**
 * Parser for Love's "Search Results" Excel export (LovesSearchResults.xlsx) — a single file carrying the
 * whole network's exact locations (lat/lng, store #, address, highway/exit) AND current posted diesel/DEF
 * prices, plus a "prices accurate as of ..." stamp. Pure; the caller (lovesIngest) upserts stations + prices.
 *
 * Layout (verified on the real 2026-07 export, 616 stores): a metadata row, a category row, then the real
 * header row (StoreNumber, State, City, Address, HighwayOrExit, Zip, Latitude, Longitude, DEFLanes,
 * ParkingSpaces, StoreType, Phone, ..., Diesel, ..., BulkDEF, ...). Rows without a store # or finite
 * coordinates are skipped and counted. Love's is its OWN store-number space (never the Pilot family).
 */
import type { Cell } from "./pilotPriceReport.js";

export interface LovesLocationRow {
  storeNumber: string;
  name: string;
  lat: number;
  lng: number;
  state: string | null;
  city: string | null;
  address: string | null;
  zip: string | null;
  exit: string | null;
  parkingSpaces: number | null;
  hasDiesel: boolean;
  hasDef: boolean;
  dieselPrice: number | null; // USD/gal
  defPrice: number | null; // USD/gal
}

export interface LovesExport {
  headerFound: boolean;
  /** ISO of the "prices accurate as of ..." stamp, or null when absent (caller falls back to now). */
  priceObservedAt: string | null;
  rows: LovesLocationRow[];
  skipped: number;
}

const cellStr = (c: Cell): string => (c == null ? "" : String(c).trim());
function num(c: Cell): number | null {
  if (c == null || c === "") return null;
  const n = typeof c === "number" ? c : Number(String(c).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};
// US time-zone abbreviations -> UTC offset (hours). The export stamps prices in Central time.
const TZ_OFFSET: Record<string, number> = {
  EDT: -4, EST: -5, CDT: -5, CST: -6, MDT: -6, MST: -7, PDT: -7, PST: -8, AKDT: -8, AKST: -9, HDT: -9, HST: -10,
};

/** "01:39 PM CDT July 17, 2026" -> ISO (UTC), or null when unparseable. */
export function parseLovesPriceTimestamp(s: string): string | null {
  const m = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s+([A-Z]{2,4})\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ap = m[3]!.toUpperCase();
  const tz = m[4]!.toUpperCase();
  const month = MONTHS[m[5]!.toLowerCase()];
  const dd = Number(m[6]);
  const yyyy = Number(m[7]);
  const off = TZ_OFFSET[tz];
  if (month == null || off == null) return null;
  let hour = hh % 12;
  if (ap === "PM") hour += 12;
  return new Date(Date.UTC(yyyy, month, dd, hour - off, mm)).toISOString();
}

function findHeader(grid: Cell[][]): { idx: number; col: Record<string, number> } | null {
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const labels = (grid[i] ?? []).map((c) => cellStr(c));
    if (labels.includes("StoreNumber") && labels.includes("Latitude") && labels.includes("Longitude")) {
      const col: Record<string, number> = {};
      labels.forEach((l, idx) => { if (l && !(l in col)) col[l] = idx; });
      return { idx: i, col };
    }
  }
  return null;
}

export function parseLovesExport(grid: Cell[][]): LovesExport {
  const header = findHeader(grid);
  if (!header) return { headerFound: false, priceObservedAt: null, rows: [], skipped: 0 };
  const { idx, col } = header;

  // The "prices accurate as of ..." stamp lives in a metadata row above the header.
  let priceObservedAt: string | null = null;
  for (let i = 0; i <= idx && !priceObservedAt; i++) {
    for (const c of grid[i] ?? []) {
      if (typeof c === "string" && /accurate as of/i.test(c)) {
        const m = c.match(/accurate as of\s+(.+?)\./i);
        if (m) { priceObservedAt = parseLovesPriceTimestamp(m[1]!); break; }
      }
    }
  }

  const at = (row: Cell[], name: string): Cell => {
    const i = col[name];
    return i != null ? (row[i] ?? null) : null;
  };
  const rows: LovesLocationRow[] = [];
  let skipped = 0;
  for (let r = idx + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const store = cellStr(at(row, "StoreNumber"));
    if (!store) continue; // trailing blank row
    const lat = num(at(row, "Latitude"));
    const lng = num(at(row, "Longitude"));
    if (lat == null || lng == null) { skipped++; continue; }
    const dieselPrice = num(at(row, "Diesel"));
    const defPrice = num(at(row, "BulkDEF"));
    const defLanes = num(at(row, "DEFLanes"));
    rows.push({
      storeNumber: store,
      name: `Love's #${store}`,
      lat,
      lng,
      state: cellStr(at(row, "State")).toUpperCase() || null,
      city: cellStr(at(row, "City")) || null,
      address: cellStr(at(row, "Address")) || null,
      zip: cellStr(at(row, "Zip")) || null,
      exit: cellStr(at(row, "HighwayOrExit")) || null,
      parkingSpaces: num(at(row, "ParkingSpaces")),
      hasDiesel: dieselPrice != null,
      hasDef: defPrice != null || (defLanes != null && defLanes > 0),
      dieselPrice,
      defPrice,
    });
  }
  return { headerFound: true, priceObservedAt, rows, skipped };
}
