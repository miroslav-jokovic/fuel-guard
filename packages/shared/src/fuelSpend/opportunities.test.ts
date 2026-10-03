import { describe, it, expect } from "vitest";
import { summariseOpportunities, type OpenExceptionRow } from "./opportunities.js";
import { FUEL_EXCEPTION_KIND_LABELS } from "./exceptions.js";

const r = (o: Partial<OpenExceptionRow> = {}): OpenExceptionRow => ({
  kind: "contract_variance", amount: 10, occurred_on: "2026-09-20", ...o,
});

describe("summariseOpportunities", () => {
  it("returns one row per kind with that kind's own count and dollars, and no total", () => {
    const rows = summariseOpportunities([
      r({ amount: 20 }), r({ amount: "5.50" }),
      r({ kind: "off_network_premium", amount: 100 }),
    ]);
    expect(rows.map((x) => [x.kind, x.count, x.amount])).toEqual([
      ["off_network_premium", 1, 100],
      ["contract_variance", 2, 25.5],
    ]);
    // The rows are NOT summed anywhere: nothing in the result is 125.5.
    expect(JSON.stringify(rows)).not.toContain("125.5");
  });

  it("ranks by dollars, then count, then kind, so a tie never reshuffles on refresh", () => {
    const rows = summariseOpportunities([
      r({ kind: "recon_amount", amount: 50 }),
      r({ kind: "recon_gallons", amount: 50 }),
      r({ kind: "recon_gallons", amount: 0 }),
      r({ kind: "contract_variance", amount: 50 }),
    ]);
    // All three carry $50: the kind with two findings leads, then the tie falls to the name ("contract" < "recon").
    expect(rows.map((x) => x.kind)).toEqual(["recon_gallons", "contract_variance", "recon_amount"]);
  });

  it("counts a finding with no amount without inventing dollars for it", () => {
    const [row] = summariseOpportunities([r({ amount: null }), r({ amount: 8 }), r({ amount: "" })]);
    expect(row).toMatchObject({ count: 3, amount: 8, withAmount: 1 });
  });

  it("keeps the earliest date, and names the kind the way the inbox does", () => {
    const [row] = summariseOpportunities([r({ occurred_on: "2026-09-20" }), r({ occurred_on: "2026-08-02" })]);
    expect(row!.oldest).toBe("2026-08-02");
    expect(row!.label).toBe(FUEL_EXCEPTION_KIND_LABELS.contract_variance);
  });

  it("is empty for no findings", () => {
    expect(summariseOpportunities([])).toEqual([]);
  });
});
