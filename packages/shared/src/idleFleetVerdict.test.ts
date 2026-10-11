import { describe, it, expect } from "vitest";
import {
  computeIdleBreakdown,
  idleRangeDays,
  type IdleBreakdownRollupRow,
  type IdleVehicle,
} from "./idleBreakdown.js";

/**
 * Whose idle was this?
 *
 * The assembly under test spent its life inside a Vue composable, where it could not be tested and
 * could not be read by the fuel-spend report — which then re-derived idle from raw totals and printed
 * every hour of it as waste, reintroducing the over-count `IDLE-AVOIDABLE-HOS.md` exists to prevent.
 *
 * So the first case here is that exact defect: a truck with NO confirmed alternative contributes
 * nothing to avoidable, however long it idled. Everything else follows from that.
 */

const H = 3600;
const COST = { idleGalPerHour: 0.8, fuelPricePerGal: 5 };

const row = (o: Partial<IdleBreakdownRollupRow> & { vehicle_id: string; day: string }): IdleBreakdownRollupRow => ({
  drive_sec: 8 * H, idle_sec: 10 * H, off_sec: 6 * H, coverage_sec: 24 * H,
  managed_idle_sec: 0, continuous_idle_sec: 10 * H,
  rest_idle_sec: 10 * H, work_idle_sec: 0, other_idle_sec: 0,
  optimized_envelope_inside_sec: 0, optimized_envelope_outside_sec: 0,
  optimized_envelope_unknown_sec: 0, optimized_envelope_ambiguous_sec: 0,
  optimized_envelope_status: "not_applicable", optimized_envelope_source: "none",
  hos_rest_sec: 10 * H, hos_work_sec: 0, hos_unknown_sec: 0, hos_ambiguous_sec: 0, hos_grace_sec: 0,
  hos_evidence_status: "sufficient",
  attributed_driver_id: null,
  ...o,
});

const truck = (id: string, o: Partial<IdleVehicle> = {}): IdleVehicle => ({
  id, unitNumber: id, hasApu: null, hasOptimizedIdle: null, learnedCapability: "unknown", ...o,
});

/** Seven days of identical idling for one truck. */
const week = (id: string) =>
  Array.from({ length: 7 }, (_, i) => row({ vehicle_id: id, day: `2026-08-${String(10 + i).padStart(2, "0")}` }));

const run = (rows: IdleBreakdownRollupRow[], vehicles: IdleVehicle[], prices = new Map<string, number>()) =>
  computeIdleBreakdown(rows, vehicles, prices, {
    rangeDays: idleRangeDays(rows, "2026-08-10", "2026-08-16"),
    costBasis: COST,
  });

describe("a truck with no confirmed alternative is never blamed", () => {
  it("contributes zero avoidable idle no matter how long it idled", () => {
    const { trucks, fleet } = run(week("t1"), [truck("t1")]);
    expect(trucks[0]!.idleH).toBeCloseTo(70, 0); // it idled 70 hours
    expect(trucks[0]!.avoidableH).toBe(0); // and none of it was avoidable
    expect(fleet.avoidableUsd).toBe(0);
  });

  it("but its rest idle IS reported as reducible — the capex case, not blame", () => {
    // This is the number that says "an APU here would pay for itself", and it must exist precisely
    // for the trucks that do not have one.
    const { trucks, fleet } = run(week("t1"), [truck("t1")]);
    expect(trucks[0]!.reducibleH).toBeGreaterThan(0);
    expect(fleet.reducibleUsd).toBeGreaterThan(0);
    expect(fleet.reducibleTrucks).toBe(1);
  });

  it("and learned behaviour alone still cannot make it avoidable", () => {
    // A diesel APU is invisible to telematics — engine-off at rest looks identical to a shutdown — so
    // the learned flag is display only. This is the guard that broke once already.
    const { fleet } = run(week("t1"), [truck("t1", { learnedCapability: "apu" })]);
    expect(fleet.avoidableUsd).toBe(0);
    expect(fleet.avoidableH).toBe(0);
  });
});

