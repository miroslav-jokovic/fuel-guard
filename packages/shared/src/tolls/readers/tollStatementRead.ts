/**
 * What a toll statement reader returns, and the layout primitives the three readers share
 * (TOLLS-PER-TRUCK-PLAN TL5, D-TL5, D-TL6, D-TL12). Pure.
 *
 * ── WHAT A READER PROMISES ───────────────────────────────────────────────────────────────────────
 * Every line the statement prints, each with its kind (D-TL18), and every total it prints, each tied
 * to the lines to the cent. A reader that cannot tie a total REFUSES the statement with the sentence
 * that says which total and by how much — it never returns lines that disagree with the paper. That
 * tie, not the column constants, is what makes a reader safe: a word bound to the wrong column cannot
 * reproduce the provider's own arithmetic.
 *
 * ── WHY ROWS ARE GROUPED WITH A 3.5-POINT TOLERANCE ───────────────────────────────────────────────
 * pdfjs reports each run's baseline, and one printed line is not one baseline. On the owner's
 * ExpressToll statements (measured 2026-11-18) the first line under a page header puts its date 3.0 pt
 * above the rest of the line; on K-TAG the "Sub-Total" sits 1 pt below its "Transponder/Plate". A
 * 2.5 pt tolerance split those lines and the per-device totals stopped tying. The tightest real line
 * spacing in any of the 18 statements is 3.6 pt, and only in address blocks; table lines are 8–12 pt
 * apart. So 3.5 joins what is one line and never two.
 *
 * ── MONEY IS INTEGER CENTS ───────────────────────────────────────────────────────────────────────
 * A month of E-ZPass is ~3,000 lines; summing dollars as floats drifts by a cent often enough to
 * refuse a correct statement. Cents are exact.
 */
import type { StatementWord } from "../../reconcile/pilotStatement.js";
import type { TollProvider } from "../tollTags.js";

/**
 * D-TL18. `toll` includes a reversal (negative amount) — it names a toll and goes to that toll's truck.
 * The others are never charged to a truck: an account top-up is cash, a tag purchase and a service fee
 * are fleet overhead, an adjustment keeps the words the provider printed.
 */
export const TOLL_LINE_KINDS = ["toll", "account_payment", "tag_purchase", "service_fee", "adjustment"] as const;
export type TollLineKind = (typeof TOLL_LINE_KINDS)[number];

export interface TollStatementLine {
  kind: TollLineKind;
  /** Transponder as printed (`02213292906`, `KTA.02168949`); null on a plate-billed or non-toll line. */
  tagNumber: string | null;
  /** Plate as printed without its state (`P1239170`, `1063052ST`); null when the line names none. */
  plate: string | null;
  plateState: string | null;
  /** ExpressToll's device group the line was printed under — NOT the line's identity (§1.3). */
  device: string | null;
  agency: string | null;
  entryPlaza: string | null;
  /** Local wall clock as printed, `YYYY-MM-DDTHH:MM[:SS]`, no zone (D-TL9: the plaza's zone, D-TL14). */
  entryAt: string | null;
  /** The plaza that charged; for a one-gantry toll the only plaza. */
  exitPlaza: string | null;
  exitAt: string | null;
  /** Location words where the provider prints a place rather than a code (K-TAG, ExpressToll). */
  location: string | null;
  lane: string | null;
  vehicleClass: string | null;
  /** E-ZPass plan, K-TAG rate (TBR/IBR), ExpressToll status (VTOLL…) — what the provider calls the charge. */
  rate: string | null;
  postedOn: string | null;
  /** Positive = charged to the account, negative = credited. */
  amountCents: number;
  /** Running balance where the statement prints one (E-ZPass). */
  balanceCents: number | null;
  /** The printed words of a non-toll line ("Prepaid Payment"), for the reader on the review page. */
  label: string | null;
  page: number;
  /** 0-based position among this statement's lines, so any figure traces back to the paper (D-TL8). */
  index: number;
}

/** One printed total and what the lines add up to. A read statement has only ties where both agree. */
export interface TollStatementTie {
  label: string;
  printedCents: number;
  readCents: number;
}

