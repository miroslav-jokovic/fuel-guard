import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { analyzeCarriedFuel, DEFAULT_FUEL_POLICY, NO_FUEL_TARGETS, type CarriedFuelFill, type FuelPolicy, type SpendLine } from "@silvicom/shared";
import BuyDisciplineTab from "./BuyDisciplineTab.vue";

/**
 * The tab exists to survive being shown to a dispatcher, and three things decide whether it does.
 *
 *   1. THE HEADLINE IS A FLOOR AND MUST READ AS ONE. Half these legs are bounded rather than measured,
 *      and the bound understates roughly fivefold. "The cost" would be a claim the data cannot carry.
 *   2. THE PUMP FIGURE IS NEVER THE HEADLINE. Scored on pump price the same legs read larger, and the
 *      gap is a tax rate owed wherever the fuel was bought — a saving nobody can bank.
 *   3. WHAT PRODUCED NO FINDING IS MOSTLY NOT MISSING DATA. Legs inside one state, and legs run from
 *      cheaper fuel toward dearer, are non-findings by construction. Left unexplained, a 25% hit rate
 *      reads as three quarters of the fleet unmeasured.
 */
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

const fill = (o: Partial<CarriedFuelFill> & { fueledAt: string; state: string; gallons: number; netAmount: number }): CarriedFuelFill => ({
  vehicleId: "v1", unit: "701", tranDate: o.fueledAt.slice(0, 10),
  milesSinceLast: null, baselineMpg: 7, levelBeforePct: null, tankCapacityGal: 240,
  ...o,
});

/** One measured leg (California → Arizona) and, on a second truck, one bounded from miles. */
const legs = (): CarriedFuelFill[] => [
  fill({ fueledAt: "2026-08-10T12:00:00Z", state: "CA", gallons: 150, netAmount: 150 * 6.6 }),
  fill({ fueledAt: "2026-08-11T12:00:00Z", state: "AZ", gallons: 100, netAmount: 100 * 5.2, levelBeforePct: 50 }),
  fill({ vehicleId: "v2", unit: "702", fueledAt: "2026-08-10T12:00:00Z", state: "CA", gallons: 150, netAmount: 150 * 6.6 }),
  fill({ vehicleId: "v2", unit: "702", fueledAt: "2026-08-11T12:00:00Z", state: "TX", gallons: 100, netAmount: 100 * 4.4, milesSinceLast: 350 }),
  // A leg the right way round, and one inside a single state — neither is a finding.
  fill({ vehicleId: "v3", unit: "703", fueledAt: "2026-08-10T12:00:00Z", state: "TX", gallons: 150, netAmount: 150 * 4.4 }),
  fill({ vehicleId: "v3", unit: "703", fueledAt: "2026-08-11T12:00:00Z", state: "CA", gallons: 100, netAmount: 100 * 6.6, levelBeforePct: 50 }),
  fill({ vehicleId: "v4", unit: "704", fueledAt: "2026-08-10T12:00:00Z", state: "TX", gallons: 150, netAmount: 150 * 4.4 }),
  fill({ vehicleId: "v4", unit: "704", fueledAt: "2026-08-11T12:00:00Z", state: "TX", gallons: 100, netAmount: 100 * 4.3, levelBeforePct: 50 }),
];

const policy = (over: Partial<FuelPolicy> = {}): FuelPolicy => ({ ...DEFAULT_FUEL_POLICY, ...over });
const targets = (t: Partial<FuelPolicy["targets"]>): FuelPolicy => policy({ targets: { ...NO_FUEL_TARGETS, ...t } });

/** The feed's view of the same window: what the on-network share and the monthly ceiling are read from. */
const line = (o: Partial<SpendLine> & { tranDate: string; gallons: number }): SpendLine => ({
  brand: "pilot", state: "TX", site: "1", city: null, unit: "701", driver: null,
  product: "diesel", tank: "tractor", netAmount: o.gallons * 4.5, retailAmount: null, ...o,
});
/** 1,000 tractor gallons, 900 on the preferred network; 300 of them in California, all in August. */
const FEED: SpendLine[] = [
  line({ tranDate: "2026-07-20", gallons: 400 }),
  line({ tranDate: "2026-08-03", gallons: 300, state: "CA" }),
  line({ tranDate: "2026-08-15", gallons: 200, brand: "flying_j" }),
  line({ tranDate: "2026-08-28", gallons: 100, brand: null }),
];
const WINDOW = { from: "2026-07-01", to: "2026-08-31" };

