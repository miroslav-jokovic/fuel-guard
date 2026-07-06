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

/** Which physical tank a fuel line filled: the tractor's propulsion tank or a reefer (trailer) tank. */
export type TankType = "tractor" | "reefer";

/**
 * EFS item codes billed as REEFER (trailer refrigeration / off-road) fuel — dyed, tax-exempt diesel.
 * Kept separate from tractor fuel so reefer gallons don't inflate the tractor's tank-capacity /
 * over-fuel / MPG checks. (Silvicom's exports use ULSR; extend here if a merchant uses RFR/REEF.)
 */
export const REEFER_ITEM_CODES = new Set(["ULSR", "RFR", "REEF", "RFER"]);

/** Classify a fuel line's tank from its EFS Item code. Unknown/tractor codes → 'tractor'. */
export function tankTypeForItem(item: string | null | undefined): TankType {
  return item && REEFER_ITEM_CODES.has(item.trim().toUpperCase()) ? "reefer" : "tractor";
}

/** Whether a fueling timestamp carries a real time-of-day ("instant") or only a date ("date"). */
export type EfsTimePrecision = "instant" | "date";

export interface ParsedFuelLine {
  external_ref: string;
  unit: string | null;
  driver_name: string | null;
  card_ref: string | null;
  fueled_at: string; // ISO instant (true UTC when a POS time + station tz were available)
  /** The EFS business date (station-local, YYYY-MM-DD) — stable across timezones; keys dedupe. */
  tran_date: string;
  /** "instant" when a real POS time-of-day was present; "date" for date-only rows (noon sentinel). */
  fueled_at_precision: EfsTimePrecision;
  odometer: number | null;
  gallons: number;
  price_per_gal: number | null;
  total_cost: number | null;
  fuel_type: FuelType;
  /** tractor propulsion tank vs reefer (trailer) tank — reefer lines are scored separately. */
  tank_type: TankType;
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

/** Extract the business date (YYYY-MM-DD, as printed on the report) from an EFS date cell. */
export function efsLocalDate(date: string | null | undefined): string | null {
  const d = str(date);
  if (!d) return null;
  const iso = d.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const m = d.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/); // US M/D/Y
  if (m) {
    const mo = m[1]!.padStart(2, "0");
    const da = m[2]!.padStart(2, "0");
    const yr = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${yr}-${mo}-${da}`;
  }
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

// ── station-local time → UTC ─────────────────────────────────────────────────
// EFS POS timestamps are STATION-LOCAL wall-clock times. Previously they were stored as if they were
// UTC, which mis-dated evening fills and broke time-of-day rules. We convert wall time → UTC using the
// station state's IANA timezone (DST-correct via Intl). Known limitation, documented: states that span
// two zones (TX/KY/TN/ID/…) use their DOMINANT zone — worst case ±1h, absorbed by the wide matching
// windows downstream. When the state is unknown/unmappable we fall back to naive-UTC (deterministic).

const STATE_IANA_TZ: Record<string, string> = {
  // Eastern
  CT: "America/New_York", DE: "America/New_York", FL: "America/New_York", GA: "America/New_York",
  IN: "America/New_York", KY: "America/New_York", MA: "America/New_York", MD: "America/New_York",
  ME: "America/New_York", MI: "America/New_York", NC: "America/New_York", NH: "America/New_York",
  NJ: "America/New_York", NY: "America/New_York", OH: "America/New_York", PA: "America/New_York",
  RI: "America/New_York", SC: "America/New_York", VA: "America/New_York", VT: "America/New_York",
  WV: "America/New_York", DC: "America/New_York", ON: "America/Toronto", QC: "America/Toronto",
  // Atlantic / Newfoundland (Canada)
  NB: "America/Halifax", NS: "America/Halifax", PE: "America/Halifax", NL: "America/St_Johns",
  // Central
  AL: "America/Chicago", AR: "America/Chicago", IA: "America/Chicago", IL: "America/Chicago",
  KS: "America/Chicago", LA: "America/Chicago", MN: "America/Chicago", MO: "America/Chicago",
  MS: "America/Chicago", ND: "America/Chicago", NE: "America/Chicago", OK: "America/Chicago",
  SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", WI: "America/Chicago",
  MB: "America/Winnipeg", SK: "America/Regina",
  // Mountain
  AZ: "America/Phoenix", CO: "America/Denver", ID: "America/Denver", MT: "America/Denver",
  NM: "America/Denver", UT: "America/Denver", WY: "America/Denver", AB: "America/Edmonton",
  // Pacific
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles",
  WA: "America/Los_Angeles", BC: "America/Vancouver",
  AK: "America/Anchorage", HI: "Pacific/Honolulu",
  NT: "America/Yellowknife", NU: "America/Iqaluit", YT: "America/Whitehorse",
};

/** Dominant IANA timezone for a US state / Canadian province code, or null when unknown. */
export function stateTimeZone(state: string | null | undefined): string | null {
  const s = str(state)?.toUpperCase() ?? null;
  return s ? (STATE_IANA_TZ[s] ?? null) : null;
}

/** Offset (ms) such that wallClock(tz, utcMs) = utcMs + offset. */
function tzOffsetMs(tz: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - utcMs;
}

/**
 * Convert a wall-clock date+time in `tz` to a UTC ISO instant (DST-correct). Two-pass fixpoint:
 * exact except during the 1h spring-forward gap, where it resolves deterministically.
 */
export function zonedWallTimeToUtcIso(ymd: string, hms: string, tz: string): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi, s] = hms.split(":").map(Number);
  const wallMs = Date.UTC(y!, mo! - 1, d!, h ?? 0, mi ?? 0, s ?? 0);
  let utc = wallMs - tzOffsetMs(tz, wallMs);
  utc = wallMs - tzOffsetMs(tz, utc);
  return new Date(utc).toISOString();
}

export interface EfsInstant {
  iso: string;
  precision: EfsTimePrecision;
  /** Station-local business date (YYYY-MM-DD) as printed on the report. */
  tranDate: string;
}

/** True when an ISO instant is exactly the EFS date-only sentinel (noon UTC) → no real time-of-day. */
export function isNoonSentinelIso(iso: string): boolean {
  const d = new Date(iso);
  return (
    d.getUTCHours() === 12 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

/**
 * Parse an EFS date (+ optional POS time, + station state) into a true UTC instant.
 * - date + time + mappable state → station-local wall time converted to UTC ("instant").
 * - date + time, unknown state    → naive-UTC fallback, deterministic ("instant").
 * - date only                     → noon-UTC sentinel ("date"); never fabricates a time-of-day.
 */
export function efsInstant(
  date: string | null | undefined,
  time?: string | null,
  state?: string | null,
): EfsInstant | null {
  const d = str(date);
  if (!d) return null;
  const ymd = efsLocalDate(d);
  if (!ymd) return null;
  // Explicit time column wins; else look for a time embedded in the date string ("… 14:25:00").
  const embedded = d.match(/\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?/);
  const hms = parseEfsTime(time) ?? (embedded ? parseEfsTime(embedded[0]) : null);
  if (!hms) return { iso: `${ymd}T12:00:00.000Z`, precision: "date", tranDate: ymd };
  const tz = stateTimeZone(state);
  const iso = tz ? zonedWallTimeToUtcIso(ymd, hms, tz) : `${ymd}T${hms}.000Z`;
  return { iso, precision: "instant", tranDate: ymd };
}

/**
 * Combine a date + optional time into an ISO instant. Handles "YYYY-MM-DD" and US "M/D/YYYY", and
 * times "HH:MM[:SS]" / "H:MM[:SS] AM|PM" / "HHMMSS". A naive time is treated as UTC (deterministic).
 * Date-only → anchored at noon. Prefer `efsInstant` (station-timezone-aware) for new code.
 */
export function efsDateTimeToIso(date: string | null | undefined, time?: string | null): string | null {
  return efsInstant(date, time, null)?.iso ?? null;
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
    const instant = efsInstant(
      str(pick(row, "Tran Date", "Date", "TransactionPOSDate")),
      str(pick(row, "TransactionPOSTime", "POS Time", "Time")),
      state,
    );
    // tran_date is the STATION-LOCAL business date as printed — not the UTC date of the instant
    // (an evening local fill crosses the UTC date boundary). The ref is date-scoped so identical
    // purchases on different days (blank/reused invoice) can never collide.
    return {
      external_ref: [card ?? "", invoice ?? "", item ?? "", qty ?? "", amt ?? "", instant?.tranDate ?? ""].join("|"),
      line_number: i + 1,
      card_num: card,
      tran_date: instant?.tranDate ?? null,
      fueled_at: instant?.iso ?? null,
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

/** Known truck-stop chains, matched against the EFS Location Name. Order matters (Flying J before J). */
const STATION_BRANDS: { key: string; label: string; patterns: RegExp[] }[] = [
  { key: "flying_j", label: "Flying J", patterns: [/\bflying\s*j\b/i, /\bflyingj\b/i] },
  { key: "pilot", label: "Pilot", patterns: [/\bpilot\b/i] },
  { key: "loves", label: "Love's", patterns: [/\blove'?s\b/i] },
  { key: "ta", label: "TA", patterns: [/\bta\b/i, /\btravelcenters?\b/i, /\btravel\s*centers?\s*of\s*america\b/i] },
  { key: "petro", label: "Petro", patterns: [/\bpetro\b/i] },
];

export interface StationIdentity {
  /** Chain key (pilot, flying_j, loves, ta, petro) or null for independents. */
  brand: string | null;
  brandLabel: string | null;
  /** Store number embedded in the Location Name (e.g. "PILOT JAMESTOWN 305" → "305"). */
  storeNumber: string | null;
  /** Stable cache key. brand+store# is unique nationwide; else falls back to name|city|state. */
  siteKey: string;
  /** Human label for logs / evidence. */
  label: string;
}

const clean = (s: string | null | undefined) => (s ?? "").trim();

/**
 * Extract a stable station identity from the EFS Location Name (+ city/state). Truck-stop names carry
 * the brand and a nationwide-unique store number ("PILOT JAMESTOWN 305"), which lets us key a fuel-site
 * cache precisely instead of fuzzy-matching a city. Pure + testable.
 */
export function parseStationIdentity(
  name: string | null,
  city: string | null,
  state: string | null,
): StationIdentity {
  const n = clean(name);
  const brand = STATION_BRANDS.find((b) => b.patterns.some((p) => p.test(n))) ?? null;
  // Store number = the last standalone number in the name (chains print it after the city).
  const storeNumber = (n.match(/(?:^|\s|#)(\d{1,5})(?:\s|$)/g)?.pop()?.match(/\d{1,5}/)?.[0]) ?? null;

  const c = clean(city).toLowerCase();
  const st = clean(state).toLowerCase();
  const siteKey =
    brand && storeNumber
      ? `${brand.key}#${storeNumber}` // globally unique per chain
      : [n.toLowerCase(), c, st].filter(Boolean).join("|") || "unknown";

  const label = [brand?.label ?? n, city, state].filter(Boolean).join(" · ") || "Unknown site";
  return { brand: brand?.key ?? null, brandLabel: brand?.label ?? null, storeNumber, siteKey, label };
}

/**
 * Unit match keys: exact-normalized (alnum, lowercased) plus a leading-zeros-stripped variant, so
 * "0042", "42", and "Unit 42" all line up. Returns the distinct keys to index/look up by.
 */
export function unitMatchKeys(unit: string): string[] {
  const base = unit.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!base) return [];
  const noLeadingZeros = base.replace(/^0+(?=\d)/, "");
  return [...new Set([base, noLeadingZeros])];
}

