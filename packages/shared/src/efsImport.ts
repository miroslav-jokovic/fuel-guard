import type { FuelType } from "./constants.js";
import type { Vehicle, Driver } from "./fleet.js";

/**
 * EFS report parsing — pure, format-agnostic. Input is an array of row objects (header → cell value)
 * already extracted from XLSX/CSV by the app. Confirmed against real Silvicom exports (docs/08 §0).
 */

export type ReportKind = "transaction" | "reject" | "unknown";

/** Product (Item) codes that count as propulsion fuel → become fuel transactions. */
export const FUEL_PRODUCT_CODES: Record<string, FuelType> = {
  ULSD: "diesel", // ultra-low-sulfur diesel
  ULSR: "diesel", // reefer/off-road diesel
  DSL: "diesel",
  BIO: "diesel",
  UNL: "gasoline",
  UNLD: "gasoline",
  RUL: "gasoline", // regular unleaded
  MUL: "gasoline", // mid unleaded
  PUL: "gasoline", // premium unleaded
};

export type RawRow = Record<string, string | number | null | undefined>;

export interface ParsedFuelLine {
  external_ref: string;
  unit: string | null;
  driver_name: string | null;
  card_ref: string | null;
  fueled_at: string; // ISO instant
  odometer: number | null;
  gallons: number;
  price_per_gal: number | null;
  total_cost: number | null;
  fuel_type: FuelType;
  item: string;
  location_text: string | null;
  city: string | null;
  state: string | null;
}

export interface SkippedRow {
  row_number: number;
  reason: string;
  item?: string;
}

export interface ParsedDeclined {
  external_ref: string;
  declined_at: string;
  card_ref: string | null;
  invoice: string | null;
  location_id: string | null;
  unit: string | null;
  driver_ext_id: string | null;
  driver_name: string | null;
  location_text: string | null;
  city: string | null;
  state: string | null;
  error_code: string | null;
  error_description: string | null;
  policy: string | null;
  policy_name: string | null;
}

// ── helpers ───────────────────────────────────────────────────────────────────
const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** EFS Tran Date is date-only (no time) — anchor at org-local noon to avoid tz day-flips (docs/08 §4). */
export function efsDateToIso(date: string | null | undefined): string | null {
  const s = str(date);
  if (!s) return null;
  const datePart = s.slice(0, 10); // handles "2026-06-29" and "2026-06-29 07:37:00"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return `${datePart}T12:00:00.000Z`;
}

/** Reject Report has a real timestamp ("YYYY-MM-DD HH:mm:ss"); treat naive time as UTC (deterministic). */
function rejectDateToIso(date: string | null | undefined): string | null {
  const s = str(date);
  if (!s) return null;
  const iso = s.replace(" ", "T");
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? efsDateToIso(s) : d.toISOString();
}

/**
 * Combine a date + optional time into an ISO instant. Handles "YYYY-MM-DD" and US "M/D/YYYY", and
 * times "HH:MM[:SS]" / "H:MM[:SS] AM|PM" / "HHMMSS". A naive time is treated as UTC (deterministic;
 * time-zone-aware Samsara matching is applied downstream). Date-only → anchored at noon.
 */
export function efsDateTimeToIso(date: string | null | undefined, time?: string | null): string | null {
  const d = str(date);
  if (!d) return null;
  let ymd: string | null = null;
  const iso = d.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) ymd = iso;
  else {
    const m = d.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/); // US M/D/Y
    if (m) {
      const mo = m[1]!.padStart(2, "0");
      const da = m[2]!.padStart(2, "0");
      const yr = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
      ymd = `${yr}-${mo}-${da}`;
    }
  }
  if (!ymd) {
    const parsed = new Date(d);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  // Explicit time column wins; else look for a time embedded in the date string ("… 14:25:00").
  const embedded = d.match(/\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?/);
  const hms = parseEfsTime(time) ?? (embedded ? parseEfsTime(embedded[0]) : null);
  return hms ? `${ymd}T${hms}.000Z` : `${ymd}T12:00:00.000Z`;
}

