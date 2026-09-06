import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import type { FuelPolicy, SpendLine } from "@silvicom/shared";
import { policyReports } from "./policyReports";
import ExceptionsTab from "./ExceptionsTab.vue";

/**
 * FUEL-C5 — the three policy reports, kept in the tree while nothing renders them.
 *
 * ── WHY DEAD CODE GETS A TEST, WHICH IS NOT AS ODD AS IT SOUNDS ─────────────────────────────────
 * C5's own wording: "the three policy tab bodies are KEPT IN THE TREE, UNMOUNTED, until C6 files
 * their findings — a report deleted before its replacement produces anything is a capability gap,
 * however brief." A promise to keep something is worth exactly what checks it: an unmounted module
 * with no importer and no suite is not kept, it is abandoned somewhere findable.
 *
 * These assertions are not new. Every one of them was in `FuelReconciliationPage.test.ts`, pinning a
 * tab that no longer exists, and they moved here with the code they were about. Deleting them along
 * with the tab strip is what would have turned "kept" into "kept and never checked again" — and the
 * step after this one is the one that picks these up.
 *
 * The tab BODY (`ExceptionsTab.vue`) keeps its own suite in `spendTabs.test.ts`, which mounts it
 * directly and never went through the page. What was only ever pinned at the page — which title,
 * which blurb, whether the report exists for this carrier at all — is what is here.
 */

const fill = (o: Partial<SpendLine> & { tranDate: string; gallons: number; netAmount: number }): SpendLine => ({
  brand: "pilot", state: "TX", site: "1", city: "Amarillo", unit: "701", driver: "A DRIVER",
  product: "diesel", tank: "tractor", retailAmount: null, contractAmount: null,
  quoteStaleDays: 0, miscAmount: null, salesTax: null, ...o,
});

/** One off-brand fill, one in an avoided state, one ordinary — enough for all three reports. */
const FEED: SpendLine[] = [
  fill({ tranDate: "2026-08-17", gallons: 120, netAmount: 500, retailAmount: 560 }),
  fill({ tranDate: "2026-08-18", gallons: 90, netAmount: 470, brand: "one9", site: "z1", unit: "754" }),
  fill({ tranDate: "2026-08-19", gallons: 80, netAmount: 520, state: "CA", site: "c1", unit: "812" }),
];

const POLICY: FuelPolicy = {
  avoidStates: ["CA"], avoidBrands: ["one9"], preferredBrands: ["pilot", "flying_j"], alwaysFillFull: true,
};
const withPolicy = (o: Partial<FuelPolicy>): FuelPolicy => ({ ...POLICY, ...o });
const byKey = (policy: FuelPolicy, key: string) => policyReports(FEED, policy).find((r) => r.key === key);

describe("the three policy reports survive C5 intact", () => {
  it("builds all three for a carrier who avoids a brand and a state", () => {
    expect(policyReports(FEED, POLICY).map((r) => r.key)).toEqual([
      "avoided_brands", "avoided_states", "off_network",
    ]);
  });

  /**
   * The report and the route planner read the same three `route_fuel_settings` columns; until F3 only
   * the planner did, so a carrier who added a state got a planner that avoided it and a compliance
   * report that said the policy held. This was `measures the org's own policy rather than the
   * analyzer's default` on the page.
   */
  it("measures the org's own policy rather than the analyzer's default", () => {
    const oregon = withPolicy({ avoidStates: ["OR", "WA"], avoidBrands: ["pride"] });
    // One Californian fill, and this carrier does not avoid California — so the state report is empty.
    expect(byKey(oregon, "avoided_states")!.report.lines).toBe(0);
    // …while the shipped policy, which does, finds it.
    expect(byKey(POLICY, "avoided_states")!.report.lines).toBe(1);
  });

  it("names the avoided-state report after the states the org actually listed", () => {
    const r = byKey(withPolicy({ avoidStates: ["CA", "OR"] }), "avoided_states")!;
    expect(r.title).toBe("California and Oregon");
    expect(r.blurb).toContain("bought in California, Oregon"); // the blurb lists them in full
  });

  it("names the avoided-brand report after the brands the org actually listed", () => {
    const r = byKey(withPolicy({ avoidBrands: ["pride"] }), "avoided_brands")!;
    expect(r.title).toBe("Pride and other off-brand sites");
    expect(r.title).not.toContain("ONE9");
  });

  /**
   * An EMPTY list is a policy too: a carrier who clears `avoid_states` is saying there is no state to
   * avoid, and the honest answer is no report rather than an empty one under a heading they did not
   * choose. Off-network has no list to read, so it exists for everyone.
   */
  it("omits a report the org has deliberately emptied, and keeps the one with no list", () => {
    const none = policyReports(FEED, withPolicy({ avoidStates: [], avoidBrands: [] }));
    expect(none.map((r) => r.key)).toEqual(["off_network"]);
  });

  /**
   * This read "they cost $4 a gallon against $4 for the rest of the fleet" — the sentence introducing
   * the report refuting the report, because `usd()` sets maximumFractionDigits to 0.
   */
  it("quotes per-gallon prices in cents, not rounded to the dollar", () => {
    expect(byKey(POLICY, "avoided_brands")!.blurb).toMatch(/\$\d+\.\d{3} a gallon against \$\d+\.\d{3}/);
  });

  /** The buy-minimum discipline check, which only the avoided-state report carries. */
  it("carries the fill-size note on the state report and on neither of the others", () => {
    const reports = policyReports(FEED, POLICY);
    expect(reports.find((r) => r.key === "avoided_states")!.note).toContain("the gap to watch");
    expect(reports.find((r) => r.key === "avoided_brands")!.note).toBeUndefined();
    expect(reports.find((r) => r.key === "off_network")!.note).toBeUndefined();
  });

  it("says nothing about fill size when there is nothing outside the avoided states to compare", () => {
    const onlyCa = [fill({ tranDate: "2026-08-19", gallons: 80, netAmount: 520, state: "CA", site: "c1" })];
    expect(policyReports(onlyCa, POLICY).find((r) => r.key === "avoided_states")!.note).toBeNull();
  });

  /**
   * ⚠ The descriptors are still the shape `ExceptionsTab` takes. That is the actual promise of
   * "kept in the tree": not that a module compiles, but that C6 can render the report from it without
   * first having to work out what the page used to pass.
   */
  it("hands ExceptionsTab everything it needs, with no page in between", () => {
    for (const r of policyReports(FEED, POLICY)) {
      const w = mount(ExceptionsTab, {
        props: { title: r.title, blurb: r.blurb, report: r.report, slug: r.slug, note: r.note },
      });
      expect(w.text(), r.key).toContain(r.title);
      expect(w.text(), r.key).not.toContain("NaN");
    }
  });
});
