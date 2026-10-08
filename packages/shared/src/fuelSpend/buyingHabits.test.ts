import { describe, expect, it } from "vitest";
import { BUYING_HABIT_KINDS, BUYING_HABIT_STATUSES, buyingHabitsTable, monthStartOf, type BuyingHabitFinding } from "./buyingHabits.js";

const f = (o: Partial<BuyingHabitFinding> = {}): BuyingHabitFinding => ({
  kind: "avoided_state_premium", occurred_on: "2026-09-01", unit_number: "809", amount: "10.00",
  evidence: { drivers: ["YOUNESS ALAM"], fills: 2, gallons: 200 }, ...o,
});

describe("the buying-habits table (chunk 9a)", () => {
  it("is the policy premiums, and leaves out only what the detector withdrew", () => {
    expect([...BUYING_HABIT_KINDS].sort()).toEqual(["avoided_brand_premium", "avoided_state_premium", "off_network_premium"]);
    expect(BUYING_HABIT_STATUSES).not.toContain("resolved_by_reingest");
    expect(BUYING_HABIT_STATUSES).toEqual(expect.arrayContaining(["open", "dismissed", "credited"]));
  });

  // The accept: a month's total is the sum of the stored amounts, to the cent. Amounts that float
  // arithmetic gets wrong when added as dollars (0.1 + 0.2) must still land exactly.
  it("totals a month to the cent", () => {
    const amounts = ["0.10", "0.20", "1111.71", "16300.40", "2483.65", "58.04", "114.72", "0.01"];
    const t = buyingHabitsTable(amounts.map((amount, i) => f({ amount, unit_number: String(100 + i) })));
    expect(t.total).toBe(20068.83);
    expect(t.rows.reduce((s, r) => s + Math.round(r.total * 100), 0)).toBe(2006883);
  });

  // Forty 7-cent premiums on one truck: added as dollars (or as unrounded dollars × 100) this is
  // 2.8000000000000007, which a `toBe` on the stored sum would catch and a rounded display would hide.
  it("adds many small amounts without drifting", () => {
    const t = buyingHabitsTable(Array.from({ length: 40 }, (_, i) => f({ amount: "0.07", kind: i % 2 ? "off_network_premium" : "avoided_state_premium" })));
    expect(t.total).toBe(2.8);
    expect(t.rows[0]!.total).toBe(2.8);
    expect(t.byKind.off_network_premium).toBe(1.4);
  });

  it("puts a truck's three kinds side by side in one row per month", () => {
    const t = buyingHabitsTable([
      f({ kind: "avoided_state_premium", amount: 100 }),
      f({ kind: "off_network_premium", amount: "25.50", evidence: { drivers: ["ANA LIMA"], fills: 1, gallons: 90 } }),
      f({ occurred_on: "2026-08-01", amount: 7 }),
    ]);
    expect(t.rows.map((r) => [r.month, r.unit, r.total])).toEqual([["2026-09", "809", 125.5], ["2026-08", "809", 7]]);
    const sept = t.rows[0]!;
    expect(sept.byKind).toEqual({ off_network_premium: 25.5, avoided_state_premium: 100, avoided_brand_premium: 0 });
    expect(sept.drivers).toEqual(["ANA LIMA", "YOUNESS ALAM"]);
    expect(sept.fills).toBe(2);
    expect(t.byKind.avoided_state_premium).toBe(107);
  });

  it("orders newest month first, then the dearest truck, then the unit", () => {
    const t = buyingHabitsTable([
      f({ unit_number: "12", amount: 5 }), f({ unit_number: "9", amount: 5 }), f({ unit_number: "700", amount: 50 }),
      f({ occurred_on: "2026-10-01", unit_number: "1", amount: 1 }),
    ]);
    expect(t.rows.map((r) => r.unit)).toEqual(["1", "700", "9", "12"]);
  });

  it("ignores a kind that is not a habit, and keeps a truck-month with no driver", () => {
    const t = buyingHabitsTable([f({ kind: "contract_variance", amount: 999 }), f({ evidence: { drivers: [] } })]);
    expect(t.total).toBe(10);
    expect(t.rows[0]!.drivers).toEqual([]);
  });

  it("reads whole months from a window that starts mid-month", () => {
    expect(monthStartOf("2026-07-12")).toBe("2026-07-01");
  });
});
