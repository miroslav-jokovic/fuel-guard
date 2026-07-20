/** EFS report detection + transaction normalization + faithful lines + store re-derivation. */
import type { FuelType } from "../constants.js";
import { FUEL_PRODUCT_CODES, tankTypeForItem } from "./types.js";
import type { RawRow, ParsedFuelLine, SkippedRow, ReportKind } from "./types.js";
import { str, num, efsInstant, parseEfsTime, isNoonSentinelIso } from "./dateTime.js";

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
  const normed = headers.map(normKey);
  const h = new Set(normed);
  const has = (...ks: string[]) => ks.some((k) => h.has(normKey(k)));

  // Reject / Decline report — explicit known column names.
  if (has(
    "Error Code", "Error Description",
    "Reject Reason", "Reject Code",
    "Decline Reason", "Decline Code",
    "Reason Code", "Response Code",
    "Auth Code", "Authorization Code",
  )) return "reject";

  // Reject / Decline report — keyword substring fallback (catches 'Reject Transaction Status', etc.).
  if (normed.some((k) => k.includes("reject") || k.includes("decline"))) return "reject";

  // Transaction report — needs a product column AND a quantity column.
  const hasProduct = has("Item", "Product Code", "ProductCode", "Product Description", "ProductDescription", "Prod Code", "Product");
  const hasQty     = has("Qty", "Quantity", "Gallons", "Volume", "Liters", "Gallons Purchased");
  if (hasProduct && hasQty) return "transaction";

  // Fallback: EFS transaction exports always have "Tran Date" + "Card #"/"Card Number" + "Invoice" together.
  if (has("Tran Date", "Transaction Date", "TransactionPOSDate") && has("Card #", "Card Number") && has("Invoice")) return "transaction";

  // Decisive reject heuristic: a card row with a date but NO dispensed fuel quantity is a decline
  // (nothing was pumped) — this catches reject exports whose reason column we don't recognize by name.
  const hasCard = has("Card #", "Card Number", "CardNumber");
  const hasDate = has("Tran Date", "Transaction Date", "TransactionPOSDate", "Date", "Decline Date", "Declined At");
  if (hasCard && hasDate && !hasQty) return "reject";

  return "unknown";
}

