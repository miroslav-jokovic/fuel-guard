/**
 * Pilot / Flying J fuel-report reconciliation (pure). Parses the vendor "All Transactions" export into
 * normalized diesel fills, then reconciles them against the org's recorded fuel_transactions so the
 * carrier can see, line by line, where the two disagree — the fuel-theft / billing-integrity surface.
 *
 * Pure + dataset-free: the .xls/.xlsx/.csv decode stays at the UI edge (readReportGrid); this takes the
 * decoded cell grid and the system fills, and returns buckets. Verified against a real 2026-06/07 Pilot
 * export (account 139445); the diesel gallon total ties out to the report's own PivotTable grand total.
 */

import { classifyPilotProduct } from "./fuelProducts.js";

export type ReconCell = string | number | boolean | Date | null | undefined;
export type ReconGrid = ReconCell[][];

/** Kept for the parse result; the richer classification lives in `fuelProducts.ts`. */
export type ReportProduct = "diesel" | "def" | "other";

export interface PilotReportFill {
  authNo: string | null; // Authorization_No — the vendor transaction id
  unit: string | null; // UnitNo — maps to a vehicle unit number
  cardRef: string | null; // Card_No
  site: string | null; // Pilot site number
  city: string | null;
  state: string | null;
  gallons: number; // Quantity
  netAmount: number | null; // InvoiceTotal — what the fleet actually paid
  retailAmount: number | null; // RetailTotal — posted total
  tranDate: string | null; // YYYY-MM-DD business date
  time: string | null; // HH:MM as printed (station local)
  product: ReportProduct;
  /** Pilot's own code, zero-padded to three ("020", "033", "140"). The two documents pad differently. */
  productCode: string | null;
  /** Pilot's own words for it. Kept so `classifyPilotProduct` has its fallback, and so an unrecognised
   *  product can be REPORTED rather than silently bucketed. */
  productDescription: string | null;
  rowNumber: number;
}

export interface PilotReportParse {
  headerFound: boolean;
  account: string | null;
  startDate: string | null; // report window (from the metadata rows), YYYY-MM-DD
  endDate: string | null;
  fills: PilotReportFill[]; // TRACTOR diesel — the primary reconciliation unit
  /**
   * Reefer (dyed, off-road) diesel — its own bucket since F4.
   *
   * It used to fall through to `other` and vanish: `isDieselRow` matched the DESCRIPTION against
   * `/truck diesel|diesel(?! exhaust)/i`, and Pilot calls this product "Reefer", a word containing no
   * "diesel". Measured on the real 2026-06/07 export, 120 reefer lines were dropped this way while the
   * statement path reported them — the same fleet answered two ways depending on the file. Billed
   * fuel, and it was invisible.
   */
  reeferLines: PilotReportFill[];
  defLines: PilotReportFill[]; // DEF add-ons (shown, not matched as fills)
  /** Non-fuel lines, plus any product code the catalogue did not recognise. */
  other: PilotReportFill[];
  /** Codes the catalogue could not place, with their line counts — surfaced by the tie-out gate. */
  unknownProducts: Record<string, number>;
  totalDieselGallons: number;
  totalDieselNet: number;
  totalDieselRetail: number;
  skipped: number;
}






// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
const norm = (s: ReconCell): string => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const cstr = (c: ReconCell): string => (c == null ? "" : String(c)).trim();
const cnum = (c: ReconCell): number | null => {
  if (c == null || c === "") return null;
  const n = Number(String(c).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** "747 Springville UT" → { site:"747", city:"Springville", state:"UT" }. */
export function parsePilotSiteDescr(d: ReconCell): { site: string | null; city: string | null; state: string | null } {
  const s = cstr(d);
  if (!s) return { site: null, city: null, state: null };
  const m = s.match(/^\s*(\d{1,5})?\s*(.*?)\s*([A-Z]{2})\s*$/);
  if (!m) return { site: null, city: s || null, state: null };
  return { site: m[1] ?? null, city: (m[2] ?? "").trim() || null, state: m[3] ?? null };
}

function timeHHMM(v: ReconCell): string | null {
  if (v instanceof Date) return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
  const m = cstr(v).match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : null;
}
function dateYMD(v: ReconCell): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = cstr(v);
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  return null;
}


// ── parser ──────────────────────────────────────────────────────────────────────────────────────
export function parsePilotFuelReport(grid: ReconGrid): PilotReportParse {
  const empty: PilotReportParse = {
    headerFound: false, account: null, startDate: null, endDate: null,
    fills: [], reeferLines: [], defLines: [], other: [], unknownProducts: {}, totalDieselGallons: 0, totalDieselNet: 0, totalDieselRetail: 0, skipped: 0,
  };
  if (!Array.isArray(grid) || grid.length === 0) return empty;

  // Metadata rows above the header carry the account + the report window.
  let account: string | null = null;
  let startDate: string | null = null;
  let endDate: string | null = null;

  const headerIdx = grid.findIndex((r) => {
    if (!Array.isArray(r)) return false;
    const set = new Set(r.map(norm));
    return set.has("authorizationno") && set.has("cardno") && set.has("quantity");
  });
  for (let i = 0; i < (headerIdx === -1 ? grid.length : headerIdx); i++) {
    const row = grid[i] ?? [];
    for (let j = 0; j < row.length; j++) {
      const key = norm(row[j]);
      const nextVal = row[j + 1];
      if (key === "standardacctno" && account == null) account = cstr(nextVal) || null;
      if (key === "startdate" && startDate == null) startDate = dateYMD(nextVal);
      if (key === "enddate" && endDate == null) endDate = dateYMD(nextVal);
    }
  }
  if (headerIdx === -1) return { ...empty, account, startDate, endDate };

  const header = grid[headerIdx]!.map(norm);
  const col = (n: string) => header.indexOf(n);
  const c = {
    auth: col("authorizationno"), unit: col("unitno"), card: col("cardno"), site: col("site"),
    siteDescr: col("sitedescr"), qty: col("quantity"), net: col("invoicetotal"), retail: col("retailtotal"),
    date: col("transactiondate"), time: col("transactiontime"), pcode: col("productcode"), pdesc: col("productdescription"),
  };

  const at = (row: ReconCell[], idx: number): ReconCell => (idx >= 0 ? row[idx] : null);
  const fills: PilotReportFill[] = [];
  const reeferLines: PilotReportFill[] = [];
  const defLines: PilotReportFill[] = [];
  const other: PilotReportFill[] = [];
  const unknownProducts: Record<string, number> = {};
  let skipped = 0;

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row)) continue;
    const gallons = cnum(at(row, c.qty));
    if (gallons == null || gallons <= 0) {
      if (cstr(at(row, c.auth)) || cstr(at(row, c.card))) skipped++;
      continue;
    }
    const code = cstr(at(row, c.pcode));
    const desc = cstr(at(row, c.pdesc));
    const klass = classifyPilotProduct(code, desc);
    const sd = parsePilotSiteDescr(at(row, c.siteDescr));
    const fill: PilotReportFill = {
      authNo: cstr(at(row, c.auth)) || null,
      unit: cstr(at(row, c.unit)) || null,
      cardRef: cstr(at(row, c.card)) || null,
      site: sd.site ?? (cstr(at(row, c.site)) || null),
      city: sd.city,
      state: sd.state,
      gallons,
      netAmount: cnum(at(row, c.net)),
      retailAmount: cnum(at(row, c.retail)),
      tranDate: dateYMD(at(row, c.date)),
      time: timeHHMM(at(row, c.time)),
      product: klass.kind,
      productCode: klass.known ? klass.code : (norm(code) || null),
      productDescription: desc || null,
      rowNumber: r + 1,
    };
    // One taxonomy for both documents (`fuelProducts.ts`), keyed on Pilot's code with the description
    // as fallback. The description-only rule this replaces did not recognise "Reefer" at all.
    if (!klass.known) unknownProducts[fill.productCode ?? ""] = (unknownProducts[fill.productCode ?? ""] ?? 0) + 1;
    if (klass.tank === "tractor") fills.push(fill);
    else if (klass.tank === "reefer") reeferLines.push(fill);
    else if (klass.kind === "def") defLines.push(fill);
    else other.push(fill);
  }

  const sum = (arr: PilotReportFill[], k: "gallons" | "netAmount" | "retailAmount") =>
    arr.reduce((s, x) => s + (x[k] ?? 0), 0);

  return {
    headerFound: true, account, startDate, endDate,
    fills, reeferLines, defLines, other, unknownProducts,
    totalDieselGallons: sum(fills, "gallons"),
    totalDieselNet: sum(fills, "netAmount"),
    totalDieselRetail: sum(fills, "retailAmount"),
    skipped,
  };
}
