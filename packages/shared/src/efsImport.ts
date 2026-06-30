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

/** Detect the report type from its header set. */
export function detectReportKind(headers: string[]): ReportKind {
  const h = new Set(headers.map((x) => x.trim().toLowerCase()));
  if (h.has("error code") || h.has("error description")) return "reject";
  if (h.has("item") && h.has("qty") && (h.has("unit") || h.has("card #"))) return "transaction";
  return "unknown";
}

const pick = (row: RawRow, ...keys: string[]): unknown => {
  for (const k of keys) {
    if (k in row && row[k] != null && row[k] !== "") return row[k];
    // case-insensitive fallback
    const found = Object.keys(row).find((rk) => rk.trim().toLowerCase() === k.toLowerCase());
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
    const item = (str(pick(row, "Item")) ?? "").toUpperCase();
    const fuelType = FUEL_PRODUCT_CODES[item];
    if (!fuelType) {
      skipped.push({ row_number: rowNumber, reason: "non-fuel item", item: item || undefined });
      return;
    }
    const gallons = num(pick(row, "Qty"));
    if (gallons == null || gallons <= 0) {
      skipped.push({ row_number: rowNumber, reason: "no gallons", item });
      return;
    }
    const fueledAt = efsDateToIso(str(pick(row, "Tran Date", "Date")));
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
        price_per_gal: num(pick(row, "Unit Price")),
        total_cost: total,
        fuel_type: fuelType,
        item,
        location_text: str(pick(row, "Location Name")),
        city: str(pick(row, "City", "Location City")),
        state: str(pick(row, "State/ Prov", "State/Prov", "State")),
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
    const item = str(pick(row, "Item"));
    const qty = num(pick(row, "Qty"));
    const amt = num(pick(row, "Amt", "Amount"));
    const tranDateStr = str(pick(row, "Tran Date", "Date"));
    const datePart = tranDateStr ? tranDateStr.slice(0, 10) : null;
    return {
      external_ref: [card ?? "", invoice ?? "", item ?? "", qty ?? "", amt ?? ""].join("|"),
      line_number: i + 1,
      card_num: card,
      tran_date: /^\d{4}-\d{2}-\d{2}$/.test(datePart ?? "") ? datePart : null,
      fueled_at: efsDateToIso(tranDateStr),
      invoice,
      unit: str(pick(row, "Unit")),
      driver_name: str(pick(row, "Driver Name")),
      odometer: num(pick(row, "Odometer")),
      location_name: str(pick(row, "Location Name")),
      city: str(pick(row, "City", "Location City")),
      state: str(pick(row, "State/ Prov", "State/Prov", "State")),
      fees: num(pick(row, "Fees")),
      item,
      unit_price: num(pick(row, "Unit Price")),
      qty,
      amt,
      db: str(pick(row, "DB")),
      currency: str(pick(row, "Currency")),
    };
  });
}

/** A persisted faithful EFS transaction row (as the preview table reads it). */
export interface EfsTransactionRow {
  id: string;
  line_number: number | null;
  card_num: string | null;
  tran_date: string | null;
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
    const code = str(pick(row, "Error Code"));
    return {
      external_ref: [card ?? "", invoice ?? "", code ?? ""].join("|"),
      declined_at: rejectDateToIso(str(pick(row, "Date", "Time"))) ?? new Date().toISOString(),
      card_ref: card,
      invoice,
      location_id: str(pick(row, "Location ID")),
      unit: str(pick(row, "Unit")),
      driver_ext_id: str(pick(row, "Driver ID")),
      driver_name: str(pick(row, "Driver Name")),
      location_text: str(pick(row, "Location Name")),
      city: str(pick(row, "Location City", "City")),
      state: str(pick(row, "State/Prov", "State/ Prov", "State")),
      error_code: code,
      error_description: str(pick(row, "Error Description")),
      policy: str(pick(row, "Policy")),
      policy_name: str(pick(row, "Policy Name")),
    };
  });
}