describe("a truck with confirmed equipment is judged", () => {
  it("charges its rest idle as avoidable", () => {
    const { trucks, fleet } = run(week("t1"), [truck("t1", { hasApu: true })]);
    expect(trucks[0]!.avoidableH).toBeGreaterThan(0);
    expect(fleet.avoidableUsd).toBeGreaterThan(0);
    expect(fleet.confidentTrucks).toBe(1);
  });

  it("costs it at the idle burn rate and the fuel price", () => {
    const { fleet } = run(week("t1"), [truck("t1", { hasApu: true })]);
    // 70 h × 0.8 gal/h × $5 = $280 if every hour were avoidable; the verdict takes a subset, so the
    // cost must be positive and no greater than the ceiling.
    expect(fleet.avoidableUsd).toBeGreaterThan(0);
    expect(fleet.avoidableUsd).toBeLessThanOrEqual(70 * 0.8 * 5 + 0.01);
  });

  it("prices each day at that day's own diesel price when one exists", () => {
    const flat = run(week("t1"), [truck("t1", { hasApu: true })]).fleet.avoidableUsd;
    const dear = new Map(Array.from({ length: 7 }, (_, i) => [`2026-08-${String(10 + i).padStart(2, "0")}`, 10]));
    const priced = run(week("t1"), [truck("t1", { hasApu: true })], dear).fleet.avoidableUsd;
    expect(priced).toBeGreaterThan(flat); // $10/gal against the $5 basis
  });
});

describe("the fleet roll-up", () => {
  it("separates the equipped from the rest instead of averaging them together", () => {
    const rows = [...week("t1"), ...week("t2")];
    const { fleet } = run(rows, [truck("t1", { hasApu: true }), truck("t2")]);
    expect(fleet.totalTrucks).toBe(2);
    expect(fleet.confidentTrucks).toBe(1); // only the equipped one can be blamed
    expect(fleet.reducibleTrucks).toBe(2); // both are candidates for equipment
    expect(fleet.idleH).toBeCloseTo(140, 0); // and all the idle is still reported
  });

  it("ignores a truck the range observed nothing for", () => {
    const { fleet } = run(week("t1"), [truck("t1"), truck("ghost")]);
    expect(fleet.totalTrucks).toBe(1);
  });
});