/** Parse an EFS POS time into "HH:MM:SS" (24h). Finds a time inside longer strings (e.g. a full
 *  timestamp in a "Time" column). Null when absent/unparseable. */
function parseEfsTime(time: string | null | undefined): string | null {
  const t = str(time);
  if (!t) return null;
  const m = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (m) {
    let h = parseInt(m[1]!, 10);
    const ap = m[4]?.toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
  }
  if (/^\d{4,6}$/.test(t)) return `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6) || "00"}`; // "1425"/"142500"
  return null;
}

/** Fuel type from a product code or description; excludes DEF/AdBlue (not propulsion fuel). */
export function fuelTypeFromText(s: string | null | undefined): FuelType | null {
  const t = (s ?? "").toLowerCase();
  if (!t) return null;
  if (/exhaust|adblue|\bdef\b|\bdefd\b|\bscle\b|scale/.test(t)) return null;
  if (/diesel|ulsd|ulsr|\bdsl\b|biodiesel|\bbio\b|reefer/.test(t)) return "diesel";
  if (/unleaded|gasoline|petrol|\bunl\b|\bunld\b|\brul\b|\bmul\b|\bpul\b|\bgas\b/.test(t)) return "gasoline";
  return null;
}

/** Detect the report type from its header set (space/punctuation/case-insensitive). */
export function detectReportKind(headers: string[]): ReportKind {
  const h = new Set(headers.map(normKey));
  const has = (...ks: string[]) => ks.some((k) => h.has(normKey(k)));
  if (has("Error Code", "Error Description", "Reject Reason", "Decline Reason")) return "reject";
  if (has("Item", "ProductCode", "Product Description") && has("Qty", "Quantity")) return "transaction";
  return "unknown";
}

/** Normalize a header for matching — drop case, spaces and punctuation ("Driver Name" ≈ "DriverName"). */
const normKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Pick a cell by any of several header aliases, matching space/punctuation/case-insensitively. */
const pick = (row: RawRow, ...keys: string[]): unknown => {
  for (const k of keys) {
    const nk = normKey(k);
    const found = Object.keys(row).find((rk) => normKey(rk) === nk);
    if (found && row[found] != null && row[found] !== "") return row[found];
  }
  return null;
};

export function buildFuelExternalRef(card: string | null, invoice: string | null, item: string | null): string {
  return [card ?? "", invoice ?? "", item ?? ""].join("|");
}

/**
 * Normalize Transaction Report rows. Keeps only fuel lines (docs/08 §4); multiple fuel lines on the
 * same invoice are MERGED into one fueling event (sum gallons/cost — docs/09 P0.4). Rows with an
 * unparseable date are quarantined to `skipped` rather than fabricating a timestamp (docs/09 P1.7).
 */
