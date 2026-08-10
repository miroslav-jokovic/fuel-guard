/** EFS report detection + transaction normalization + faithful lines + store re-derivation. */
import { nonUsdGallonsReason } from "./currency.js";
import type { FuelType } from "../constants.js";
import { FUEL_PRODUCT_CODES, tankTypeForItem, fuelEventDateKey } from "./types.js";
import type { RawRow, ParsedFuelLine, SkippedRow, ReportKind } from "./types.js";
import { str, num, efsInstant, parseEfsTime } from "./dateTime.js";

/**
 * CURRENCY / UNIT GUARD — fail closed on anything that is not USD per US gallon (audit 2026-08-09,
 * finding G).
 *
 * Every consumer of a parsed fuel line treats `Qty` as US GALLONS and `Amt` as US DOLLARS: the tank
 * rules compare gallons against tank capacity, the MPG rules divide miles by gallons, and cost_outlier
 * compares $/gal against a USD market median. The documented ground truth for the EFS Transaction
 * Report is `USD/Gallons`, and the Currency column WAS parsed and stored — but nothing ever read it.
 *
 * A Canadian fuelling settles in CAD per LITRE. Read as gallons, 450 L becomes "450 gallons", which
 * fires `exceeds_tank_capacity` at CRITICAL severity against a driver who did nothing wrong, and drags
 * that truck's cost and MPG comparisons with it. We do NOT convert: an exchange rate we do not have,
 * applied to a report we cannot verify, would launder a guess into evidence. Skipping the row with a
 * stated reason keeps the gap VISIBLE in the import summary and leaves the decision to a human.
 *
 * A blank / absent Currency is read as the documented USD/Gallons default — older exports omit the
 * column entirely, and rejecting those would silently drop a fleet's whole history.
 */
/** Filler words a spelled-out currency carries ("US Dollars / Gallons"). Only ever consumed AFTER a
 *  recognised US currency token, so "CAD Dollars" is still rejected on its first token. */


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

/** The EFS Driver Control ID for a row — a stable per-driver identifier printed on the reports. Header
 *  wording varies by EFS export, so match the common labels (space/punctuation/case-insensitive). */