export interface TollStatementRead {
  provider: TollProvider;
  account: string;
  periodStart: string;
  periodEnd: string;
  /**
   * The charges total the statement prints — what `toll_statements.printed_total` holds: E-ZPass
   * "Tolls, Non-Tolls and Fees", K-TAG "Tolls", ExpressToll "Grand Total".
   */
  printedChargesCents: number;
  lines: TollStatementLine[];
  ties: TollStatementTie[];
}

/** A statement that cannot be read as the provider printed it. The message is for the office. */
export class TollStatementReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TollStatementReadError";
  }
}

export interface Row {
  page: number;
  y: number;
  words: StatementWord[];
}

export const ROW_TOLERANCE_PT = 3.5;

/** Words → printed lines, in reading order. A line starts at its highest word (see header). */
export function groupRows(words: readonly StatementWord[], tolerance = ROW_TOLERANCE_PT): Row[] {
  const sorted = [...words].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const rows: Row[] = [];
  let cur: Row | null = null;
  for (const w of sorted) {
    if (!cur || w.page !== cur.page || w.y - cur.y > tolerance) {
      cur = { page: w.page, y: w.y, words: [] };
      rows.push(cur);
    }
    cur.words.push(w);
  }
  for (const r of rows) r.words.sort((a, b) => a.x - b.x);
  return rows;
}

export const rowText = (r: Row): string[] => r.words.map((w) => w.text);

/** The words of a row whose left edge falls in [from, to). */
export function band(r: Row, from: number, to: number): string[] {
  return r.words.filter((w) => w.x >= from && w.x < to).map((w) => w.text);
}

export const joined = (words: readonly string[]): string | null => (words.length ? words.join(" ") : null);

const MONEY = /^(-)?\$([\d,]+)\.(\d\d)$/;
export const isMoney = (s: string | undefined): s is string => s != null && MONEY.test(s);

/** `$1,234.56` / `-$9.67` → cents. Throws on anything else: a reader only calls it on a money word. */
export function cents(s: string): number {
  const m = MONEY.exec(s);
  if (!m) throw new TollStatementReadError(`"${s}" is not an amount.`);
  const v = Number(m[2]!.replace(/,/g, "")) * 100 + Number(m[3]);
  return m[1] ? -v : v;
}

export const dollars = (c: number): string => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;

/** `04/27/26` or `4/27/2026` → `2026-04-27`; null when it is not a date. */
export function usDate(s: string | undefined): string | null {
  const m = s ? /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s) : null;
  if (!m) return null;
  const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `16:39` / `4:25:27 PM` / `04:29 PM` → `16:39[:SS]`; null when it is not a time. */
export function clock(time: string | undefined, meridiem?: string): string | null {
  const m = time ? /^(\d{1,2}):(\d\d)(?::(\d\d))?$/.exec(time) : null;
  if (!m) return null;
  let h = Number(m[1]);
  if (meridiem === "AM" || meridiem === "PM") {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (meridiem === "PM" ? 12 : 0);
  } else if (meridiem !== undefined || h > 23) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}${m[3] ? `:${m[3]}` : ""}`;
}

/** A blank line, every nullable field null — each reader fills what its provider prints. */
export function blankLine(kind: TollLineKind, amountCents: number, page: number, index: number): TollStatementLine {
  return {
    kind, tagNumber: null, plate: null, plateState: null, device: null, agency: null, entryPlaza: null,
    entryAt: null, exitPlaza: null, exitAt: null, location: null, lane: null, vehicleClass: null, rate: null,
    postedOn: null, amountCents, balanceCents: null, label: null, page, index,
  };
}

/** Refuse unless every printed total equals what was read; the message names each one that differs. */
export function requireTies(providerLabel: string, ties: readonly TollStatementTie[]): void {
  const off = ties.filter((t) => t.printedCents !== t.readCents);
  if (off.length === 0) return;
  const shown = off.slice(0, 3).map((t) => `${t.label}: printed ${dollars(t.printedCents)}, read ${dollars(t.readCents)}`);
  const more = off.length > 3 ? ` (and ${off.length - 3} more)` : "";
  throw new TollStatementReadError(
    `This ${providerLabel} statement does not add up as read, so nothing was taken from it. ${shown.join("; ")}${more}.`,
  );
}
