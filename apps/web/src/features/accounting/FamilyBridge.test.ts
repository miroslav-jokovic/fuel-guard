import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FamilyBridge from "./FamilyBridge.vue";
import type { FamilyRow, FamilySummaryResponse } from "./useFleetReport";

/**
 * Where every dollar went, mounted (R4, D-FRUI4). July 2026's families against July's revenue.
 * What is pinned: the segments and Kept together account for the whole of what was earned, the
 * largest family is darkest and Kept is the only second hue, an unfiled family wears the warning
 * tone, and a period that lost money draws no kept slice and says so.
 */
const REVENUE = 4_828_189.24;
const MILES = 1_552_337;
const fam = (key: string, label: string, amount: number, accounts = 3, isUnassigned = false): FamilyRow => ({
  key, label, isRevenue: false, isUnassigned, amount, toDateAmount: null,
  pctOfRevenue: +((amount / REVENUE) * 100).toFixed(1), toDatePctOfRevenue: null, perMile: +(amount / MILES).toFixed(2), accounts,
});
const families = (extra: FamilyRow[] = []): FamilySummaryResponse => ({
  revenue: [],
  expense: [
    fam("driver_pay", "Company driver pay", 1_150_000, 14),
    fam("fuel", "Fuel and fluids", 1_010_000),
    fam("truck_fixed", "Lease, insurance and interest", 700_000, 9),
    fam("office", "Office and administration", 425_143.38, 31),
    fam("maintenance", "Maintenance and tires", 320_000, 8),
    fam("contractor_pay", "Contractor pay", 225_000, 4),
    fam("road_charges", "Tolls, scales and unloading", 95_000, 5),
    fam("jurisdictional", "Permits, IFTA and IRP", 60_000, 6),
    fam("financing", "Financing and collection", 45_000, 4),
    fam("recruiting", "Recruiting and screening", 28_000, 5),
    ...extra,
  ],
  tieOut: { revenue: 0, expenses: 0 },
});

const mountIt = (net = 770_045.86, f = families()) => mount(FamilyBridge, { props: { families: f, revenue: REVENUE, net } });

describe("FamilyBridge", () => {
  it("draws the families and Kept as shares that add up to what was earned", () => {
    const w = mountIt();
    const widths = w.findAll('[aria-hidden="true"] > span').map((s) => parseFloat((s.attributes("style") ?? "").replace(/.*width:\s*/, "")));
    expect(widths.length).toBe(11);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
    expect(w.text()).toContain("of $4,828,189 earned");
  });

  it("lists every family with its dollars, per-mile figure and share, largest first", () => {
    const t = mountIt().text();
    expect(t).toContain("Company driver pay");
    expect(t).toContain("$1,150,000");
    expect(t).toContain("$0.74");
    expect(t).toContain("23.8%");
    expect(t.indexOf("Company driver pay")).toBeLessThan(t.indexOf("Fuel and fluids"));
    expect(t).toContain("Kept");
    expect(t).toContain("$770,046");
    expect(t).toContain("15.9%");
  });

  it("uses one hue in graded steps, with Kept as the only second hue", () => {
    const html = mountIt().html();
    expect(html).toContain("bg-brand-700/90");
    expect(html).toContain("bg-brand-300/30");
    expect(html).toContain("bg-success-500/75");
    expect(html).not.toContain("bg-danger");
  });

  it("marks a family the owner has not filed yet in the warning tone", () => {
    const html = mountIt(770_045.86, families([fam("unassigned", "Not yet grouped", 12_000, 2, true)])).html();
    expect(html).toContain("bg-warning-500/70");
    expect(html).toContain("Not yet grouped");
  });

  it("draws no kept slice for a period that lost money, and says so", () => {
    const w = mountIt(-352_217.64);
    const segments = w.findAll('[aria-hidden="true"] > span');
    expect(segments.length).toBe(10);
    expect(w.text()).toContain("Lost");
    expect(w.text()).toContain("spent more than it earned");
    expect(w.text()).not.toContain("Kept");
  });
});
