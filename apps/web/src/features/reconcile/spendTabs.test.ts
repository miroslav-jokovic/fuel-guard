import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { analyzePolicyExceptions, type SpendLine } from "@fuelguard/shared";
import SpendBridgeCard from "./SpendBridgeCard.vue";
import DiscountCaptureTab from "./DiscountCaptureTab.vue";
import ExceptionsTab from "./ExceptionsTab.vue";
import AncillaryCard from "./AncillaryCard.vue";
import SpendOverviewTab from "./SpendOverviewTab.vue";

/**
 * These tabs are the only place the fuel-spend analytics are ever seen. The functions are covered in
 * `@fuelguard/shared`; what is NOT covered by those tests is whether a template reads a field that
 * does not exist, or renders "$NaN" when a period has no gallons — which is exactly the failure a
 * carrier would report as "the page is broken" and which typecheck cannot catch inside a `<template>`.
 *
 * So each tab is mounted against realistic lines and asserted on the figure it exists to show, plus
 * the empty case, which on this surface is the common one until statements accumulate.
 */

// DataTable branches on `matchMedia`; jsdom has none, so it renders its narrow card view by default.
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: true, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

// `retailAmount` is deliberately nullable: EFS records what we PAID and never what was posted, so a
// fill only carries a posted price when the daily Pilot report covered its station that day. Requiring
// one here made every fixture in this file more measurable than production, where 27.8% of the default
// window's spend carries a quote — which is how a tile dividing a partial retail sum by every gallon
// went unnoticed.
const fill = (o: Partial<SpendLine> & { tranDate: string; gallons: number; netAmount: number; retailAmount: number | null }): SpendLine => ({
  brand: "pilot", state: "TX", site: "1", city: "Somewhere", unit: "701", driver: "A DRIVER",
  product: "diesel", tank: "tractor", miscAmount: null, salesTax: null, ...o,
});

/** Eight weeks — enough for a 4-week bridge — with the discount compressing as the market rises. */
function eightWeeks(): SpendLine[] {
  const out: SpendLine[] = [];
  for (let w = 0; w < 8; w++) {
    const day = new Date(Date.UTC(2026, 5, 1) + w * 7 * 86_400_000).toISOString().slice(0, 10);
    const retail = 4.8 + w * 0.12;
    const disc = 0.8 - w * 0.04;
    for (let i = 0; i < 4; i++) {
      out.push(fill({ tranDate: day, gallons: 150, netAmount: 150 * (retail - disc), retailAmount: 150 * retail, site: String(i + 1), state: ["TX", "OK", "AZ", "NM"][i]! }));
    }
  }
  // one ONE9 fill at the posted price, and one Californian fill
  out.push(fill({ tranDate: "2026-07-13", gallons: 60, netAmount: 60 * 5.4, retailAmount: 60 * 5.4, brand: "one9", state: "SC", site: "453", unit: "754" }));
  out.push(fill({ tranDate: "2026-07-13", gallons: 80, netAmount: 80 * 6.8, retailAmount: 80 * 7.0, state: "CA", site: "200", unit: "703" }));
  return out;
}

describe("SpendBridgeCard", () => {
  it("renders the four components and states the residual", () => {
    const w = mount(SpendBridgeCard, { props: { lines: eightWeeks() } });
    const t = w.text();
    expect(t).toContain("Why spend moved");
    for (const bar of ["More gallons", "The market", "Discount rate", "Where we fuelled"]) expect(t).toContain(bar);
    expect(t).toMatch(/residual \$0\.00/);
    expect(t).not.toContain("NaN");
  });

  it("says what is missing instead of drawing an empty chart", () => {
    const w = mount(SpendBridgeCard, { props: { lines: eightWeeks().slice(0, 4) } });
    expect(w.text()).toContain("Not enough history yet");
    expect(w.text()).not.toContain("NaN");
  });

  it("reads a compressing discount as market-linked rather than as a repricing", () => {
    // A rate bar with no context reads as an accusation; the correlation is what stops that.
    expect(mount(SpendBridgeCard, { props: { lines: eightWeeks() } }).text())
      .toContain("rack-linked deal");
  });
});