export function normalizeTransactionRows(rows: RawRow[]): {
  fuelLines: ParsedFuelLine[];
  skipped: SkippedRow[];
} {
  const skipped: SkippedRow[] = [];
  const byInvoice = new Map<string, ParsedFuelLine>();

  rows.forEach((row, i) => {
    const rowNumber = i + 1;
    const item = (str(pick(row, "Item", "ProductCode")) ?? "").toUpperCase();
    const desc = str(pick(row, "Product Description", "ProductDescription"));
    // Fuel type from the product code, else the description (handles numeric/unknown product codes).
    const fuelType = FUEL_PRODUCT_CODES[item] ?? fuelTypeFromText(item) ?? fuelTypeFromText(desc);
    if (!fuelType) {
      skipped.push({ row_number: rowNumber, reason: "non-fuel item", item: item || undefined });
      return;
    }
    const gallons = num(pick(row, "Qty", "Quantity"));
    if (gallons == null || gallons <= 0) {
      skipped.push({ row_number: rowNumber, reason: "no gallons", item });
      return;
    }
    const fueledAt = efsDateTimeToIso(
      str(pick(row, "Tran Date", "Date", "TransactionPOSDate")),
      str(pick(row, "TransactionPOSTime", "POS Time", "Time")),
    );
    if (!fueledAt) {
      skipped.push({ row_number: rowNumber, reason: "unparseable date", item });
      return;
    }
    const card = str(pick(row, "Card #", "Card Number"));
    const invoice = str(pick(row, "Invoice"));
    const total = num(pick(row, "Amt", "Amount"));
    const key = `${card ?? ""}|${invoice ?? ""}`; // one invoice = one fueling event

    const existing = byInvoice.get(key);
    if (existing) {
      existing.gallons += gallons;
      existing.total_cost = (existing.total_cost ?? 0) + (total ?? 0);
    } else {
      byInvoice.set(key, {
        external_ref: key,
        unit: str(pick(row, "Unit")),
        driver_name: str(pick(row, "Driver Name")),
        card_ref: card,
        fueled_at: fueledAt,
        odometer: num(pick(row, "Odometer")),
        gallons,
        price_per_gal: num(pick(row, "Unit Price", "PricePerUnit")),
        total_cost: total,
        fuel_type: fuelType,
        item,
        location_text: str(pick(row, "Location Name")),
        city: str(pick(row, "City", "Location City")),
        state: str(pick(row, "State/ Prov", "State/Prov", "State", "Location State")),
      });
    }
  });

  // Re-derive price from the merged total (audit L3: total + gallons are authoritative).
  const fuelLines = [...byInvoice.values()].map((line) => ({
    ...line,
    price_per_gal:
      line.total_cost != null && line.gallons > 0
        ? Math.round((line.total_cost / line.gallons) * 1000) / 1000
        : line.price_per_gal,
  }));

  return { fuelLines, skipped };
}

/** A faithful EFS Transaction Report line — every column, verbatim, no merge/filter (docs/10). */
export interface EfsTransactionLine {
  external_ref: string;
  line_number: number;
  card_num: string | null;
  tran_date: string | null; // YYYY-MM-DD
  fueled_at: string | null; // ISO (date anchored noon)
  invoice: string | null;
  unit: string | null;
  driver_name: string | null;
  odometer: number | null;
  location_name: string | null;
  city: string | null;
  state: string | null;
  fees: number | null;
  item: string | null;
  unit_price: number | null;
  qty: number | null;
  amt: number | null;
  db: string | null;
  currency: string | null;
}

/**
 * Faithful parse of EVERY Transaction Report line (all 16 columns, including DEF/scales/fees) —
 * the system of record for the preview tables and 1-year history. NOT transformed. The merged
 * fuel-only events for scoring come from `normalizeTransactionRows`.
 */
export function normalizeAllTransactionLines(rows: RawRow[]): EfsTransactionLine[] {
  return rows.map((row, i) => {
    const card = str(pick(row, "Card #", "Card Number"));
    const invoice = str(pick(row, "Invoice"));
    const item = str(pick(row, "Item", "ProductCode"));
    const qty = num(pick(row, "Qty", "Quantity"));
    const amt = num(pick(row, "Amt", "Amount"));
    const fueledAt = efsDateTimeToIso(
      str(pick(row, "Tran Date", "Date", "TransactionPOSDate")),
      str(pick(row, "TransactionPOSTime", "POS Time", "Time")),
    );
    return {
      external_ref: [card ?? "", invoice ?? "", item ?? "", qty ?? "", amt ?? ""].join("|"),
      line_number: i + 1,
      card_num: card,
      tran_date: fueledAt ? fueledAt.slice(0, 10) : null,
      fueled_at: fueledAt,
      invoice,
      unit: str(pick(row, "Unit")),
      driver_name: str(pick(row, "Driver Name")),
      odometer: num(pick(row, "Odometer")),
      location_name: str(pick(row, "Location Name")),
      city: str(pick(row, "City", "Location City")),
      state: str(pick(row, "State/ Prov", "State/Prov", "State", "Location State")),
      fees: num(pick(row, "Fees", "Transaction Fee")),
      item,
      unit_price: num(pick(row, "Unit Price", "PricePerUnit")),
      qty,
      amt,
      db: str(pick(row, "DB")),
      currency: str(pick(row, "Currency", "Transaction Currency")),
    };
  });
}

