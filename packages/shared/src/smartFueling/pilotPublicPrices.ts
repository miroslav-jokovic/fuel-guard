/**
 * Parsers for Pilot's PUBLIC posted prices — the network-wide price table on pilotcompany.com/fuel-prices.
 * Two entry points share one row shape:
 *   • parsePilotPublicPricesXlsx — the "Download Fuel Prices" .xlsx (manual upload). Verified against a
 *     REAL 2026-07 file (875 rows): header `Pilot Travel Center | City | State/Province | Diesel |
 *     Pump DEF | Bio Blend | Unleaded | Midgrade | Super | Propane`; "N/A" strings for missing prices;
 *     "Bio Blend" is a LABEL (B0…B20) describing the diesel sold, not a price.
 *   • parsePilotPricesPageHtml — the server-rendered HTML table (automated fetch). Verified against the
 *     page's Svelte SSR markup: rows in `<table id="data-table">`, store number in the
 *     locations.pilotflyingj.com/<store#> link, prices as "$4.599", missing as a "Not available" span.
 *
 * CRITICAL currency fact (verified on the real file): Canadian rows are quoted in CAD PER LITER
 * (e.g. 1.999 in Manitoba); US rows in USD PER GALLON. Rows carry currency+unit so downstream NEVER
 * compares them naively — the resolver plans only with USD/gal and abstains on CAD/L until FX support.
 * These are POSTED retail prices (global facts) — the tenant's negotiated net comes from its own feed.
 */
import type { Cell } from "./pilotPriceReport.js";

export interface PostedPriceRow {
  storeNumber: string;
  city: string | null;
  /** 2-letter state/province code (mapped from the file's full names). */
  state: string | null;
  country: "US" | "CA";
  currency: "USD" | "CAD";
  unit: "gal" | "L";
  product: "diesel" | "def";
  price: number;
  /** Diesel rows only: the bio-blend label of the diesel sold at this site (B0…B20), when stated. */
  bioBlend: string | null;
}

export interface PostedPricesParse {
  headerFound: boolean;
  rows: PostedPriceRow[];
  /** Station rows seen in the source (before product fan-out) — the ingest's completeness signal. */
  stationRows: number;
  /** Near-miss data rows dropped (no store #, no parseable diesel price). */
  skipped: number;
}

const cellStr = (c: Cell): string => (c == null ? "" : String(c)).trim();

/** Full state/province name -> postal code (the .xlsx spells them out; provinces mark CAD/L rows). */
const STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  alberta: "AB", "british columbia": "BC", manitoba: "MB", "new brunswick": "NB",
  "newfoundland and labrador": "NL", "nova scotia": "NS", "northwest territories": "NT",
  nunavut: "NU", ontario: "ON", "prince edward island": "PE", quebec: "QC", saskatchewan: "SK",
  yukon: "YT",
};
const CA_CODES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);

/** Full name or already-a-code -> 2-letter code (null when unrecognized — never guessed). */
export function stateNameToCode(name: string): string | null {
  const s = name.trim();
  if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return STATE_CODES[s.toLowerCase()] ?? null;
}

/** "4.599", "$4.599", 4.599 -> number; "N/A"/"--"/blank -> null. */
function price(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) && c > 0 ? c : null;
  const s = cellStr(c).replace(/[$,\s]/g, "");
  if (!s || /^n\/?a$/i.test(s) || s === "--") return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const BIO_RE = /^B\d{1,2}$/i;
const bioBlend = (c: Cell): string | null => {
  const s = cellStr(c).toUpperCase();
  return BIO_RE.test(s) ? s : null;
};

function rowsFor(
  storeNumber: string,
  city: string | null,
  stateCode: string | null,
  diesel: number | null,
  def: number | null,
  bio: string | null,
): PostedPriceRow[] {
  const country: "US" | "CA" = stateCode && CA_CODES.has(stateCode) ? "CA" : "US";
  const base = {
    storeNumber, city, state: stateCode, country,
    currency: (country === "CA" ? "CAD" : "USD") as "USD" | "CAD",
    unit: (country === "CA" ? "L" : "gal") as "gal" | "L",
  };
  const out: PostedPriceRow[] = [];
  if (diesel != null) out.push({ ...base, product: "diesel", price: diesel, bioBlend: bio });
  if (def != null) out.push({ ...base, product: "def", price: def, bioBlend: null });
  return out;
}

