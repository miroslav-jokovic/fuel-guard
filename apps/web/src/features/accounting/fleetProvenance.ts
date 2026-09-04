import type { FleetReportResponse } from "./useFleetReport";

/**
 * The report's provenance, in one line under the page title (G8).
 *
 * **What it replaces.** A whole tab. "Company total" restated the ledger's revenue, expenses and net
 * beside a tie-out — every figure of which the overview now leads with, from the same call. What was
 * left that the overview does NOT say is the part that qualifies every number on the page: which
 * months these figures cover, when the sweep behind them landed, whether the decomposition still
 * adds up, and how many trucks and miles are under the rates. That is a sentence, not a page, and a
 * reader who has to click a tab to find out whether the figures tie will not click it.
 *
 * **Why it states the residual even when it is zero.** A tie-out that only appears when it fails is
 * indistinguishable from a tie-out nobody runs. $0.00 is the claim; printing it is what makes the
 * absence of the claim visible.
 *
 * **What it refuses to say.** When no month of the period could be reported (G11) there is no
 * tie-out to state and no denominator behind any rate, so the line carries the period and the sweep
 * and stops — the overview says why, in full, immediately below it. And a null truck count or
 * mileage is omitted rather than printed as a dash: this line is prose, and "— trucks" in the middle
 * of a sentence reads as a bug rather than as a withheld measurement.
 */

const usd = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** "2026-07" → "July 2026", the way the printed statement heads its own page. */
export function monthName(key: string): string {
  const d = new Date(`${key}-01T00:00:00`);
  return Number.isNaN(d.getTime())
    ? key
    : d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** "2026-08-28T21:02:56Z" → "28 Aug 2026". Dates only: the hour of a sweep is not the reader's question. */
function sweepDay(stamp: string): string {
  const d = new Date(stamp);
  return Number.isNaN(d.getTime())
    ? stamp
    : d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

export function fleetProvenanceLine(report: FleetReportResponse): string {
  const parts: string[] = [];

  const months = report.monthsCovered;
  if (months.length === 1) parts.push(monthName(months[0]!));
  else if (months.length > 1) parts.push(`${monthName(months[0]!)} – ${monthName(months[months.length - 1]!)}`);

  parts.push(
    report.sweptAt
      ? `McLeod ledger swept ${sweepDay(report.sweptAt)}`
      : "McLeod ledger has never been swept for this organisation",
  );

  // No reportable month means no figures to tie out — the overview states the reason in full.
  if (months.length) {
    const off = Math.abs(report.tieOut.revenue) + Math.abs(report.tieOut.expenses);
    parts.push(
      off === 0
        ? "our trucks and contractors tie to the ledger, residual $0.00"
        : `our trucks and contractors MISS the ledger by ${usd(off)} — trust the income statement, not this split`,
    );
  }

  const { trucks, miles } = report.total;
  if (trucks != null && miles != null) {
    parts.push(`${trucks.toLocaleString()} trucks, ${Math.round(miles).toLocaleString()} measured miles`);
  }

  return parts.join(" · ");
}