/** Normalize a header for matching — drop case, spaces and punctuation ("Driver Name" ≈ "DriverName"). */
const normKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Pick a cell by any of several header aliases, matching space/punctuation/case-insensitively. */
export const pick = (row: RawRow, ...keys: string[]): unknown => {
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
 *
 * The merge/dedupe key is Card | Invoice | BUSINESS-DATE: EFS invoice numbers are per-site sequences
 * that can repeat across days, and a date-less key silently merged different days into one event
 * (inflating one day, losing the other) or dropped later days as "duplicates" of an earlier import.
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
    const state = str(pick(row, "State/ Prov", "State/Prov", "State", "Location State"));
    const instant = efsInstant(
      str(pick(row, "Tran Date", "Date", "TransactionPOSDate")),
      str(pick(row, "TransactionPOSTime", "POS Time", "Time")),
      state,
    );
    if (!instant) {
      skipped.push({ row_number: rowNumber, reason: "unparseable date", item });
      return;
    }
    const card = str(pick(row, "Card #", "Card Number"));
    const invoice = str(pick(row, "Invoice"));
    const txnId = str(pick(row, "TransactionId", "Transaction Id", "Transaction ID"));
    const total = num(pick(row, "Amt", "Amount"));
    // One fueling event = one invoice ON one business date (merges multi-line invoices without
    // collapsing reused invoice numbers across days). Only when the invoice is BLANK do we fall back
    // to a unique per-transaction key (TransactionId, else time+amount), so a missing invoice can't
    // collapse a whole card's history into a single row.
    const base = invoice
      ? `${card ?? ""}|${invoice}`
      : txnId
        ? `${card ?? ""}|${txnId}`
        : `${card ?? ""}|${instant.iso}|${total ?? ""}|${gallons}`;
    const dateKey = `${base}|${instant.tranDate}`;
    // Reefer (ULSR) is a SEPARATE fueling event from the tractor's ULSD on the same invoice, so it can't
    // inflate tractor volume/MPG checks. Merge per tank; suffix the ref with |reefer for reefer only, so
    // the tractor event's external_ref stays byte-identical to before (dedup with prior imports intact).
    const tankType = tankTypeForItem(item);
    const ref = tankType === "reefer" ? `${dateKey}|reefer` : dateKey;
    const key = `${dateKey}|${tankType}`;

    const existing = byInvoice.get(key);
    if (existing) {
      existing.gallons += gallons;
      existing.total_cost = (existing.total_cost ?? 0) + (total ?? 0);
    } else {
      byInvoice.set(key, {
        external_ref: ref,
        unit: str(pick(row, "Unit")),
        driver_name: str(pick(row, "Driver Name")),
        card_ref: card,
        fueled_at: instant.iso,
        tran_date: instant.tranDate,
        fueled_at_precision: instant.precision,
        odometer: num(pick(row, "Odometer")),
        gallons,
        price_per_gal: num(pick(row, "Unit Price", "PricePerUnit")),
        total_cost: total,
        fuel_type: fuelType,
        tank_type: tankType,
        item,
        location_text: str(pick(row, "Location Name")),
        city: str(pick(row, "City", "Location City")),
        state,
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
  /** The station-local time-of-day EXACTLY as printed on the report ("HH:MM", 24h), for faithful display.
   *  Null for date-only reports. This is the source of truth for the Transactions page's Time column — it
   *  never round-trips through the tz conversion, so it can't drift. */
  tran_time: string | null;
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
    const state = str(pick(row, "State/ Prov", "State/Prov", "State", "Location State"));
    const dateRaw = str(pick(row, "Tran Date", "Date", "TransactionPOSDate"));
    const timeRaw = str(pick(row, "TransactionPOSTime", "POS Time", "Time"));
    const instant = efsInstant(dateRaw, timeRaw, state);
    // Faithful station-local time-of-day, EXACTLY as printed (mirror of efsInstant's time extraction, but kept
    // as the local wall time — never converted to UTC). This is what the Transactions "Time" column shows.
    const embedded = dateRaw?.match(/\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?/);
    const hms = parseEfsTime(timeRaw) ?? (embedded ? parseEfsTime(embedded[0]) : null);
    const tran_time = hms ? hms.slice(0, 5) : null;
    // tran_date is the STATION-LOCAL business date as printed — not the UTC date of the instant
    // (an evening local fill crosses the UTC date boundary). The ref is date-scoped so identical
    // purchases on different days (blank/reused invoice) can never collide.
    return {
      external_ref: [card ?? "", invoice ?? "", item ?? "", qty ?? "", amt ?? "", instant?.tranDate ?? ""].join("|"),
      line_number: i + 1,
      card_num: card,
      tran_date: instant?.tranDate ?? null,
      fueled_at: instant?.iso ?? null,
      tran_time,
      invoice,
      unit: str(pick(row, "Unit")),
      driver_name: str(pick(row, "Driver Name")),
      odometer: num(pick(row, "Odometer")),
      location_name: str(pick(row, "Location Name")),
      city: str(pick(row, "City", "Location City")),
      state,
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
  tran_time: string | null; // station-local HH:MM exactly as printed (faithful display)
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
  suspicion_level?: string | null; // clear | review | alert (null until scored)
  suspicion_reasons?: { key: string; weight: number; detail: string }[] | null;
}

export interface ReconciledFuelLine extends ParsedFuelLine {
  vehicle_id: string | null;
  driver_id: string | null;
}

// ── derive fuel events from the FAITHFUL EFS STORE (repair / self-heal path) ─────────────────────────
// efs_transactions is the system of record: every uploaded line, verbatim. When fuel_transactions has
// gaps or corrupted rows (a half-failed import, the historical invoice-reuse merge bug, a mis-restored
// date), the correct fix is to re-derive the events from the store — NOT to re-upload files. This is
// the pure half; the API loads the rows, reconciles vehicles/drivers, and upserts.

/** The subset of a persisted efs_transactions row the derivation needs. */
export interface EfsStoreLine {
  card_num: string | null;
  invoice: string | null;
  tran_date: string | null; // YYYY-MM-DD (station-local business date)
  fueled_at: string | null; // ISO instant (true UTC or the noon-UTC date-only sentinel)
  unit: string | null;
  driver_name: string | null;
  odometer: number | null;
  location_name: string | null;
  city: string | null;
  state: string | null;
  item: string | null;
  qty: number | null;
  amt: number | null;
}

export interface DerivedFuelEvents {
  events: ParsedFuelLine[];
  /** Non-fuel lines (DEF, scales, fees) — correctly excluded, counted for the report. */
  skippedNonFuel: number;
  /** Fuel lines with a blank invoice — their original dedupe key embedded a raw parse-time value that
   *  cannot be reconstructed from the store, so re-deriving them risks duplicates. Skipped + counted. */
  skippedBlankInvoice: number;
  /** Rows with no tran_date / no positive qty — unusable, counted. */
  skippedUnusable: number;
}

/**
 * Re-derive merged fuel events from faithful EFS store lines. Produces the SAME external_ref, merge
 * and precision semantics as `normalizeTransactionRows` on the original file (one event per
 * card|invoice|business-date; gallons/cost summed; price re-derived from the merged totals).
 */
export function deriveFuelEventsFromEfsStore(lines: EfsStoreLine[]): DerivedFuelEvents {
  const byKey = new Map<string, ParsedFuelLine>();
  let skippedNonFuel = 0;
  let skippedBlankInvoice = 0;
  let skippedUnusable = 0;

  for (const l of lines) {
    const item = (str(l.item) ?? "").toUpperCase();
    const fuelType = FUEL_PRODUCT_CODES[item] ?? fuelTypeFromText(item);
    if (!fuelType) {
      skippedNonFuel += 1;
      continue;
    }
    if (l.tran_date == null || l.qty == null || l.qty <= 0 || l.fueled_at == null) {
      skippedUnusable += 1;
      continue;
    }
    const invoice = str(l.invoice);
    if (!invoice) {
      skippedBlankInvoice += 1;
      continue;
    }
    const dateKey = `${str(l.card_num) ?? ""}|${invoice}|${l.tran_date}`;
    // Same tank split + ref convention as normalizeTransactionRows, so backfill produces identical refs.
    const tankType = tankTypeForItem(item);
    const ref = tankType === "reefer" ? `${dateKey}|reefer` : dateKey;
    const key = `${dateKey}|${tankType}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.gallons += l.qty;
      existing.total_cost = (existing.total_cost ?? 0) + (l.amt ?? 0);
      // Keep the earliest instant in the group as the fueling time.
      if (new Date(l.fueled_at).getTime() < new Date(existing.fueled_at).getTime()) {
        existing.fueled_at = l.fueled_at;
      }
    } else {
      byKey.set(key, {
        external_ref: ref,
        unit: str(l.unit),
        driver_name: str(l.driver_name),
        card_ref: str(l.card_num),
        fueled_at: l.fueled_at,
        tran_date: l.tran_date,
        fueled_at_precision: isNoonSentinelIso(l.fueled_at) ? "date" : "instant",
        odometer: l.odometer,
        gallons: l.qty,
        price_per_gal: null, // re-derived from merged totals below
        total_cost: l.amt,
        fuel_type: fuelType,
        tank_type: tankType,
        item,
        location_text: str(l.location_name),
        city: str(l.city),
        state: str(l.state),
      });
    }
  }

  const events = [...byKey.values()].map((e) => ({
    ...e,
    price_per_gal:
      e.total_cost != null && e.gallons > 0
        ? Math.round((e.total_cost / e.gallons) * 1000) / 1000
        : e.price_per_gal,
  }));

  return { events, skippedNonFuel, skippedBlankInvoice, skippedUnusable };
}
