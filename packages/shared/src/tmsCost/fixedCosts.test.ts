import { describe, it, expect } from "vitest";
import { sumFixedCosts, fixedCostCaveats, truckCostScheduleSchema, type TruckCostScheduleRow } from "./index.js";

const row = (over: Partial<TruckCostScheduleRow>): TruckCostScheduleRow => ({
  id: "r1",
  unit_number: "1234",
  category: "lease",
  label: "VIP Lease unit 1234",
  monthly_amount: 2500,
  effective_from: "2026-01-01",
  effective_to: null,
  notes: null,
  ...over,
});

const JUNE = [{ year: 2026, month: 6 }];

describe("sumFixedCosts", () => {
  it("charges a covering row whole for each window month, keyed by unit and category", () => {
    const s = sumFixedCosts(
      [row({}), row({ id: "r2", category: "insurance", monthly_amount: 1100.5 })],
      [
        { year: 2026, month: 6 },
        { year: 2026, month: 7 },
      ],
    );
    expect(s.byUnit["1234"]).toBe(7201);
    expect(s.byCategory["lease"]).toBe(5000);
    expect(s.byCategory["insurance"]).toBe(2201);
    expect(s.total).toBe(7201);
    expect(s.monthCount).toBe(2);
  });

  it("the range is half-open: effective_to's month is NOT charged, effective_from's is", () => {
    const s = sumFixedCosts([row({ effective_from: "2026-06-01", effective_to: "2026-07-01" })], [
      { year: 2026, month: 5 },
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
    ]);
    expect(s.byUnit["1234"]).toBe(2500);
  });

  it("a row starting after the month or ended before it charges nothing", () => {
    const s = sumFixedCosts(
      [row({ effective_from: "2026-07-01" }), row({ id: "r2", effective_from: "2026-01-01", effective_to: "2026-06-01" })],
      JUNE,
    );
    expect(s.total).toBe(0);
    expect(s.byUnit).toEqual({});
  });

  it("trims unit numbers so ' 1234' and '1234' charge the same bucket the harness reads", () => {
    const s = sumFixedCosts([row({}), row({ id: "r2", unit_number: " 1234 " })], JUNE);
    expect(Object.keys(s.byUnit)).toEqual(["1234"]);
    expect(s.byUnit["1234"]).toBe(5000);
  });
});

describe("fixedCostCaveats", () => {
  it("an empty schedule produces the not-in-these-figures caveat and nothing else", () => {
    const caveats = fixedCostCaveats(sumFixedCosts([], JUNE), 3);
    expect(caveats).toHaveLength(1);
    expect(caveats[0]).toMatch(/NOT in these figures/);
  });

  it("a populated schedule states per-category totals and names uncovered active trucks", () => {
    const caveats = fixedCostCaveats(sumFixedCosts([row({})], JUNE), 2);
    expect(caveats[0]).toMatch(/lease \$2500\.00/);
    expect(caveats[0]).toMatch(/contracts, not measurements/);
    expect(caveats[1]).toMatch(/2 truck\(s\) with activity/);
  });
});

describe("truckCostScheduleSchema", () => {
  it("refuses a mid-month effective date before the DB constraint would", () => {
    const bad = truckCostScheduleSchema.safeParse({
      unit_number: "1234",
      category: "lease",
      label: "x",
      monthly_amount: 100,
      effective_from: "2026-06-15",
    });
    expect(bad.success).toBe(false);
  });

  it("refuses an unknown category and a non-positive amount", () => {
    expect(
      truckCostScheduleSchema.safeParse({
        unit_number: "1234",
        category: "fuel",
        label: "x",
        monthly_amount: 100,
        effective_from: "2026-06-01",
      }).success,
    ).toBe(false);
    expect(
      truckCostScheduleSchema.safeParse({
        unit_number: "1234",
        category: "lease",
        label: "x",
        monthly_amount: 0,
        effective_from: "2026-06-01",
      }).success,
    ).toBe(false);
  });
});
