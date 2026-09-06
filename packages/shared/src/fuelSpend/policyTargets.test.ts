import { describe, it, expect } from "vitest";
import { gradePolicyTargets, monthsInWindow } from "./policyTargets.js";
import { DEFAULT_FUEL_POLICY, NO_FUEL_TARGETS, type FuelPolicy } from "./policyExceptions.js";
import type { SpendLine } from "./types.js";

/**
 * C8's rendering half, the arithmetic underneath it. Two shapes of target, and the assertions are about
 * the places they differ: the ratio is graded once over the window, the count is graded per calendar
 * month, and a month the window only partly covers is marked so the renderer cannot call it met.
 *
 * ⚠ Fixtures are deliberately UNEVEN — different gallons per fill, different months, one unresolved
 * brand — because a uniform fixture passed ten assertions in another session while proving nothing.
 */

const line = (o: Partial<SpendLine> & { tranDate: string; gallons: number }): SpendLine => ({
  brand: "pilot", state: "TX", site: "1", city: null, unit: "701", driver: null,
  product: "diesel", tank: "tractor", netAmount: o.gallons * 4.5, retailAmount: null, ...o,
});

const policy = (targets: Partial<FuelPolicy["targets"]>): FuelPolicy => ({
  ...DEFAULT_FUEL_POLICY,
  targets: { ...NO_FUEL_TARGETS, ...targets },
});

/** 1,000 tractor gallons: 800 Pilot, 100 Love's, 100 unresolved. 300 of them in California over two months. */
const FLEET: SpendLine[] = [
  line({ tranDate: "2026-07-20", gallons: 500 }),
  line({ tranDate: "2026-08-03", gallons: 300, state: "CA" }),
  line({ tranDate: "2026-08-15", gallons: 100, brand: "loves" }),
  line({ tranDate: "2026-08-28", gallons: 100, brand: null }),
  // Reefer diesel and DEF are not tractor fuel and must not move either figure.
  line({ tranDate: "2026-08-10", gallons: 400, tank: "reefer", state: "CA" }),
  line({ tranDate: "2026-08-10", gallons: 40, product: "def", state: "CA" }),
  // A line with no business date is excluded from the time series, by SpendLine's own rule.
  line({ tranDate: null as unknown as string, gallons: 999, state: "CA" }),
];
const WINDOW = { from: "2026-07-01", to: "2026-08-31" };

describe("the on-network share", () => {
  it("is the preferred-brand gallons over all tractor gallons, with the unresolved share stated beside it", () => {
    const g = gradePolicyTargets(FLEET, policy({}), WINDOW);
    // 800 of 1,000 (the dateless 999 is tractor fuel and DOES count toward a ratio — a ratio has no
    // time axis — so the denominator is 1,999 and Pilot holds 800 + 999).
    expect(g.onNetwork.allGallons).toBe(1999);
    expect(g.onNetwork.gallons).toBe(1799);
    expect(g.onNetwork.actualPct).toBe(90);
    expect(g.onNetwork.unresolvedPct).toBe(5);
  });

  it("counts an unresolved brand as off-network, exactly as the exception report does", () => {
    const resolved = FLEET.map((l) => (l.brand == null ? { ...l, brand: "pilot" } : l));
    const before = gradePolicyTargets(FLEET, policy({}), WINDOW).onNetwork.actualPct!;
    const after = gradePolicyTargets(resolved, policy({}), WINDOW).onNetwork.actualPct!;
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBe(5);
  });

  it("grades the share as a FLOOR against the target, once over the whole window", () => {
    const g = gradePolicyTargets(FLEET, policy({ onNetworkPct: 95 }), WINDOW);
    expect(g.onNetwork.variance).toEqual({ target: 95, actual: 90, delta: -5, met: false });
    const met = gradePolicyTargets(FLEET, policy({ onNetworkPct: 85 }), WINDOW);
    expect(met.onNetwork.variance).toEqual({ target: 85, actual: 90, delta: 5, met: true });
  });

  it("carries no variance when no target is set, and no share when there were no tractor gallons", () => {
    expect(gradePolicyTargets(FLEET, policy({}), WINDOW).onNetwork.variance).toBeNull();
    const empty = gradePolicyTargets([], policy({ onNetworkPct: 95 }), WINDOW).onNetwork;
    expect(empty.actualPct).toBeNull();
    expect(empty.unresolvedPct).toBeNull();
    expect(empty.variance).toBeNull();
  });
});

describe("avoided-state gallons, per month", () => {
  it("enumerates every calendar month the window touches, including months with nothing in them", () => {
    expect(monthsInWindow({ from: "2026-11-15", to: "2027-02-03" })).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthsInWindow({ from: "2026-08-01", to: "2026-08-31" })).toEqual(["2026-08"]);
    expect(monthsInWindow({ from: "2026-09-01", to: "2026-08-31" })).toEqual([]);
  });

  it("buckets only tractor fuel bought in an avoided state, by the fill's business date", () => {
    const g = gradePolicyTargets(FLEET, policy({}), WINDOW);
    expect(g.avoidedStateByMonth.map((m) => [m.month, m.gallons])).toEqual([["2026-07", 0], ["2026-08", 300]]);
  });

  it("grades each month as a CEILING on its own, rather than the window's total against one ceiling", () => {
    // 300 gallons over two months against a 250 ceiling: July met it at zero, August missed it by 50.
    // Graded as a window total it would read "300 vs 250, missed" and July's clean month would vanish.
    const g = gradePolicyTargets(FLEET, policy({ avoidedStateGal: 250 }), WINDOW);
    expect(g.avoidedStateByMonth[0]!.variance).toEqual({ target: 250, actual: 0, delta: 250, met: true });
    expect(g.avoidedStateByMonth[1]!.variance).toEqual({ target: 250, actual: 300, delta: -50, met: false });
  });

  it("marks a month the window only partly covers, so a floor is not read as a month", () => {
    const g = gradePolicyTargets(FLEET, policy({ avoidedStateGal: 250 }), { from: "2026-07-15", to: "2026-08-20" });
    expect(g.avoidedStateByMonth.map((m) => [m.month, m.partial])).toEqual([["2026-07", true], ["2026-08", true]]);
    const whole = gradePolicyTargets(FLEET, policy({}), { from: "2026-07-01", to: "2026-08-20" });
    expect(whole.avoidedStateByMonth.map((m) => [m.month, m.partial])).toEqual([["2026-07", false], ["2026-08", true]]);
  });

  it("keeps a ceiling of zero as a real ceiling that a single avoided-state gallon misses", () => {
    const g = gradePolicyTargets(FLEET, policy({ avoidedStateGal: 0 }), WINDOW);
    expect(g.avoidedStateByMonth[0]!.variance?.met).toBe(true);
    expect(g.avoidedStateByMonth[1]!.variance?.met).toBe(false);
  });

  it("follows the policy's own list of avoided states rather than assuming California", () => {
    const g = gradePolicyTargets(FLEET, { ...policy({}), avoidStates: ["TX"] }, WINDOW);
    // Every TX tractor gallon in July and August: 500 in July; 100 (Love's) + 100 (unresolved) in August.
    expect(g.avoidedStateByMonth.map((m) => m.gallons)).toEqual([500, 200]);
  });
});

describe("discount capture", () => {
  it("carries the target through and grades nothing, because no figure exists to grade", () => {
    expect(gradePolicyTargets(FLEET, policy({ discountCapturePct: 80 }), WINDOW).discountCaptureTargetPct).toBe(80);
    expect(gradePolicyTargets(FLEET, policy({}), WINDOW).discountCaptureTargetPct).toBeNull();
  });
});