describe("DiscountCaptureTab", () => {
  /** Fills carrying a contracted quote, the shape `fuel_spend_lines` returns since 0247. */
  const quoted = (): SpendLine[] =>
    eightWeeks().map((l) => ({
      ...l,
      // Quoted at exactly what was paid, except one fill billed 10c/gal over.
      contractAmount: l.site === "3" ? l.netAmount! - 0.1 * l.gallons : l.netAmount,
      quoteStaleDays: 0,
    }));

  it("compares what was billed against what was quoted, and names the gap", () => {
    const t = mount(DiscountCaptureTab, { props: { lines: quoted() } }).text();
    expect(t).toContain("Billed against contract");
    expect(t).toContain("Quoted / gal");
    expect(t).toContain("Billed / gal");
    expect(t).toMatch(/\$\d+\.\d{3}/); // rates to a tenth of a cent
    expect(t).toContain("over contract");
    expect(t).not.toContain("NaN");
  });

  it("reports fills with no quote as unmeasured rather than as billed correctly", () => {
    // eightWeeks() carries no contractAmount at all, so nothing is measurable.
    const t = mount(DiscountCaptureTab, { props: { lines: eightWeeks() } }).text();
    expect(t).toContain("Nothing here can be priced yet");
    expect(t).not.toContain("Billed against contract");
    expect(t).not.toContain("NaN");
  });

  it("says so when a quote had to be carried forward from the day before", () => {
    const lines = quoted().map((l) => ({ ...l, quoteStaleDays: 1 }));
    const t = mount(DiscountCaptureTab, { props: { lines } }).text();
    expect(t).toContain("previous day's quote");
    expect(t).not.toContain("NaN");
  });

  it("renders with nothing to report rather than throwing", () => {
    const t = mount(DiscountCaptureTab, { props: { lines: [] } }).text();
    expect(t).toContain("Nothing here can be priced yet");
    expect(t).not.toContain("NaN");
  });

  // ── how big is the answer? ────────────────────────────────────────────────────────────────────
  // Measured on production 2026-08-25, this headline covered $849,913 of $3,056,926 — 27.8% of the
  // window's fuel — while reading as a fleet-wide verdict, because `fuel_prices` held 20 days and the
  // window is 90. The share belongs beside the figure; it was in a caution strip below it.
  it("states the share of spend the headline variance was measured over", () => {
    // Half the fills quoted, half with no quote in range.
    const lines = quoted().map((l, i) => (i % 2 === 0 ? l : { ...l, contractAmount: null, retailAmount: null }));
    const t = mount(DiscountCaptureTab, { props: { lines } }).text();
    expect(t).toContain("of this window's fuel");
    expect(t).toMatch(/measured over \$[\d,]+/);
    expect(t).not.toContain("NaN");
  });

  it("does not claim partial coverage when every fill was priced", () => {
    const t = mount(DiscountCaptureTab, { props: { lines: quoted() } }).text();
    expect(t).toContain("100.0% of this window's fuel");
    expect(t).not.toContain("had no quote in range");
  });
});

