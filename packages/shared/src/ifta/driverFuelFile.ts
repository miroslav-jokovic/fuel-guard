/**
 * Driver-paid fuel files → IFTA receipts (IFTA-PRECISION-PLAN IP8, D-IP7).
 *
 * ── THE TWO FILES THE OFFICE SENDS ───────────────────────────────────────────────────────────────
 * Both measured on the files of 2026-10-07:
 *  - `fuel_app_csv`: a fuel-discount app's "IFTA Report". One row per fill with a `Transaction ID`,
 *    the state spelled out ("Oklahoma"), `Gallons Dispensed`, the station and the driver's name. Its
 *    `Truck #` and `Card Last4` were empty on all 40 rows, so the truck usually has to come from the
 *    driver (the API resolves that, not this module). Below the fills it appends per-state and
 *    grand "Total Gallons" rows, which are not fills but ARE the file's own arithmetic: read here,
 *    they become a check that every gallon the file claims reached us.
 *  - `mcleod_ticket_export`: McLeod's "Fuel Ticket Hist Listing" export of hand-keyed receipts. A
 *    `Tractor Number`, a two-letter `State`, `Gallons Purchased`, and an `Invoice Number` the office
 *    fills with placeholders (`123456` seven times in 61 rows) — so the invoice cannot identify a row
 *    by itself and the fingerprint carries unit, day, state and gallons with it.
 *
 * ── WHAT IS REFUSED, AND WHY EACH ROW SAYS SO ────────────────────────────────────────────────────
 * IFTA credits tax-paid HIGHWAY diesel. A DEF or reefer line, a McLeod ticket marked off-highway, a
 * state that is not a US state or Canadian province, a date that does not parse, or zero gallons is
 * refused with its line number and reason. A McLeod ticket with a void date was voided in McLeod and
 * is skipped, counted. Nothing is dropped without a line in the result: a quarter's return is only
 * as complete as the rows a person can see were left out.
 *
 * Pure: a grid of strings in (the API reads the bytes), facts out. No clock, no I/O.
 */
import { STATE_NAMES } from "../fuelSpend/policyLabels.js";

export type DriverFuelFileFormat = "fuel_app_csv" | "mcleod_ticket_export";

/** One fill, as the file states it. The truck is decided later from `unitAsFiled`/`driverAsFiled`. */
export interface DriverFuelRow {
  /** 1-based line in the file, as a spreadsheet shows it. */
  line: number;
  /** Identity inside its source: one live row per fingerprint makes a re-upload harmless (0436). */
  fingerprint: string;
  jurisdiction: string;
  fueledOn: string;
  /** HH:MM station-local, when the file has one. */
  fueledTimeLocal: string | null;
  gallons: number;
  pricePerGal: number | null;
  amountPaid: number | null;
  fuelType: string | null;
  station: string | null;
  city: string | null;
  postalCode: string | null;
  externalRef: string | null;
  unitAsFiled: string | null;
  driverAsFiled: string | null;
  /** The file's own row, header → cell, kept verbatim as the receipt's provenance. */
  raw: Record<string, string>;
}

export interface DriverFuelRefusal {
  line: number;
  reason: string;
}

/** A total the file states about itself, and what the accepted rows actually add up to. */
export interface DriverFuelStatedTotal {
  /** Null for the grand total. */
  jurisdiction: string | null;
  stated: number;
  parsed: number;
}

export interface ParsedDriverFuelFile {
  format: DriverFuelFileFormat;
  rows: DriverFuelRow[];
  refused: DriverFuelRefusal[];
  /** McLeod tickets with a void date — voided in McLeod, not fuel. */
  voidedInSource: number;
  /** The file's own "Total Gallons" lines, with ours beside them (fuel app only). */
  statedTotals: DriverFuelStatedTotal[];
}

export type DriverFuelFileResult =
  | ({ ok: true } & ParsedDriverFuelFile)
  | { ok: false; reason: string };

/** Gallons within which a file's stated total agrees with the rows it lists (three-decimal files). */
export const STATED_TOTAL_TOLERANCE_GAL = 0.01;

const norm = (s: string | undefined | null) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const text = (s: string | undefined | null): string | null => {
  const t = String(s ?? "").trim();
  return t === "" ? null : t;
};