// ── .xlsx download ────────────────────────────────────────────────────────────────────────────────

function isXlsxHeaderRow(row: Cell[]): boolean {
  const labels = row.map((c) => cellStr(c).toLowerCase());
  return labels.includes("state/province") && labels.includes("diesel");
}

export function parsePilotPublicPricesXlsx(grid: Cell[][]): PostedPricesParse {
  const headerIdx = grid.findIndex((r) => Array.isArray(r) && isXlsxHeaderRow(r));
  if (headerIdx === -1) return { headerFound: false, rows: [], stationRows: 0, skipped: 0 };

  const header = grid[headerIdx]!.map((c) => cellStr(c).toLowerCase());
  const col = (label: string) => header.indexOf(label);
  // Column 0 header is the brand line ("Pilot Travel Center") — it holds the store number.
  const iStore = 0;
  const iCity = col("city");
  const iState = col("state/province");
  const iDiesel = col("diesel");
  const iDef = col("pump def");
  const iBio = col("bio blend");

  const rows: PostedPriceRow[] = [];
  let stationRows = 0;
  let skipped = 0;
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row)) continue;
    const store = cellStr(row[iStore]);
    if (!store) continue; // padding
    const diesel = price(row[iDiesel]);
    const def = iDef >= 0 ? price(row[iDef]) : null;
    if (!/^\d+$/.test(store) || (diesel == null && def == null)) {
      skipped++;
      continue;
    }
    stationRows++;
    rows.push(...rowsFor(store, cellStr(row[iCity]) || null, stateNameToCode(cellStr(row[iState])), diesel, def, bioBlend(row[iBio])));
  }
  return { headerFound: true, rows, stationRows, skipped };
}

// ── server-rendered HTML page ─────────────────────────────────────────────────────────────────────

/**
 * Extract the posted-price table from the fuel-prices page HTML. Anchored to structure, not styling
 * hashes: rows are `<tr>` blocks containing a locations.pilotflyingj.com/<store#> link, an address div
 * ("City, ST"), then the price cells in the table's fixed column order (Diesel, DEF, Bio Blend, …).
 * The caller MUST gate on `stationRows` (the server page carries the full network, ~875) so a markup
 * change or a partial/hydrated page can never silently ingest as "complete".
 */
export function parsePilotPricesPageHtml(html: string): PostedPricesParse {
  const tableStart = html.search(/<table[^>]*id="data-table"/i);
  if (tableStart === -1) return { headerFound: false, rows: [], stationRows: 0, skipped: 0 };
  const tableEnd = html.indexOf("</table>", tableStart);
  const table = html.slice(tableStart, tableEnd === -1 ? undefined : tableEnd);

  const rows: PostedPriceRow[] = [];
  let stationRows = 0;
  let skipped = 0;

  const trRe = /<tr[\s\S]*?<\/tr>/gi;
  for (const trMatch of table.match(trRe) ?? []) {
    const store = /locations\.pilotflyingj\.com\/(\d+)"/.exec(trMatch)?.[1];
    if (!store) continue; // header row / non-data row

    // "City, ST" is the last address div in the store cell.
    let city: string | null = null;
    let stateCode: string | null = null;
    const addrs = [...trMatch.matchAll(/<div class="address[^"]*">([^<]+)<\/div>/g)].map((m) => m[1]!.trim());
    const cityState = addrs.map((a) => /^(.+),\s*([A-Za-z]{2})$/.exec(a)).find(Boolean);
    if (cityState) {
      city = cityState[1]!.trim();
      stateCode = cityState[2]!.toUpperCase();
    }

    // Price cells in column order after the store cell: Diesel, DEF, Bio Blend, Unleaded, …
    const cells = [...trMatch.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]!);
    if (cells.length < 4) {
      skipped++;
      continue;
    }
    const cellVal = (c: string): Cell => {
      const dollar = /\$([\d.]+)/.exec(c);
      if (dollar) return dollar[1]!;
      const text = c.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return text.replace(/Not available/i, "").trim() || null;
    };
    const diesel = price(cellVal(cells[1]!));
    const def = price(cellVal(cells[2]!));
    const bio = bioBlend(cellVal(cells[3]!));
    if (diesel == null && def == null) {
      skipped++;
      continue;
    }
    stationRows++;
    rows.push(...rowsFor(store, city, stateCode, diesel, def, bio));
  }

  return { headerFound: true, rows, stationRows, skipped };
}