const mountTab = (fills = legs(), p = policy(), extra: { lines?: SpendLine[]; window?: { from: string; to: string }; fleetWide?: boolean } = {}) =>
  mount(BuyDisciplineTab, { props: { fills, policy: p, lines: extra.lines ?? [], window: extra.window ?? WINDOW, fleetWide: extra.fleetWide } });
const render = (fills = legs(), p = policy(), extra: Parameters<typeof mountTab>[2] = {}) => mountTab(fills, p, extra).text();
/** The on-network tile's own sub-line — the headline above it wears `text-danger-700` on its own account. */
const onNetworkSub = (w: ReturnType<typeof mountTab>) =>
  w.findAll("p").find((el) => /target at least|no target set|fleet target not applied|no tractor fuel/.test(el.text()));
const usd0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

describe("BuyDisciplineTab", () => {
  it("names the leg, the gallons still aboard and what carrying them cost", () => {
    const t = render();
    expect(t).toContain("Fuel carried out of dearer states");
    expect(t).toContain("CA → AZ");
    expect(t).toContain("701");
    expect(t).not.toContain("NaN");
  });

  it("leads with the PRE-TAX total and not the pump one, asserted on the headline element itself", () => {
    // The first version of this test looked for the words "at least" anywhere in the tab, and passed
    // happily when the headline was swapped to the pump figure — the exact defect this feature is
    // about. It reads the headline node now, and compares against the analyzer's own two totals.
    const report = analyzeCarriedFuel(legs());
    expect(report.pumpExcess).toBeGreaterThan(report.excess); // the fixture must be able to tell them apart
    const headline = mountTab().find(".text-2xl");
    expect(headline.exists()).toBe(true);
    expect(headline.text()).toBe(usd0(report.excess));
    expect(headline.text()).not.toBe(usd0(report.pumpExcess));
  });

  it("calls that headline a floor rather than a cost", () => {
    const t = render();
    expect(t).toContain("at least, over this window");
    expect(t).toContain("The total is a floor, not an estimate.");
  });

  it("shows the pump-price figure as a comparison, with the reason it is not a saving", () => {
    // The gap between the two is a jurisdiction's tax rate, owed on the miles driven there whichever
    // state the diesel came from. Present without that sentence it reads as money left on the table.
    const report = analyzeCarriedFuel(legs());
    const t = render();
    expect(t).toContain(`On pump price the same legs read ${usd0(report.pumpExcess)}`);
    expect(t).toContain("the gap is tax the carrier owes wherever it buys");
    expect(t).toContain("Priced on the fuel itself");
  });

  it("says which legs were measured and which were bounded, apart", () => {
    const t = render();
    expect(t).toContain("measured from a confirmed tank level");
    expect(t).toContain("bounded from miles driven");
  });

  it("accounts for every leg that produced no finding, by name and by count", () => {
    // A 25% hit rate with no explanation reads as three quarters of the fleet unmeasured. The counts
    // are asserted against the analyzer so the sentence cannot drift into decoration.
    const report = analyzeCarriedFuel(legs());
    const t = render();
    expect(t).toContain(`Of ${report.pairs.toLocaleString()} legs`);
    expect(t).toContain(`${report.sameState.toLocaleString()} stayed inside one`);
    expect(t).toContain(`${report.towardDearer.toLocaleString()} ran from cheaper fuel toward dearer`);
    expect(t).toContain(`Only ${report.noBasis + report.unpriceable} could not be judged at all`);
  });

  // ── the one action on the page ────────────────────────────────────────────────────────────────
  it("offers the planner setting that would stop it, with the number that decides it", () => {
    const t = render(legs(), policy({ alwaysFillFull: true }));
    expect(t).toContain("Always fill full");
    expect(t).toContain("switched off");
  });

  it("says nothing about the setting when the carrier has already turned min-drawdown on", () => {
    // Judging a carrier against a discipline they have enabled is noise; the legs still show.
    const t = render(legs(), policy({ alwaysFillFull: false }));
    expect(t).not.toContain("Always fill full");
    expect(t).toContain("CA → AZ");
  });

  // ── the state ranking ─────────────────────────────────────────────────────────────────────────
  it("ranks states on the price of the fuel and marks the ones the policy already names", () => {
    const many = [
      ...Array.from({ length: 30 }, (_, i) =>
        fill({ vehicleId: `c${i}`, fueledAt: "2026-08-10T12:00:00Z", state: "CA", gallons: 120, netAmount: 120 * 6.6 })),
      ...Array.from({ length: 30 }, (_, i) =>
        fill({ vehicleId: `t${i}`, fueledAt: "2026-08-10T12:00:00Z", state: "TX", gallons: 120, netAmount: 120 * 4.4 })),
    ];
    const t = render(many, policy({ avoidStates: ["CA"] }));
    expect(t).toContain("What fuel costs, by state, with the tax taken out");
    expect(t).toContain("California");
    expect(t).toContain("avoided");
    expect(t).toContain("This is what the fleet PAID");
  });

  it("names a dear state the policy does not mention, which is the finding", () => {
    const many = [
      ...Array.from({ length: 30 }, (_, i) =>
        fill({ vehicleId: `a${i}`, fueledAt: "2026-08-10T12:00:00Z", state: "AZ", gallons: 120, netAmount: 120 * 5.4 })),
      ...Array.from({ length: 30 }, (_, i) =>
        fill({ vehicleId: `t${i}`, fueledAt: "2026-08-10T12:00:00Z", state: "TX", gallons: 120, netAmount: 120 * 4.2 })),
    ];
    const t = render(many, policy({ avoidStates: ["CA"] }));
    expect(t).toContain("Arizona");
    expect(t).toContain("in no policy list");
  });

  // ── the empty and the loading cases ───────────────────────────────────────────────────────────
  it("states the empty case as nothing found rather than as no data", () => {
    const t = render([]);
    expect(t).toContain("No fuel was carried out of a dearer state in this window.");
    expect(t).not.toContain("NaN");
  });

  // ── the targets, graded (C8) ──────────────────────────────────────────────────────────────────
  // `gradePolicyTargets` owns the arithmetic and is proved in shared. What is only testable here is that
  // the figures REACH the screen with their grade — the Done-when is about a rendered figure, and a
  // share computed and never rendered is exactly the state C8 was in before this section.
  describe("against your targets", () => {
    it("renders the on-network share graded against the floor, and says how far it is from it", () => {
      // 90% against a 95% floor: short by five points, in the danger tone.
      const w = mountTab(legs(), targets({ onNetworkPct: 95 }), { lines: FEED });
      const t = w.text();
      expect(t).toContain("Against your targets");
      expect(t).toContain("On the preferred network");
      expect(t).toContain("90.0%");
      expect(t).toContain("target at least 95% · 5.0 points short");
      expect(onNetworkSub(w)?.classes()).toContain("text-danger-700");
    });

    it("reads as met, in the success tone, when the share clears the floor", () => {
      const w = mountTab(legs(), targets({ onNetworkPct: 85 }), { lines: FEED });
      expect(w.text()).toContain("target at least 85% · 5.0 points to spare");
      expect(onNetworkSub(w)?.classes()).toContain("text-success-700");
    });

    it("states the unresolved share as the margin of error on the figure", () => {
      const t = render(legs(), targets({ onNetworkPct: 95 }), { lines: FEED });
      expect(t).toContain("10.0% of these gallons could not be matched to a station");
      expect(t).toContain("the true share is between 90.0% and 100.0%");
    });

    it("grades the avoided-state gallons per month, each against the ceiling on its own", () => {
      // July: nothing in California, 250 under. August: 300 against 250, 50 over. Two rows, two verdicts.
      const t = render(legs(), targets({ avoidedStateGal: 250 }), { lines: FEED });
      expect(t).toContain("Gallons in avoided states");
      expect(t).toContain("Ceiling / month");
      expect(t).toContain("at most 250");
      expect(t).toContain("250 under");
      expect(t).toContain("50 over");
      expect(t).toContain("Jul 2026");
      expect(t).toContain("Aug 2026");
    });

    it("calls a partly covered month a floor and does not call it met", () => {
      // The window stops on the 20th, so August's 300 is a floor. July is whole.
      const t = render(legs(), targets({ avoidedStateGal: 5000 }), { lines: FEED, window: { from: "2026-07-01", to: "2026-08-20" } });
      expect(t).toContain("whole month");
      expect(t).toContain("part of the month — a floor");
      expect(t).not.toContain("already over");
    });

    it("calls a partly covered month over the ceiling conclusive, because more gallons could only make it worse", () => {
      const t = render(legs(), targets({ avoidedStateGal: 250 }), { lines: FEED, window: { from: "2026-07-01", to: "2026-08-20" } });
      expect(t).toContain("part of the month — already over");
    });

    it("reports the figures without a grade when no target is set, and says where to set one", () => {
      const w = mountTab(legs(), policy(), { lines: FEED });
      const t = w.text();
      expect(t).toContain("No target is set.");
      expect(t).toContain("90.0%");
      expect(t).toContain("no target set");
      expect(t).not.toContain("points");
      const sub = onNetworkSub(w)!;
      expect(sub.classes()).not.toContain("text-success-700");
      expect(sub.classes()).not.toContain("text-danger-700");
    });

    it("strips the grade under a truck filter, because a target is a fleet commitment", () => {
      // The same fixture that is 5 points SHORT fleet-wide shows the share and no verdict when the
      // reader has picked trucks: three trucks cannot be held to a 4,000-gallon fleet ceiling.
      const w = mountTab(legs(), targets({ onNetworkPct: 95, avoidedStateGal: 250 }), { lines: FEED, fleetWide: false });
      const t = w.text();
      expect(t).toContain("Targets are set for the whole fleet.");
      expect(t).toContain("90.0%");
      expect(t).toContain("fleet target not applied to a truck selection");
      expect(t).not.toContain("points short");
      expect(t).not.toContain("50 over");
    });

    it("says the discount-capture target cannot be measured rather than inventing a figure", () => {
      const t = render(legs(), targets({ discountCapturePct: 80 }), { lines: FEED });
      expect(t).toContain("Discount capture is targeted at least 80% and cannot be measured yet");
    });

    it("has no ceiling to hold a month to when the policy avoids no state", () => {
      const t = render(legs(), targets({ avoidedStateGal: 250 }), { ...{ lines: FEED } });
      expect(t).not.toContain("No state is avoided");
      const none = render(legs(), { ...targets({ avoidedStateGal: 250 }), avoidStates: [] }, { lines: FEED });
      expect(none).toContain("No state is avoided in your policy");
      expect(none).not.toContain("Gallons in avoided states");
    });

    it("renders with no feed lines at all rather than dividing by nothing", () => {
      const t = render(legs(), targets({ onNetworkPct: 95, avoidedStateGal: 250 }), { lines: [] });
      expect(t).not.toContain("NaN");
      expect(t).toContain("no tractor fuel in this window");
    });
  });

  it("renders when every fill is unpriceable rather than dividing by nothing", () => {
    const canadian = [
      fill({ fueledAt: "2026-08-10T12:00:00Z", state: "ON", gallons: 150, netAmount: 900 }),
      fill({ fueledAt: "2026-08-11T12:00:00Z", state: "ON", gallons: 100, netAmount: 500, levelBeforePct: 50 }),
    ];
    const t = render(canadian);
    expect(t).not.toContain("NaN");
    expect(t).toContain("No fuel was carried out of a dearer state in this window.");
  });
});