describe("what the page says beside each total (design verdict, move 4)", () => {
  const day = (i: number) => `2026-08-${String(10 + i).padStart(2, "0")}`;

  it("counts calendar days with and without a day price, once however many trucks idled on them", () => {
    // Two equipped trucks idle all week; days 0–4 have a price, days 5–6 do not.
    const prices = new Map(Array.from({ length: 5 }, (_, i) => [day(i), 6]));
    const { fleet } = run([...week("t1"), ...week("t2")], [truck("t1", { hasApu: true }), truck("t2", { hasApu: true })], prices);
    expect(fleet.avoidablePricing).toMatchObject({ pricedDays: 5, unpricedDays: 2 });
    expect(fleet.reduciblePricing).toMatchObject({ pricedDays: 5, unpricedDays: 2 });
  });

  it("does not count a day that added nothing to the total, priced or not", () => {
    // Day 6 is driving only: no idle, so nothing on it was charged, and its missing price is not a gap.
    const rows = [...week("t1").slice(0, 6), row({ vehicle_id: "t1", day: day(6), idle_sec: 0, continuous_idle_sec: 0, rest_idle_sec: 0, hos_rest_sec: 0, off_sec: 16 * H })];
    const prices = new Map(Array.from({ length: 6 }, (_, i) => [day(i), 6]));
    const { fleet } = run(rows, [truck("t1", { hasApu: true })], prices);
    expect(fleet.avoidablePricing).toMatchObject({ pricedDays: 6, unpricedDays: 0 });
    expect(fleet.reduciblePricing).toMatchObject({ pricedDays: 6, unpricedDays: 0 });
  });

  it("blends the price over the dollars it actually charged: day prices, and the basis on the days without one", () => {
    // Equal idling every day: five at $6 and two at the $5 basis blend to (5×6 + 2×5) / 7.
    const prices = new Map(Array.from({ length: 5 }, (_, i) => [day(i), 6]));
    const { fleet } = run(week("t1"), [truck("t1", { hasApu: true })], prices);
    expect(fleet.avoidablePricing.blendedPricePerGal).toBeCloseTo((5 * 6 + 2 * 5) / 7, 3);
    // And it is the total's own ratio, not a figure from elsewhere.
    expect(fleet.avoidableUsd / fleet.avoidablePricing.blendedPricePerGal!).toBeCloseTo(fleet.avoidableH * COST.idleGalPerHour, 0);
  });

  it("prices each total over its OWN trucks: an unequipped truck's days never reach the avoidable line", () => {
    // t2 has no equipment, so it is in the reducible total only; it idles on a day with no price.
    const rows = [row({ vehicle_id: "t1", day: day(0) }), row({ vehicle_id: "t2", day: day(1) })];
    const { fleet } = run(rows, [truck("t1", { hasApu: true }), truck("t2")], new Map([[day(0), 6]]));
    expect(fleet.avoidablePricing).toMatchObject({ pricedDays: 1, unpricedDays: 0 });
    expect(fleet.reduciblePricing).toMatchObject({ pricedDays: 1, unpricedDays: 1 });
  });

  it("has no price to state for a total that charged nothing", () => {
    const { fleet } = run(week("t1"), [truck("t1")]); // no equipment: nothing avoidable
    expect(fleet.avoidablePricing).toEqual({ blendedPricePerGal: null, pricedDays: 0, unpricedDays: 0 });
  });

  it("reaches as far as the latest day with coverage, not the latest row", () => {
    const rows = [...week("t1"), row({ vehicle_id: "t1", day: "2026-08-17", coverage_sec: 0, idle_sec: 0, drive_sec: 0, off_sec: 0 })];
    expect(run(rows, [truck("t1")]).fleet.throughDay).toBe("2026-08-16");
    // A vehicle outside the list (retired, say) does not move it either.
    const ghost = [...week("t1"), row({ vehicle_id: "ghost", day: "2026-08-20" })];
    expect(run(ghost, [truck("t1")]).fleet.throughDay).toBe("2026-08-16");
    expect(run([], [truck("t1")]).fleet.throughDay).toBeNull();
  });

  it("counts the trucks the reducible total leaves out for thin data", () => {
    // t2 has one covered day of seven, under half, so it is in the list and out of the reducible total.
    const rows = [...week("t1"), row({ vehicle_id: "t2", day: day(0) })];
    const { fleet } = run(rows, [truck("t1"), truck("t2")]);
    expect(fleet.totalTrucks).toBe(2);
    expect(fleet.reducibleTrucks).toBe(1);
    expect(fleet.thinTrucks).toBe(1);
  });
});

describe("idleRangeDays", () => {
  it("counts days the rollup HAS, not the span the picker selected", () => {
    // Production bug: rollup history starts when the feature shipped, so a 3-month span diluted every
    // truck's coverage below the confidence floor and the fleet card showed $0.
    const rows = [row({ vehicle_id: "t1", day: "2026-08-10" }), row({ vehicle_id: "t1", day: "2026-08-11" })];
    expect(idleRangeDays(rows, "2026-06-01", "2026-08-31")).toBe(2);
  });

  it("still lets the selected span cap it", () => {
    expect(idleRangeDays(week("t1"), "2026-08-10", "2026-08-12")).toBe(3);
  });

  it("never returns zero, so coverage cannot divide by nothing", () => {
    expect(idleRangeDays([], "2026-08-10", "2026-08-16")).toBe(1);
  });
});