const STATE_BY_NAME = new Map(Object.entries(STATE_NAMES).map(([c, n]) => [n.toLowerCase(), c]));

/** "Oklahoma", "oklahoma", "OK" → "OK"; anything else → null. */
export function jurisdictionCode(cell: string | null | undefined): string | null {
  const t = String(cell ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(t) && STATE_NAMES[t.toUpperCase()]) return t.toUpperCase();
  return STATE_BY_NAME.get(t.toLowerCase().replace(/\s+/g, " ")) ?? null;
}

/** "$1,320.63", "1320.63", "75.595" → number; blank or junk → null. */
export function fileNumber(cell: string | null | undefined): number | null {
  const t = String(cell ?? "").trim().replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * The day and (when present) the wall-clock time of a fill. Accepts what the two files and Excel
 * produce: `2026-10-04 07:26`, `2026-08-18T00:00:00.000Z` (an Excel date cell, which is midnight UTC
 * standing for the calendar day — its date part IS the day, never shifted by a time zone), and the
 * product's own `10/04/2026 07:26`.
 */
export function fileDayAndTime(cell: string | null | undefined): { day: string; time: string | null } | null {
  const t = String(cell ?? "").trim();
  let y: number, m: number, d: number, rest: string;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(t);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/.exec(t);
  if (iso) [y, m, d, rest] = [Number(iso[1]), Number(iso[2]), Number(iso[3]), iso[4]!];
  else if (us) [y, m, d, rest] = [Number(us[3]), Number(us[1]), Number(us[2]), us[4]!];
  else return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  const day = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  // An Excel date cell carries a midnight-UTC time that is not a time of day; anything else is one.
  const clock = /^[ T](\d{1,2}):(\d{2})/.exec(rest);
  const isExcelMidnight = /^T00:00(:00(\.000)?)?Z$/.test(rest);
  const time = clock && !isExcelMidnight ? `${clock[1]!.padStart(2, "0")}:${clock[2]}` : null;
  return { day, time };
}

interface FormatSpec {
  format: DriverFuelFileFormat;
  required: string[];
}
const SPECS: FormatSpec[] = [
  { format: "fuel_app_csv", required: ["transaction id", "date of visit", "state", "gallons dispensed"] },
  { format: "mcleod_ticket_export", required: ["date", "tractor number", "state", "gallons purchased"] },
];

/** Which file this is and where its header row is — within the first ten rows. */
function locateHeader(grid: string[][]): { spec: FormatSpec; row: number } | null {
  for (let r = 0; r < Math.min(10, grid.length); r++) {
    const cells = new Set((grid[r] ?? []).map(norm));
    for (const spec of SPECS) if (spec.required.every((h) => cells.has(h))) return { spec, row: r };
  }
  return null;
}

/** Fuel the IFTA credit does not cover, by the file's own fuel-type words. */
function nonIftaFuel(fuelType: string | null): string | null {
  const f = norm(fuelType);
  if (!f) return null;
  if (/\bdef\b|exhaust/.test(f)) return "DEF is not motor fuel, so it is not an IFTA purchase";
  if (/reefer/.test(f)) return "reefer fuel does not move the truck, so it is not an IFTA purchase";
  if (/gas(oline)?\b|unleaded/.test(f) && !/diesel/.test(f)) return "gasoline is not this fleet's IFTA fuel";
  return null;
}

/**
 * Reads one driver-paid fuel file. Rows come back in file order; a fingerprint seen twice in ONE
 * file refuses the second occurrence, because two identical rows in one export is the export
 * repeating itself, not a second fill.
 */
export function parseDriverFuelFile(grid: string[][]): DriverFuelFileResult {
  const found = locateHeader(grid);
  if (!found) {
    return {
      ok: false,
      reason:
        "This file is not one we can read yet. Expected the fuel app's IFTA report (Transaction ID, Date of Visit, " +
        "State, Gallons Dispensed) or McLeod's Fuel Ticket Hist Listing (Date, Tractor Number, State, Gallons Purchased).",
    };
  }
  const header = (grid[found.row] ?? []).map((h) => String(h ?? "").trim());
  const col = new Map(header.map((h, i) => [norm(h), i]));
  const rows: DriverFuelRow[] = [];
  const refused: DriverFuelRefusal[] = [];
  const statedTotals: Array<{ jurisdiction: string | null; stated: number }> = [];
  let voidedInSource = 0;
  const seen = new Set<string>();

  for (let r = found.row + 1; r < grid.length; r++) {
    const cells = grid[r] ?? [];
    if (cells.every((c) => String(c ?? "").trim() === "")) continue;
    const line = r + 1;
    const get = (name: string) => {
      const i = col.get(name);
      return i == null ? "" : String(cells[i] ?? "");
    };
    const raw: Record<string, string> = {};
    header.forEach((h, i) => { if (h) raw[h] = String(cells[i] ?? "").trim(); });

    const isApp = found.spec.format === "fuel_app_csv";
    if (isApp && !text(get("transaction id"))) {
      // Not a fill: the app's own totals block. A "Total Gallons" cell is followed by its figure and
      // preceded by its state's code (blank for the grand total).
      const at = cells.findIndex((c) => norm(c) === "total gallons");
      const stated = at >= 0 ? fileNumber(cells[at + 1]) : null;
      if (at >= 0 && stated != null) {
        statedTotals.push({ jurisdiction: jurisdictionCode(cells[at - 1]), stated });
      } else {
        refused.push({ line, reason: "no Transaction ID, and not one of the file's total lines" });
      }
      continue;
    }

    if (!isApp && text(get("void date"))) {
      voidedInSource++;
      continue;
    }

    const when = fileDayAndTime(get(isApp ? "date of visit" : "date"));
    const jurisdiction = jurisdictionCode(get("state"));
    const gallons = fileNumber(get(isApp ? "gallons dispensed" : "gallons purchased"));
    const fuelType = isApp ? text(get("fuel type")) : null;
    const unit = text(get(isApp ? "truck #" : "tractor number"));
    const reason =
      !when ? `the date "${get(isApp ? "date of visit" : "date").trim()}" is not a date`
      : !jurisdiction ? `"${get("state").trim()}" is not a US state or Canadian province`
      : gallons == null || gallons <= 0 ? "no gallons"
      : nonIftaFuel(fuelType)
      ?? (!isApp && norm(get("highway")) === "no" ? "marked off-highway in McLeod, so no road tax was paid on it" : null)
      ?? (!isApp && !unit ? "no tractor number" : null);
    if (reason || !when || !jurisdiction || gallons == null) {
      refused.push({ line, reason: reason ?? "unreadable" });
      continue;
    }

    const externalRef = text(get(isApp ? "transaction id" : "invoice number"));
    const fingerprint = isApp
      ? `fuel_app:${externalRef}`
      : `mcleod_ticket:${unit}|${when.day}|${jurisdiction}|${gallons.toFixed(3)}|${externalRef ?? ""}`;
    if (seen.has(fingerprint)) {
      refused.push({ line, reason: "the same row appears earlier in this file" });
      continue;
    }
    seen.add(fingerprint);

    rows.push({
      line,
      fingerprint,
      jurisdiction,
      fueledOn: when.day,
      fueledTimeLocal: when.time,
      gallons,
      pricePerGal: fileNumber(get(isApp ? "cost" : "price per gallon")),
      amountPaid: fileNumber(get(isApp ? "paid" : "total")),
      fuelType: fuelType ?? (isApp ? null : "Diesel"),
      station: text(get(isApp ? "truck stop" : "fuel stop name")),
      city: text(get("city")),
      postalCode: text(get(isApp ? "zip" : "zip code")),
      externalRef,
      unitAsFiled: unit,
      driverAsFiled: text(get(isApp ? "name" : "driver name")),
      raw,
    });
  }

  const sum = (pred: (r: DriverFuelRow) => boolean) =>
    Math.round(rows.filter(pred).reduce((a, r) => a + r.gallons, 0) * 1000) / 1000;
  return {
    ok: true,
    format: found.spec.format,
    rows,
    refused,
    voidedInSource,
    statedTotals: statedTotals.map((t) => ({
      ...t,
      parsed: sum((r) => t.jurisdiction == null || r.jurisdiction === t.jurisdiction),
    })),
  };
}

/** The stated totals the accepted rows do not add up to — said on the preview before anything lands. */
export function disagreeingTotals(file: ParsedDriverFuelFile): DriverFuelStatedTotal[] {
  return file.statedTotals.filter((t) => Math.abs(t.stated - t.parsed) > STATED_TOTAL_TOLERANCE_GAL);
}