/**
 * Driver match key: order-independent, punctuation-insensitive, middle-initial-tolerant. Splits into
 * alphabetic tokens, drops single-letter tokens (initials like "J."), sorts, and joins — so
 * "SMITH, JOHN", "John Smith", and "John A. Smith" all collapse to "john smith".
 */
export function driverMatchKey(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  return tokens.sort().join(" ");
}

/** Build a lookup that maps each key to a single id, marking keys shared by 2+ records as ambiguous. */
function buildKeyIndex(entries: { id: string; keys: string[] }[]): Map<string, string | null> {
  const idx = new Map<string, string | null>();
  for (const { id, keys } of entries) {
    for (const k of keys) {
      if (!k) continue;
      if (idx.has(k)) idx.set(k, null); // collision → ambiguous, don't guess
      else idx.set(k, id);
    }
  }
  return idx;
}

/**
 * Resolve each fuel line's Unit → vehicle and Driver Name → driver (pure, testable). Matching is
 * tolerant of formatting differences ("LAST, FIRST" vs "First Last", casing, punctuation, leading
 * zeros, middle initials). Ambiguous keys (shared by 2+ records) stay unmatched rather than guess.
 * Unmatched vehicle ⇒ vehicle_id null (the row is "unattributed"); we no longer flag that as an anomaly.
 */
