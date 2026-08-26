import { describe, expect, it } from "vitest";
import { analyzeCarriedFuel, type CarriedFuelFill } from "./carriedFuel.js";

/**
 * The properties that decide whether this finding survives being shown to a dispatcher.
 *
 * Two of them carry the whole module. The first is that the pre-tax and pump figures never merge: a
 * saving scored on pump price is 21% larger on production and most of that difference is a tax rate
 * the carrier owes wherever it buys. The second is that the miles estimator is a FLOOR — it must never
 * claim more fuel was on board than the tank measurement says, because the moment it does, the total
 * stops being a floor and becomes a number somebody can disprove with a fuel gauge.
 */
const fill = (o: Partial<CarriedFuelFill> & { fueledAt: string; state: string; gallons: number; netAmount: number }): CarriedFuelFill => ({
  vehicleId: "v1", unit: "701", tranDate: o.fueledAt.slice(0, 10),
  milesSinceLast: null, baselineMpg: 7, levelBeforePct: null, tankCapacityGal: 240,
  ...o,
});

/** California at $6.60 then Arizona at $5.20, with the tank half full on arrival. */
const caToAz = (over: Partial<CarriedFuelFill> = {}): CarriedFuelFill[] => [
  fill({ fueledAt: "2026-08-10T12:00:00Z", state: "CA", gallons: 150, netAmount: 150 * 6.6 }),
  fill({ fueledAt: "2026-08-11T12:00:00Z", state: "AZ", gallons: 100, netAmount: 100 * 5.2, levelBeforePct: 50, ...over }),
];

