import { describe, it, expect } from "vitest";
import { fleetProvenanceLine, monthName } from "./fleetProvenance";
import type { FleetReportResponse } from "./useFleetReport";

/**
 * The provenance line (G8), over July 2026 as production holds it: swept 2026-08-28, 172 trucks,
 * 1,552,337 measured miles, and a decomposition that ties to the cent.
 *
 * What is pinned is what a reader would be misled by. A tie-out that only speaks when it fails
 * cannot be told apart from one nobody runs, so $0.00 is stated. A sweep that never happened is
 * said out loud rather than left blank. And a period with no reportable month claims no tie-out at
 * all, because there are no figures behind it to tie.
 */

const column = (o: Partial<FleetReportResponse["total"]> = {}): FleetReportResponse["total"] => ({
  trucks: 172,
  miles: 1_552_337,
  revenue: 4_828_189.24,
  expenses: 4_058_143.38,
  net: 770_045.86,
  revenuePerMile: 3.11,
  costPerMile: 2.61,
  netPerMile: 0.5,
  ...o,
});

const report = (o: Partial<FleetReportResponse> = {}): FleetReportResponse =>
  ({
    period: { from: "2026-07-01", to: "2026-07-31" },
    total: column(),
    company: column(),
    ownerOperator: column(),
    ownerOperatorBasis: { trucks: [], settlements: 0, pay: 0, loadRevenue: 0, deductionIncome: 0, unruledDeductions: 0 },
    billedMiles: 1_389_814,
    emptyMiles: 162_523,
    emptyPct: 10.5,
    revenuePerBilledMile: 3.47,
    mileageReason: null,
    statement: { sections: [], revenue: 0, expenses: 0, net: 0, toDateRevenue: null, toDateExpenses: null, toDateNet: null, unrecognisedNet: 0 },
    tieOut: { revenue: 0, expenses: 0 },
    monthsCovered: ["2026-07"],
    monthsMissing: [],
    monthsPartial: [],
    ledgerReason: null,
    families: { revenue: [], expense: [], tieOut: { revenue: 0, expenses: 0 } },
    toDateFrom: "2026-01-01",
    sweptAt: "2026-08-28T21:02:56.551Z",
    ...o,
  }) as FleetReportResponse;

describe("fleetProvenanceLine", () => {
  it("states the period, the sweep, the tie-out and the denominator", () => {
    const line = fleetProvenanceLine(report());
    expect(line).toContain("July 2026");
    expect(line).toContain("McLeod ledger swept Aug 28, 2026");
    expect(line).toContain("residual $0.00");
    expect(line).toContain("172 trucks");
    expect(line).toContain("1,552,337 measured miles");
  });

  /** A tie-out that only appears when it fails cannot be told apart from one nobody runs. */
  it("states the residual even when it is zero", () => {
    expect(fleetProvenanceLine(report())).toContain("$0.00");
  });

  it("says which way to read the page when the split misses the ledger", () => {
    const line = fleetProvenanceLine(report({ tieOut: { revenue: 12.5, expenses: -2.5 } }));
    expect(line).toContain("MISS the ledger by $15.00");
    expect(line).toContain("trust the income statement");
    expect(line).not.toContain("residual $0.00");
  });

  it("says out loud that the ledger has never been swept", () => {
    const line = fleetProvenanceLine(report({ sweptAt: null }));
    expect(line).toContain("never been swept");
  });

  /**
   * G11's state: every month of the period was withheld, so there are no figures behind a tie-out
   * and claiming one would be the page's only untrue sentence.
   */
  it("claims no tie-out when no month of the period could be reported", () => {
    const line = fleetProvenanceLine(
      report({ monthsCovered: [], tieOut: { revenue: 0, expenses: 0 }, total: column({ trucks: null, miles: null }) }),
    );
    expect(line).not.toContain("tie to the ledger");
    expect(line).not.toContain("residual");
    expect(line).toContain("McLeod ledger swept Aug 28, 2026");
  });

  /** Prose, not a table: a withheld denominator leaves the clause out rather than printing a dash. */
  it("omits the truck and mile clause when coverage could not supply one", () => {
    const line = fleetProvenanceLine(report({ total: column({ trucks: null, miles: null }) }));
    expect(line).not.toContain("measured miles");
    expect(line).not.toContain("—");
    // The money still ties — G10 withholds the denominator, never the dollars.
    expect(line).toContain("residual $0.00");
  });

  it("names a multi-month period by its ends", () => {
    const line = fleetProvenanceLine(report({ monthsCovered: ["2026-05", "2026-06", "2026-07"] }));
    expect(line).toContain("May 2026 – July 2026");
  });
});

describe("monthName", () => {
  it("reads a period key the way the printed statement heads its page", () => {
    expect(monthName("2026-07")).toBe("July 2026");
  });

  it("returns an unparseable key unchanged rather than inventing a date", () => {
    expect(monthName("not-a-month")).toBe("not-a-month");
  });
});