/** A persisted faithful EFS transaction row (as the preview table reads it). */
export interface EfsTransactionRow {
  id: string;
  line_number: number | null;
  card_num: string | null;
  tran_date: string | null;
  fueled_at: string | null;
  invoice: string | null;
  unit: string | null;
  driver_name: string | null;
  odometer: number | null;
  location_name: string | null;
  city: string | null;
  state: string | null;
  fees: number | null;
  item: string | null;
  unit_price: number | null;
  qty: number | null;
  amt: number | null;
  db: string | null;
  currency: string | null;
}

/** A persisted declined (Reject Report) row (as the preview table reads it). */
export interface DeclinedTransactionRow {
  id: string;
  declined_at: string;
  card_ref: string | null;
  invoice: string | null;
  location_id: string | null;
  location_text: string | null;
  city: string | null;
  state: string | null;
  unit: string | null;
  driver_ext_id: string | null;
  driver_name: string | null;
  error_code: string | null;
  error_description: string | null;
  policy: string | null;
  policy_name: string | null;
}

export interface ReconciledFuelLine extends ParsedFuelLine {
  vehicle_id: string | null;
  driver_id: string | null;
}

/**
 * Resolve each fuel line's Unit → vehicle and Driver Name → driver (pure, testable).
 * Unmatched vehicle ⇒ vehicle_id null ⇒ the row is "unattributed" and routed to review (docs/08 §5).
 */
export function reconcileFuelLines(
  lines: ParsedFuelLine[],
  vehicles: Pick<Vehicle, "id" | "unit_number">[],
  drivers: Pick<Driver, "id" | "full_name">[],
): ReconciledFuelLine[] {
  const byUnit = new Map(vehicles.map((v) => [v.unit_number.trim().toLowerCase(), v.id]));
  const byName = new Map(drivers.map((d) => [d.full_name.trim().toLowerCase(), d.id]));
  return lines.map((line) => ({
    ...line,
    vehicle_id: line.unit ? (byUnit.get(line.unit.trim().toLowerCase()) ?? null) : null,
    driver_id: line.driver_name ? (byName.get(line.driver_name.trim().toLowerCase()) ?? null) : null,
  }));
}

/** Normalize Reject Report rows into declined-attempt records. */
export function normalizeRejectRows(rows: RawRow[]): ParsedDeclined[] {
  return rows.map((row) => {
    const card = str(pick(row, "Card Number", "Card #"));
    const invoice = str(pick(row, "Invoice"));
    const code = str(pick(row, "Error Code", "Reject Reason", "Decline Reason"));
    const declinedAt =
      efsDateTimeToIso(
        str(pick(row, "Date", "Tran Date", "TransactionPOSDate")),
        str(pick(row, "Time", "TransactionPOSTime", "POS Time")),
      ) ??
      rejectDateToIso(str(pick(row, "Date", "Time"))) ??
      new Date().toISOString();
    return {
      external_ref: [card ?? "", invoice ?? "", code ?? ""].join("|"),
      declined_at: declinedAt,
      card_ref: card,
      invoice,
      location_id: str(pick(row, "Location ID")),
      unit: str(pick(row, "Unit")),
      driver_ext_id: str(pick(row, "Driver ID")),
      driver_name: str(pick(row, "Driver Name")),
      location_text: str(pick(row, "Location Name")),
      city: str(pick(row, "Location City", "City")),
      state: str(pick(row, "State/Prov", "State/ Prov", "State", "Location State")),
      error_code: code,
      error_description: str(pick(row, "Error Description", "Reject Description")),
      policy: str(pick(row, "Policy")),
      policy_name: str(pick(row, "Policy Name")),
    };
  });
}
