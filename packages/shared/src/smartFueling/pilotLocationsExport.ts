/**
 * Parser for the Pilot "Download All Locations" CSV export (locations.pilotflyingj.com) — the exact-
 * coordinate station registry for the whole Pilot family. Verified against a REAL 2026-07 export
 * (877 rows): header `"Store #","Name","Address","City","State","Zip Code","Interstate","Latitude",
 * "Longitude","Phone Number","Parking Spaces Count","Fuel Lane Count","Shower Count","Amenities",
 * "Restaurants"`. Amenities are pipe-separated ("Diesel Lanes | Showers | … | DEF Lanes | …").
 * States include Canadian provinces (AB/BC/MB/ON/SK on the sample). Pure: takes a decoded cell grid
 * (same convention as pilotPriceReport) so CSV/XLSX decoding stays at the edge.
 */
import { brandFromLocationName } from "./brands.js";
import type { Cell } from "./pilotPriceReport.js";

/** Canadian province/territory codes — drives `country` (station registry stores US|CA). */
const CA_PROVINCES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);

export interface PilotLocationRow {
  storeNumber: string;
  brand: string;
  /** false = the location name matched no known family brand (ingest must surface it). */
  brandKnown: boolean;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: "US" | "CA";
  /** The export's "Interstate" column ("I-70, Exit 96") — maps onto fuel_stations.exit. */
  exit: string | null;
  lat: number;
  lng: number;
  phone: string | null;
  parkingSpaces: number | null;
  fuelLaneCount: number | null;
  showerCount: number | null;
  amenities: string[];
  restaurants: string[];
  /** Derived from amenities: truck diesel lanes present (the planner's has_diesel signal). */
  hasDiesel: boolean;
  hasDef: boolean;
}

export interface PilotLocationsExport {
  headerFound: boolean;
  rows: PilotLocationRow[];
  /** Data rows dropped for a concrete defect (missing store #, unparseable/out-of-range coords). */
  skipped: number;
  /** Distinct location names that matched no known brand (for the ingest report). */
  unknownBrandNames: string[];
}

const cellStr = (c: Cell): string => (c == null ? "" : String(c)).trim();

const intOrNull = (c: Cell): number | null => {
  const s = cellStr(c);
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/** North-America sanity bounds — a coordinate outside them is a data defect, not a station. */
const latOk = (n: number) => Number.isFinite(n) && n > 17 && n < 72;
const lngOk = (n: number) => Number.isFinite(n) && n > -170 && n < -50;

const splitList = (c: Cell): string[] =>
  cellStr(c)
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

function isHeaderRow(row: Cell[]): boolean {
  const labels = row.map((c) => cellStr(c).toLowerCase());
  return labels.includes("store #") && labels.includes("latitude") && labels.includes("longitude");
}

export function parsePilotLocationsExport(grid: Cell[][]): PilotLocationsExport {
  const headerIdx = grid.findIndex((r) => Array.isArray(r) && isHeaderRow(r));
  if (headerIdx === -1) return { headerFound: false, rows: [], skipped: 0, unknownBrandNames: [] };

  const header = grid[headerIdx]!.map((c) => cellStr(c).toLowerCase());
  const col = (label: string) => header.indexOf(label.toLowerCase());
  const iStore = col("store #");
  const iName = col("name");
  const iAddress = col("address");
  const iCity = col("city");
  const iState = col("state");
  const iZip = col("zip code");
  const iInterstate = col("interstate");
  const iLat = col("latitude");
  const iLng = col("longitude");
  const iPhone = col("phone number");
  const iParking = col("parking spaces count");
  const iLanes = col("fuel lane count");
  const iShowers = col("shower count");
  const iAmenities = col("amenities");
  const iRestaurants = col("restaurants");

  const rows: PilotLocationRow[] = [];
  const unknownBrands = new Set<string>();
  let skipped = 0;

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row)) continue;
    const storeNumber = cellStr(row[iStore]);
    const name = cellStr(row[iName]);
    if (!storeNumber && !name) continue; // blank/padding row — not a defect

    const lat = Number(cellStr(row[iLat]));
    const lng = Number(cellStr(row[iLng]));
    if (!storeNumber || !latOk(lat) || !lngOk(lng)) {
      skipped++;
      continue;
    }

    const { brand, known } = brandFromLocationName(name);
    if (!known) unknownBrands.add(name);

    const state = cellStr(row[iState]).toUpperCase() || null;
    const amenities = splitList(row[iAmenities]);
    const amenSet = new Set(amenities.map((a) => a.toLowerCase()));

    rows.push({
      storeNumber,
      brand,
      brandKnown: known,
      name,
      address: cellStr(row[iAddress]) || null,
      city: cellStr(row[iCity]) || null,
      state,
      zip: cellStr(row[iZip]) || null,
      country: state && CA_PROVINCES.has(state) ? "CA" : "US",
      exit: cellStr(row[iInterstate]) || null,
      lat,
      lng,
      phone: cellStr(row[iPhone]) || null,
      parkingSpaces: intOrNull(row[iParking]),
      fuelLaneCount: intOrNull(row[iLanes]),
      showerCount: intOrNull(row[iShowers]),
      amenities,
      restaurants: splitList(row[iRestaurants]),
      hasDiesel: amenSet.has("diesel lanes"),
      hasDef: amenSet.has("def lanes"),
    });
  }

  return { headerFound: true, rows, skipped, unknownBrandNames: [...unknownBrands].sort() };
}