export const controlIdOf = (row: RawRow): string | null =>
  str(pick(row, "Control ID", "Driver Control ID", "Driver Control", "Control Number", "Control No", "Control"));

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
    // Qty is about to be read as US gallons and Amt as USD — refuse the row if its own Currency column
    // says otherwise, rather than mis-scaling it into a critical capacity alert (finding G above).
    const currencyReason = nonUsdGallonsReason(str(pick(row, "Currency", "Transaction Currency")));
    if (currencyReason) {
      skipped.push({ row_number: rowNumber, reason: currencyReason, item });
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
    // Dedup KEY keeps prior behavior (Card # first, else Card Number) so external_refs stay stable across
    // imports. card_ref (used for card-IDENTITY matching + display) prefers the FULLEST value — some EFS
    // reports carry the full number, some a truncated one; auto-prefer full so they aren't conflated.
    const cardShort = str(pick(row, "Card #"));
    const cardFull = str(pick(row, "Card Number", "CardNumber"));
    const card = cardShort ?? cardFull;
    const cardRefVal =
      [cardFull, cardShort].filter((v): v is string => !!v).sort((a, b) => b.length - a.length)[0] ?? card;
    const controlId = controlIdOf(row);
    const invoice = str(pick(row, "Invoice"));
    const stableTxnId = str(pick(row, "Stable Transaction ID", "StableTransactionId"));
    const txnId = stableTxnId ?? str(pick(row, "TransactionId", "Transaction Id", "Transaction ID"));
    const total = num(pick(row, "Amt", "Amount"));
    // One fueling event = one invoice ON one business date (merges multi-line invoices without
    // collapsing reused invoice numbers across days). Only when the invoice is BLANK do we fall back
    // to a unique per-transaction key (TransactionId, else time+amount), so a missing invoice can't
    // collapse a whole card's history into a single row.
    const dateKey = fuelEventDateKey({
      card,
      identity: stableTxnId, // === derive path's l.transaction_id for SOAP → identical refs
      invoice,
      fallback: `${txnId ?? instant.iso}|${total ?? ""}|${gallons}`,
      tranDate: instant.tranDate,
    });
    // Reefer (ULSR) is a separate fueling event from the tractor's ULSD; suffix |reefer so it merges per
    // tank and never inflates tractor volume/MPG, while the tractor ref stays byte-identical to before.
    const tankType = tankTypeForItem(item);
    const ref = tankType === "reefer" ? `${dateKey}|reefer` : dateKey;
    const key = `${dateKey}|${tankType}`;

    const existing = byInvoice.get(key);
    const driverExtId = str(pick(row, "DriverId", "Driver Id", "Driver ID"));
    /** One merged fueling event from this row. Only the ref differs between the two call sites. */
    const newLine = (refValue: string): ParsedFuelLine => ({
      external_ref: refValue,
      // EFS's own unique identifier for the transaction (guide: "unique for each transaction and can
      // be used as the unique identifier"). Stored alongside external_ref rather than replacing it, so
      // existing refs stay stable while identity becomes enforceable — see migration 0107.
      transaction_id: txnId,
      unit: str(pick(row, "Unit")),
      driver_name: str(pick(row, "Driver Name")),
      card_ref: cardRefVal,
      control_id: controlId,
      driver_ext_id: driverExtId,
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

    // WP3c collision guard. The merge key is Card | Invoice | date | tank, and since EFS masks the
    // PAN the "Card" component is only a last-4. Two DIFFERENT drivers' cards sharing a last-4 that
    // also share an invoice number on the same business date would merge into one event with their
    // gallons SUMMED — a fabricated oversized fill that then trips the tank-capacity and cumulative-
    // overfuel rules. Contradicting control numbers prove that happened, so keep the rows apart.
    if (existing && existing.control_id && controlId && existing.control_id.trim() !== controlId.trim()) {
      const collisionKey = `${key}|${controlId.trim()}`;
      const twin = byInvoice.get(collisionKey);
      if (twin) {
        twin.gallons += gallons;
        twin.total_cost = (twin.total_cost ?? 0) + (total ?? 0);
        twin.driver_ext_id = twin.driver_ext_id ?? driverExtId;
        return;
      }
      byInvoice.set(collisionKey, newLine(`${ref}|${controlId.trim()}`));
      return;
    }
    if (existing) {
      existing.gallons += gallons;
      existing.total_cost = (existing.total_cost ?? 0) + (total ?? 0);
      existing.control_id = existing.control_id ?? controlId; // keep the first non-null across merged lines
      existing.driver_ext_id = existing.driver_ext_id ?? driverExtId;
    } else {
      byInvoice.set(key, newLine(ref));
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
  /** EFS transactionId — several line items share one id (see migration 0107). */
  transaction_id: string | null;
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
  control_id: string | null;
  /** EFS numeric DriverId — joins approvals ↔ declines ("Driver ID" on the Reject Report). WP1 D5. */
  driver_ext_id: string | null;
  /** Pump-keyed trailer number (52-col export) — ground truth for reefer pairing (WP8 input). */
  trailer_number: string | null;
  hubometer: number | null;
  trip: string | null;
  subfleet: string | null;
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
    const txnId =
      str(pick(row, "Stable Transaction ID", "StableTransactionId")) ??
      str(pick(row, "TransactionId", "Transaction Id", "Transaction ID"));
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
      external_ref: txnId
        ? [card ?? "", txnId, item ?? "", qty ?? "", amt ?? "", instant?.tranDate ?? ""].join("|")
        : [card ?? "", invoice ?? "", item ?? "", qty ?? "", amt ?? "", instant?.tranDate ?? ""].join("|"),
      line_number: i + 1,
      transaction_id: txnId,
      card_num: card,
      tran_date: instant?.tranDate ?? null,
      fueled_at: instant?.iso ?? null,
      tran_time,
      invoice,
      unit: str(pick(row, "Unit")),
      driver_name: str(pick(row, "Driver Name")),
      control_id: controlIdOf(row),
      driver_ext_id: str(pick(row, "DriverId", "Driver Id", "Driver ID")),
      trailer_number: str(pick(row, "TrailerNumber", "Trailer Number", "Trailer")),
      hubometer: num(pick(row, "Hubometer")),
      trip: str(pick(row, "Trip")),
      subfleet: str(pick(row, "SubFleet", "Sub Fleet")),
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
  control_id: string | null;
  driver_ext_id?: string | null;
  trailer_number?: string | null;
  hubometer?: number | null;
  trip?: string | null;
  subfleet?: string | null;
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
  import_id?: string | null;
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
  /** WP1: taxonomy category of the decline reason (declineReason.ts). Written at scoring. */
  reason_category?: string | null;
  /** WP1 D2: attributed pump-unit vehicle (matched from `unit`), when unambiguous. */
  vehicle_id?: string | null;
  /** WP1 D3: optional EFS alert fields (absent in the standard reject export). */
  card_assigned_unit?: string | null;
  efs_proximity_miles?: number | null;
  efs_truck_position_at?: string | null;
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
  /** EFS transactionId as stored on efs_transactions — carried through so a repair pass rebuilt
   *  from the faithful store keeps the vendor identity instead of blanking it. */
  transaction_id?: string | null;
  control_id?: string | null;
  driver_ext_id?: string | null;
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
  /** The faithful row's Currency column. The store persists it, so the repair path can apply the SAME
   *  fail-closed USD/gallons guard the direct parser does — otherwise a non-USD row rejected at import
   *  would walk straight back in through the re-derivation (audit 2026-08-09, finding G). Optional so
   *  a caller that has not selected the column keeps the documented USD/Gallons default. */
  currency?: string | null;
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
  /** Rows whose Currency is present and is not USD/gallons — `qty` and `amt` cannot be read on the
   *  scales this system assumes, so they are skipped rather than mis-scaled (finding G). */
  skippedNonUsd: number;
}