export function reconcileFuelLines(
  lines: ParsedFuelLine[],
  vehicles: Pick<Vehicle, "id" | "unit_number">[],
  drivers: Pick<Driver, "id" | "full_name">[],
): ReconciledFuelLine[] {
  const byUnit = buildKeyIndex(vehicles.map((v) => ({ id: v.id, keys: unitMatchKeys(v.unit_number) })));
  const byName = buildKeyIndex(drivers.map((d) => ({ id: d.id, keys: [driverMatchKey(d.full_name)] })));

  const matchUnit = (unit: string | null): string | null => {
    if (!unit) return null;
    for (const k of unitMatchKeys(unit)) {
      const hit = byUnit.get(k);
      if (hit) return hit;
    }
    return null;
  };
  const matchDriver = (name: string | null): string | null => {
    if (!name) return null;
    return byName.get(driverMatchKey(name)) ?? null;
  };

  return lines.map((line) => ({
    ...line,
    vehicle_id: matchUnit(line.unit),
    driver_id: matchDriver(line.driver_name),
  }));
}

/**
 * Normalize Reject Report rows into declined-attempt records. Rows whose date can't be parsed are
 * QUARANTINED to `skipped` — we never fabricate an import-time timestamp for a decline (it would
 * corrupt the decline timeline used by the theft scoring). Refs are date-scoped like transactions.
 */
