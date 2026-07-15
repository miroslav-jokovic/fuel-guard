/**
 * Parser for the Pilot "Better Of Pricing Report" — the daily diesel price quote a Pilot fleet account
 * receives by email (verified against a real 2026-07 file, account 262568). Pure: it takes the already-decoded
 * cell grid (rows of cells) so the SheetJS/.xls decode stays at the edge and this stays unit-testable.
 *
 * The report has a few blank/title rows, a header row (Site, City, ST, Prod, …, Retail Price, …, Your Price),
 * then one row per site. "Your Price" is the fleet's NET per-gallon (contract discount already applied);
 * "Retail Price" is the posted price. We key stations by Pilot Site # + city/state (the file carries no
 * coordinates — the ingest geocodes them).
 */

export type Cell = string | number | null | undefined;

export interface PilotPriceRow {
  site: string;
  city: string;
  state: string;
  product: "diesel" | "def";
  postedPrice: number | null;
  netPrice: number | null;
}

export interface PilotPriceReport {
  headerFound: boolean;
  account: string | null;
  /** ISO date (YYYY-MM-DD) the prices are effective for, from "Effective Date: M/D/YYYY". */
  effectiveDate: string | null;
  rows: PilotPriceRow[];
  /** Data rows seen after the header that were dropped (no site / unknown product / no price) — QA signal. */
  skipped: number;
}

const cellStr = (c: Cell): string => (c == null ? "" : String(c)).trim();

/** Parse a currency-ish cell ("$4.4877", "-0.0400", 4.4877) to a number, or null. */
function num(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const s = cellStr(c).replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const PRODUCTS: Record<string, "diesel" | "def"> = { DSL: "diesel", DIESEL: "diesel", DEF: "def" };

function isHeaderRow(row: Cell[]): boolean {
  const labels = row.map((c) => cellStr(c).toLowerCase());
  return labels.includes("site") && labels.includes("prod") && labels.includes("st");
}

/** First M/D/YYYY found → ISO YYYY-MM-DD (local calendar date; no time component). */
function parseEffectiveDate(text: string): string | null {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const mm = String(Number(m[1])).padStart(2, "0");
  const dd = String(Number(m[2])).padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

export function parsePilotPriceReport(grid: Cell[][]): PilotPriceReport {
  const headerIdx = grid.findIndex((r) => Array.isArray(r) && isHeaderRow(r));
  if (headerIdx === -1) {
    return { headerFound: false, account: null, effectiveDate: null, rows: [], skipped: 0 };
  }

  // Column map from the header labels (tolerant to minor spacing).
  const header = grid[headerIdx]!.map((c) => cellStr(c).toLowerCase());
  const col = (label: string) => header.indexOf(label.toLowerCase());
  const iSite = col("site");
  const iCity = col("city");
  const iState = col("st");
  const iProd = col("prod");
  const iRetail = col("retail price");
  const iNet = col("your price");

  // Metadata from the rows above the header.
  let account: string | null = null;
  let effectiveDate: string | null = null;
  for (let r = 0; r < headerIdx; r++) {
    for (const c of grid[r] ?? []) {
      const s = cellStr(c);
      if (!account) {
        const am = s.match(/Account:\s*(\S+)/i);
        if (am) account = am[1]!;
      }
      if (!effectiveDate && /Effective Date:/i.test(s)) effectiveDate = parseEffectiveDate(s);
    }
  }

  const rows: PilotPriceRow[] = [];
  let skipped = 0;
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row)) continue;
    const site = cellStr(row[iSite]);
    const state = cellStr(row[iState]).toUpperCase();
    const product = PRODUCTS[cellStr(row[iProd]).toUpperCase()];
    const netPrice = iNet >= 0 ? num(row[iNet]) : null;
    const postedPrice = iRetail >= 0 ? num(row[iRetail]) : null;
    // A real data row needs a site, a state, a known product, and a usable net price.
    if (!site || !state || !product || netPrice == null) {
      if (site || state || product) skipped++; // count near-miss rows, not blank/footer padding
      continue;
    }
    rows.push({ site, city: cellStr(row[iCity]), state, product, postedPrice, netPrice });
  }

  return { headerFound: true, account, effectiveDate, rows, skipped };
}