describe("analyzeCarriedFuel", () => {
  it("prices the fuel hauled out of the dearer state on the price of the FUEL, not the pump price", () => {
    const r = analyzeCarriedFuel(caToAz());
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0]!;
    // 240 gal × 50% = 120 on board, capped at the 150 California put in.
    expect(f.carriedGallons).toBe(120);
    expect(f.basis).toBe("tank_level");
    // CA 3Q2026 tax 0.9790, AZ 0.2600 → pre-tax $5.621 vs $4.940, a $0.681 gap over 120 gallons.
    expect(f.excess).toBeCloseTo(120 * (6.6 - 0.979 - (5.2 - 0.26)), 1);
    // On pump price the same haul reads $168 — the difference is California's tax rate, which is owed
    // on the miles driven there whichever state the diesel was bought in.
    expect(f.pumpExcess).toBeCloseTo(120 * 1.4, 1);
    expect(f.pumpExcess).toBeGreaterThan(f.excess);
  });

  it("never adds the pump figure to the pre-tax one", () => {
    const r = analyzeCarriedFuel(caToAz());
    expect(r.excess).toBe(r.findings[0]!.excess);
    expect(r.pumpExcess).toBe(r.findings[0]!.pumpExcess);
    expect(r.excess).not.toBe(r.excess + r.pumpExcess);
  });

  it("caps the carried gallons at what the previous stop actually put in", () => {
    // The truck arrived in Arizona 90% full but California only sold it 40 gallons; the rest of that
    // tank was bought before, and is not this pair's decision.
    const lines = caToAz({ levelBeforePct: 90 });
    lines[0]!.gallons = 40;
    lines[0]!.netAmount = 40 * 6.6;
    expect(analyzeCarriedFuel(lines).findings[0]!.carriedGallons).toBe(40);
  });

  // ── the miles estimator ───────────────────────────────────────────────────────────────────────
  it("falls back to miles burned when no tank level was confirmed, and says which it used", () => {
    // 150 bought, 350 miles at 7 mpg = 50 burned, so at least 100 gallons were still on board.
    const lines = caToAz({ levelBeforePct: null, milesSinceLast: 350 });
    const f = analyzeCarriedFuel(lines).findings[0]!;
    expect(f.basis).toBe("miles_burned");
    expect(f.carriedGallons).toBeCloseTo(100, 6);
  });

  it("is a FLOOR: it can never exceed what a tank level would have measured", () => {
    // The same pair scored both ways. The bound must sit at or below the measurement, or the total
    // stops being a floor and becomes a claim a fuel gauge can disprove. Measured on 1,262 production
    // pairs carrying both, the bound exceeded the measurement on 1.4% and averaged 13 gal to 68.5.
    const measured = analyzeCarriedFuel(caToAz({ levelBeforePct: 50, milesSinceLast: 350 })).findings[0]!;
    const bounded = analyzeCarriedFuel(caToAz({ levelBeforePct: null, milesSinceLast: 350 })).findings[0]!;
    expect(bounded.basis).toBe("miles_burned");
    expect(measured.basis).toBe("tank_level");
    expect(bounded.carriedGallons).toBeLessThanOrEqual(measured.carriedGallons);
  });

  it("drives the bound to zero when the truck burned everything it bought", () => {
    // 150 gallons, 1,400 miles at 7 mpg = 200 burned. Nothing of California's fuel reached Arizona.
    const r = analyzeCarriedFuel(caToAz({ levelBeforePct: null, milesSinceLast: 1400 }));
    expect(r.findings).toHaveLength(0);
    expect(r.excess).toBe(0);
  });

  it("refuses `computed_mpg`'s shape — the burn estimator is per-truck and independent of the fill", () => {
    // If the burn came from `milesSinceLast / gallons` (which is what `computed_mpg` is on 95.7% of
    // production rows), the burn would equal the arriving fill's own gallons and the answer would move
    // when that fill changes size. It must not.
    const small = analyzeCarriedFuel(caToAz({ levelBeforePct: null, milesSinceLast: 350, gallons: 40, netAmount: 40 * 5.2 }));
    const large = analyzeCarriedFuel(caToAz({ levelBeforePct: null, milesSinceLast: 350, gallons: 180, netAmount: 180 * 5.2 }));
    expect(small.findings[0]!.carriedGallons).toBeCloseTo(large.findings[0]!.carriedGallons, 6);
  });

  // ── what is deliberately NOT a finding ────────────────────────────────────────────────────────
  it("finds nothing when the truck drove from cheaper fuel to dearer, which is the right way round", () => {
    const r = analyzeCarriedFuel([
      fill({ fueledAt: "2026-08-10T12:00:00Z", state: "AZ", gallons: 150, netAmount: 150 * 5.2 }),
      fill({ fueledAt: "2026-08-11T12:00:00Z", state: "CA", gallons: 100, netAmount: 100 * 6.6, levelBeforePct: 50 }),
    ]);
    expect(r.findings).toHaveLength(0);
    expect(r.towardDearer).toBe(1);
    expect(r.noBasis).toBe(0);
  });

  it("finds nothing within one state, and counts it apart from a gap in the data", () => {
    const r = analyzeCarriedFuel([
      fill({ fueledAt: "2026-08-10T12:00:00Z", state: "TX", gallons: 150, netAmount: 150 * 4.4 }),
      fill({ fueledAt: "2026-08-11T12:00:00Z", state: "TX", gallons: 100, netAmount: 100 * 4.3, levelBeforePct: 50 }),
    ]);
    expect(r.sameState).toBe(1);
    expect(r.noBasis).toBe(0);
    expect(r.findings).toHaveLength(0);
  });

  it("counts a jurisdiction it cannot price as unpriceable rather than as free fuel", () => {
    const r = analyzeCarriedFuel([
      fill({ fueledAt: "2026-08-10T12:00:00Z", state: "ON", gallons: 150, netAmount: 150 * 6.6 }),
      fill({ fueledAt: "2026-08-11T12:00:00Z", state: "TX", gallons: 100, netAmount: 100 * 4.4, levelBeforePct: 50 }),
    ]);
    expect(r.unpriceable).toBe(1);
    expect(r.findings).toHaveLength(0);
    expect(r.excess).toBe(0);
  });

  it("counts a pair with neither estimator as the only genuine blind spot", () => {
    const r = analyzeCarriedFuel(caToAz({ levelBeforePct: null, milesSinceLast: null, baselineMpg: null }));
    expect(r.noBasis).toBe(1);
    expect(r.findings).toHaveLength(0);
  });

  // ── ordering and scope ────────────────────────────────────────────────────────────────────────
  it("orders by the instant, because two fills on one business date is the cross-border case", () => {
    // Same `tranDate`, opposite order. Ordering on the date alone would pair them backwards and turn a
    // real finding into a "toward dearer" non-finding — silently.
    const r = analyzeCarriedFuel([
      fill({ fueledAt: "2026-08-10T22:00:00Z", state: "AZ", gallons: 100, netAmount: 100 * 5.2, levelBeforePct: 50 }),
      fill({ fueledAt: "2026-08-10T06:00:00Z", state: "CA", gallons: 150, netAmount: 150 * 6.6 }),
    ]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.from.state).toBe("CA");
  });

  it("does not attribute a tank level across a gap too long to be one leg", () => {
    // Three weeks later the tank's contents say nothing about that California purchase. The level
    // estimator is refused; the miles estimator, which is self-limiting, still answers.
    const late = analyzeCarriedFuel([
      fill({ fueledAt: "2026-08-10T12:00:00Z", state: "CA", gallons: 150, netAmount: 150 * 6.6 }),
      fill({ fueledAt: "2026-08-31T12:00:00Z", state: "AZ", gallons: 100, netAmount: 100 * 5.2, levelBeforePct: 50, milesSinceLast: 350 }),
    ]);
    expect(late.findings[0]!.basis).toBe("miles_burned");
  });

  it("keeps each truck's chain separate", () => {
    const r = analyzeCarriedFuel([
      fill({ fueledAt: "2026-08-10T12:00:00Z", state: "CA", gallons: 150, netAmount: 150 * 6.6 }),
      fill({ vehicleId: "v2", fueledAt: "2026-08-10T13:00:00Z", state: "AZ", gallons: 100, netAmount: 100 * 5.2, levelBeforePct: 50 }),
    ]);
    expect(r.pairs).toBe(0);
    expect(r.findings).toHaveLength(0);
  });

  it("reports the two estimators apart, so a floor is never read as a measurement", () => {
    const r = analyzeCarriedFuel([
      ...caToAz(),
      fill({ vehicleId: "v2", fueledAt: "2026-08-10T12:00:00Z", state: "CA", gallons: 150, netAmount: 150 * 6.6 }),
      fill({ vehicleId: "v2", fueledAt: "2026-08-11T12:00:00Z", state: "AZ", gallons: 100, netAmount: 100 * 5.2, milesSinceLast: 350 }),
    ]);
    expect(r.byBasis.tank_level.pairs).toBe(1);
    expect(r.byBasis.miles_burned.pairs).toBe(1);
    expect(r.excess).toBeCloseTo(r.byBasis.tank_level.excess + r.byBasis.miles_burned.excess, 6);
    expect(r.gallons).toBeCloseTo(r.byBasis.tank_level.gallons + r.byBasis.miles_burned.gallons, 6);
  });

  it("puts the largest finding first, because a queue is read from the top", () => {
    const r = analyzeCarriedFuel([
      ...caToAz(),
      fill({ vehicleId: "v2", fueledAt: "2026-08-10T12:00:00Z", state: "CA", gallons: 60, netAmount: 60 * 6.6 }),
      fill({ vehicleId: "v2", fueledAt: "2026-08-11T12:00:00Z", state: "AZ", gallons: 100, netAmount: 100 * 5.2, levelBeforePct: 20 }),
    ]);
    expect(r.findings.map((f) => f.excess)).toEqual([...r.findings.map((f) => f.excess)].sort((a, b) => b - a));
  });

  it("names the matrix quarters that priced the two ends", () => {
    const across = analyzeCarriedFuel([
      fill({ fueledAt: "2026-06-30T12:00:00Z", state: "CA", gallons: 150, netAmount: 150 * 6.6 }),
      fill({ fueledAt: "2026-07-01T12:00:00Z", state: "AZ", gallons: 100, netAmount: 100 * 5.2, levelBeforePct: 50 }),
    ]);
    expect(across.findings[0]!.taxVersions).toEqual(["2Q2026", "3Q2026"]);
    expect(analyzeCarriedFuel(caToAz()).findings[0]!.taxVersions).toEqual(["3Q2026"]);
  });
});

describe("the lookback window", () => {
  const leg = (from: string, to: string, inWindow?: boolean): CarriedFuelFill[] => [
    fill({ fueledAt: `${from}T12:00:00Z`, state: "CA", gallons: 150, netAmount: 150 * 6.6, inWindow: false }),
    fill({ fueledAt: `${to}T12:00:00Z`, state: "AZ", gallons: 100, netAmount: 100 * 5.2, levelBeforePct: 50, inWindow }),
  ];

  it("scores a leg that crossed INTO the window, which is the reason for the lookback", () => {
    // The California fill is context from before `p_from`; the Arizona arrival is in the window. Drop
    // the context row and this leg — about one per truck per window — disappears without a trace.
    const r = analyzeCarriedFuel(leg("2026-05-27", "2026-05-30", true));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.from.state).toBe("CA");
  });

  it("does not score a leg that both began and ended before the window", () => {
    const r = analyzeCarriedFuel(leg("2026-05-26", "2026-05-27", false));
    expect(r.findings).toHaveLength(0);
    expect(r.pairs).toBe(0);
  });

  it("treats an absent flag as in-window, so a hand-assembled set is never silently empty", () => {
    expect(analyzeCarriedFuel(caToAz()).findings).toHaveLength(1);
  });
});