describe("ExceptionsTab", () => {
  const ex = () => analyzePolicyExceptions(eightWeeks());

  it("prices an avoided brand against the rest of the fleet", () => {
    const t = mount(ExceptionsTab, {
      props: { title: "ONE9 and other off-brand sites", blurb: "…", report: ex().avoidedBrands, slug: "one9" },
    }).text();
    expect(t).toContain("ONE9 and other off-brand sites");
    expect(t).toContain("above the rest of the fleet");
    expect(t).toContain("754"); // the offending unit is nameable
    expect(t).not.toContain("NaN");
  });

  it("states the empty case as the policy holding, not as no data", () => {
    const t = mount(ExceptionsTab, {
      props: { title: "California", blurb: "…", report: analyzePolicyExceptions([]).avoidedStates, slug: "ca" },
    }).text();
    expect(t).toContain("the policy held for this period");
    expect(t).not.toContain("NaN");
  });

  // ── the negative discount ─────────────────────────────────────────────────────────────────────
  // Off-network fills are the ones the Pilot price report does not cover, so no posted price is the
  // ORDINARY case for this report. Divided by every gallon the discount resolved to −netPerGal, and
  // the tile printed a large negative dollar figure captioned "none captured at all" — an accusation
  // built entirely out of missing data.
  it("says it cannot tell, rather than printing a negative discount, when no fill has a posted price", () => {
    const offNetwork = [
      fill({ tranDate: "2026-08-17", gallons: 100, netAmount: 700, retailAmount: null, brand: null, site: "ta1" }),
      fill({ tranDate: "2026-08-18", gallons: 80, netAmount: 550, retailAmount: null, brand: null, site: "ta2" }),
      fill({ tranDate: "2026-08-17", gallons: 120, netAmount: 500, retailAmount: 560, brand: "pilot", site: "p1" }),
    ];
    const t = mount(ExceptionsTab, {
      props: { title: "Off the preferred network", blurb: "…", report: analyzePolicyExceptions(offNetwork).offNetwork, slug: "off" },
    }).text();
    expect(t).toContain("no posted price for these fills");
    expect(t).not.toContain("none captured at all");
    expect(t).not.toMatch(/\$-/); // the shape of the bug: "$-7.007/gal"
    expect(t).not.toContain("NaN");
  });

  it("states the share of gallons a partial discount was measured over", () => {
    // Two off-network fills, one of which happens to carry a posted price.
    const mixed = [
      fill({ tranDate: "2026-08-17", gallons: 100, netAmount: 600, retailAmount: 660, brand: null, site: "x1" }),
      fill({ tranDate: "2026-08-18", gallons: 100, netAmount: 620, retailAmount: null, brand: null, site: "x2" }),
      fill({ tranDate: "2026-08-17", gallons: 120, netAmount: 500, retailAmount: 560, brand: "pilot", site: "p1" }),
    ];
    const t = mount(ExceptionsTab, {
      props: { title: "Off the preferred network", blurb: "…", report: analyzePolicyExceptions(mixed).offNetwork, slug: "off" },
    }).text();
    expect(t).toContain("$0.600/gal");        // $60 over the 100 priced gallons, not over 200
    expect(t).toContain("of these gallons");  // and it says so
    expect(t).not.toContain("NaN");
  });
});

describe("AncillaryCard", () => {
  it("flags a DEF ratio the engines cannot burn", () => {
    const lines = [
      fill({ tranDate: "2026-08-17", gallons: 1000, netAmount: 5000, retailAmount: 5600 }),
      fill({ tranDate: "2026-08-17", gallons: 60, netAmount: 294, retailAmount: 294, product: "def", tank: "none" }),
    ];
    const t = mount(AncillaryCard, { props: { lines } }).text();
    expect(t).toContain("DEF is 6.0% of diesel volume");
    expect(t).toContain("worth a look");
  });

  it("says so plainly when the ratio is normal", () => {
    const lines = [
      fill({ tranDate: "2026-08-17", gallons: 1000, netAmount: 5000, retailAmount: 5600 }),
      fill({ tranDate: "2026-08-17", gallons: 25, netAmount: 122, retailAmount: 122, product: "def", tank: "none" }),
    ];
    expect(mount(AncillaryCard, { props: { lines } }).text()).toContain("sits inside the 2–3%");
  });
});

describe("SpendOverviewTab", () => {
  it("renders the tiles, the weekly series and the bridge together", () => {
    const t = mount(SpendOverviewTab, { props: { lines: eightWeeks() } }).text();
    expect(t).toContain("Paid per gallon");
    expect(t).toContain("Week by week");
    expect(t).toContain("Why spend moved");
    expect(t).toContain("Beyond tractor fuel");
    expect(t).not.toContain("NaN");
  });

  it("shows an em dash rather than $0.00 or NaN when a period has no fuel", () => {
    const t = mount(SpendOverviewTab, { props: { lines: [] } }).text();
    expect(t).not.toContain("NaN");
    expect(t).toContain("—");
  });
});