export function normalizeRejectRows(rows: RawRow[]): {
  declined: ParsedDeclined[];
  skipped: SkippedRow[];
} {
  const declined: ParsedDeclined[] = [];
  const skipped: SkippedRow[] = [];
  rows.forEach((row, i) => {
    const card = str(pick(row, "Card Number", "Card #"));
    const invoice = str(pick(row, "Invoice"));
    const code = str(pick(row, "Error Code", "Reject Code", "Reject Reason", "Decline Reason", "Decline Code", "Reason Code", "Response Code"));
    const state = str(pick(row, "State/Prov", "State/ Prov", "State", "Location State"));
    const instant =
      efsInstant(
        str(pick(row, "Date", "Tran Date", "TransactionPOSDate")),
        str(pick(row, "Time", "TransactionPOSTime", "POS Time")),
        state,
      ) ?? rejectInstant(str(pick(row, "Date", "Time")), state);
    if (!instant) {
      skipped.push({ row_number: i + 1, reason: "unparseable date" });
      return;
    }
    declined.push({
      external_ref: [card ?? "", invoice ?? "", code ?? "", instant.tranDate].join("|"),
      declined_at: instant.iso,
      card_ref: card,
      invoice,
      location_id: str(pick(row, "Location ID")),
      unit: str(pick(row, "Unit")),
      driver_ext_id: str(pick(row, "Driver ID")),
      driver_name: str(pick(row, "Driver Name")),
      location_text: str(pick(row, "Location Name")),
      city: str(pick(row, "Location City", "City")),
      state,
      error_code: code,
      error_description: str(pick(row, "Error Description", "Reject Description", "Reject Reason", "Reason", "Response", "Description")),
      policy: str(pick(row, "Policy")),
      policy_name: str(pick(row, "Policy Name")),
    });
  });
  return { declined, skipped };
}

/** Fallback for Reject Reports with a combined "YYYY-MM-DD HH:mm:ss" cell — station-local, tz-aware. */
function rejectInstant(date: string | null, state: string | null): EfsInstant | null {
  const iso = rejectDateToIso(date);
  if (!iso) return null;
  // rejectDateToIso treated the naive wall time as UTC; re-derive via efsInstant for tz correctness.
  const s = str(date);
  if (s) {
    const viaEfs = efsInstant(s, null, state);
    if (viaEfs?.precision === "instant") return viaEfs;
  }
  return { iso, precision: "instant", tranDate: iso.slice(0, 10) };
}
