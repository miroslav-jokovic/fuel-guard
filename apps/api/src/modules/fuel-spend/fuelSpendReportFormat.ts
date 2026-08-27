/**
 * Number and date formatting for the report. Shared by the assembly and the sections so a figure reads
 * the same wherever it lands, and so neither file has to import the other to borrow a helper.
 */
import type { Metric } from "./fuelSpendReportCharts.js";

/**
 * The sign goes before the dollar, not after it.
 *
 * `$${Math.round(n)}` prints a negative as "$-1", which is not how money is written anywhere and read
 * as a typo in the Excess column the first time a carrier came in UNDER the fleet baseline.
 */
const money = (n: number, body: (v: number) => string) => `${n < 0 ? "-" : ""}$${body(Math.abs(n))}`;

export const usd = (n: number | null | undefined) =>
  n == null ? "-" : money(n, (v) => Math.round(v).toLocaleString("en-US"));
export const usd2 = (n: number | null | undefined) => (n == null ? "-" : money(n, (v) => v.toFixed(2)));
export const usd3 = (n: number | null | undefined) => (n == null ? "-" : money(n, (v) => v.toFixed(3)));
export const num = (n: number | null | undefined, dp = 0) =>
  n == null ? "-" : n.toLocaleString("en-US", { maximumFractionDigits: dp });

/**
 * Money at headline size: $164k rather than $164,038.
 *
 * Only for a KPI card, never for a table cell or a variance. A card is read at a glance and six digits
 * of precision in 17pt type is a number the reader has to parse rather than see; a table is read for
 * the digits, and rounding a $2,444 excess to $2k would be hiding the finding.
 */
export function usdCompact(n: number | null | undefined): string {
  if (n == null) return "-";
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 10_000) return `${sign}$${Math.round(a / 1000).toLocaleString("en-US")}k`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
}

export const plural = (n: number, word: string, suffix = "s") => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : suffix}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-08-17" as "Aug 17".
 *
 * ── WHY THE DOCUMENT DOES NOT PRINT ISO DATES ───────────────────────────────────────────────────
 * ISO is right in the database, in a filename and in a query string, and wrong on a page somebody
 * reads. "2026-08-17 - 2026-08-23" is 23 characters that wrapped to two lines in a 92pt column, so
 * every row of the week-by-week table was double height and twelve weeks filled most of page 1. "Aug
 * 17 - 23" is nine, on one line, and is what the reader would have said out loud anyway.
 *
 * Parsed as UTC deliberately: these are calendar days from `fuel_spend_days`, not instants, and
 * `new Date("2026-08-17")` west of Greenwich is the 16th.
 */
function parts(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null;
}

export function shortDay(iso: string): string {
  const p = parts(iso);
  return p ? `${MONTHS[p.m]} ${p.d}` : iso;
}

export function shortDayYear(iso: string): string {
  const p = parts(iso);
  return p ? `${MONTHS[p.m]} ${p.d}, ${p.y}` : iso;
}

/** "Aug 17 - 23", collapsing the month when both ends share it, or one date for a single day. */
export function rangeLabel(from: string, to: string): string {
  if (from === to) return shortDay(from);
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return `${from} - ${to}`;
  return a.m === b.m && a.y === b.y ? `${MONTHS[a.m]} ${a.d} - ${b.d}` : `${shortDay(from)} - ${shortDay(to)}`;
}

/** The window on the letterhead: "Jun 1 - Aug 23, 2026". */
export function windowLabel(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return `${from} to ${to}`;
  return a.y === b.y ? `${shortDay(from)} - ${shortDay(to)}, ${b.y}` : `${shortDayYear(from)} - ${shortDayYear(to)}`;
}

/** Whole days between two calendar dates, inclusive of both ends. */
export function daysBetween(from: string, to: string): number {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d)) / 86_400_000) + 1;
}

/** A formatted delta plus the verdict on it — `upIsBad` says which direction is the bad one. */
export function change(
  a: number | null | undefined,
  b: number | null | undefined,
  upIsBad: boolean,
): Pick<Metric, "delta" | "deltaIsBad"> {
  if (a == null || b == null || a === 0 || a === b) return {};
  const p = ((b - a) / Math.abs(a)) * 100;
  return {
    delta: `${p >= 0 ? "+" : "-"}${Math.abs(p).toFixed(1)}%`,
    // The sign and the preference resolved together. Spend up is bad; MPG up is the one good headline
    // this report ever gets, and a tile that painted it red would bury it.
    deltaIsBad: p > 0 === upIsBad,
  };
}
