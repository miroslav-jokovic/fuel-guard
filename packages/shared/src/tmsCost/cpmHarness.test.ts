import { describe, it, expect } from "vitest";
import {
  computeCpm,
  DEFAULT_CPM_RULES,
  tmsMovementFactSchema,
  tmsFuelPurchaseFactSchema,
  tmsSettlementFactSchema,
  tmsApVoucherFactSchema,
  type CpmRules,
  type TmsMovementFact,
} from "./index.js";

const ATL = { lat: 33.749, lon: -84.388 };
const BNA = { lat: 36.1627, lon: -86.7816 };
const MEM = { lat: 35.1495, lon: -90.049 };

const move = (
  id: string,
  tractor: string | null,
  miles: number,
  settled: string | null = "2026-06-01T00:00:00Z",
  stops: Array<{
    seq: number;
    kind: "pickup" | "dropoff";
    lat: number;
    lon: number;
    departed_at?: string;
  }> = [],
): TmsMovementFact =>
  tmsMovementFactSchema.parse({
    external_id: id,
    company_id: "TMS",
    tractor_unit: tractor,
    loaded_miles: miles,
    settled_at: settled,
    stops,
  });

const fuel = (id: string, tractor: string | null, settled_amount: number) =>
  tmsFuelPurchaseFactSchema.parse({
    external_id: id,
    company_id: "TMS",
    tractor_unit: tractor,
    settled_amount,
  });

const settle = (
  id: string,
  tractor: string | null,
  total_pay: number,
  payee_type: "company_driver" | "owner_operator" = "company_driver",
  posted_pay = total_pay,
) =>
  tmsSettlementFactSchema.parse({
    external_id: id,
    company_id: "TMS",
    tractor_unit: tractor,
    payee_type,
    total_pay,
    posted_pay,
  });

const voucher = (id: string, amount: number, ap_glid: string | null = "20000000") =>
  tmsApVoucherFactSchema.parse({ external_id: id, company_id: "TMS", amount, ap_glid });

/** No deadhead, no overhead: the simplest case where the arithmetic is checkable by hand. */
const PLAIN: CpmRules = { ...DEFAULT_CPM_RULES, deadhead: "exclude" };

describe("computeCpm — direct cost", () => {
  it("computes cents per mile from fuel and settlement on one truck", () => {
    // 1,000 loaded miles, $400 fuel + $200 pay = $600 → 60.0¢/mi.
    const r = computeCpm(
      {
        movements: [move("M1", "101", 1000)],
        fuel: [fuel("F1", "101", 400)],
        settlements: [settle("S1", "101", 200)],
      },
      PLAIN,
    );
    expect(r.trucks).toHaveLength(1);
    expect(r.trucks[0]!.directTotal).toBe(600);
    expect(r.trucks[0]!.directCpm).toBe(60);
    expect(r.fleet.directCpm).toBe(60);
  });

  it("keeps trucks separate and ranks the most expensive first", () => {
    const r = computeCpm(
      {
        movements: [move("M1", "101", 1000), move("M2", "202", 1000)],
        fuel: [fuel("F1", "101", 400), fuel("F2", "202", 900)],
        settlements: [],
      },
      PLAIN,
    );
    expect(r.trucks.map((t) => t.tractor_unit)).toEqual(["202", "101"]);
    expect(r.trucks[0]!.directCpm).toBe(90);
    expect(r.trucks[1]!.directCpm).toBe(40);
  });

  it("uses settled_amount for fuel, not the gross before discount", () => {
    // C2: total_amount is gross; direct/funded is what the carrier owed and what reconciles.
    // A harness reading total_amount would overstate fuel by the card discount — 14.6% in June 2026.
    const gross = tmsFuelPurchaseFactSchema.parse({
      external_id: "F1",
      company_id: "TMS",
      tractor_unit: "101",
      total_amount: 1000,
      fuel_discount: 146,
      settled_amount: 854,
    });
    const r = computeCpm({ movements: [move("M1", "101", 1000)], fuel: [gross], settlements: [] }, PLAIN);
    expect(r.trucks[0]!.directFuel).toBe(854);
  });

  it("uses total_pay for settlement, not the accrual the ledger recorded", () => {
    // D-MC24: posted_pay reconciles; total_pay is what the payee actually received.
    const r = computeCpm(
      {
        movements: [move("M1", "101", 1000)],
        fuel: [],
        settlements: [settle("S1", "101", 500, "company_driver", 450)],
      },
      PLAIN,
    );
    expect(r.trucks[0]!.directSettlement).toBe(500);
  });
});

describe("computeCpm — deadhead", () => {
  // `departed_at` on the final delivery is what orders the chain. Settle dates are deliberately
  // IDENTICAL here: McLeod settles in batches, so 70% of real consecutive pairs share one, and a
  // fixture with distinct settle dates would sort correctly even under the bug this pins.
  const twoTrips = [
    move("M1", "101", 1000, "2026-06-15T09:15:44Z", [
      { seq: 1, kind: "pickup", ...ATL },
      { seq: 2, kind: "dropoff", ...BNA, departed_at: "2026-06-01T12:00:00Z" },
    ]),
    move("M2", "101", 1000, "2026-06-15T09:15:44Z", [
      { seq: 1, kind: "pickup", ...MEM },
      { seq: 2, kind: "dropoff", ...ATL, departed_at: "2026-06-03T12:00:00Z" },
    ]),
  ];

  it("adds estimated empty miles to the denominator, lowering cost per mile", () => {
    // Nashville → Memphis is 196.3244 great-circle miles (cross-checked in movementFact.test.ts).
    const withDeadhead = computeCpm(
      { movements: twoTrips, fuel: [fuel("F1", "101", 2000)], settlements: [] },
      { ...DEFAULT_CPM_RULES, deadhead: "estimate" },
    );
    const without = computeCpm(
      { movements: twoTrips, fuel: [fuel("F1", "101", 2000)], settlements: [] },
      PLAIN,
    );
    expect(without.trucks[0]!.totalMiles).toBe(2000);
    expect(withDeadhead.trucks[0]!.deadheadMilesEstimated).toBeCloseTo(196.32, 1);
    expect(withDeadhead.trucks[0]!.totalMiles).toBeCloseTo(2196.32, 1);
    // More miles for the same money must mean a LOWER cost per mile.
    expect(withDeadhead.trucks[0]!.directCpm).toBeLessThan(without.trucks[0]!.directCpm);
    expect(without.trucks[0]!.directCpm).toBe(100);
    expect(withDeadhead.trucks[0]!.directCpm).toBeCloseTo(91.1, 1);
  });

  it("warns that excluding deadhead overstates every figure", () => {
    const r = computeCpm({ movements: twoTrips, fuel: [], settlements: [] }, PLAIN);
    expect(r.caveats.some((c) => c.includes("EXCLUDED") && c.includes("overstated"))).toBe(true);
  });

  it("warns that estimated deadhead is inferred, not read from McLeod", () => {
    const r = computeCpm({ movements: twoTrips, fuel: [], settlements: [] }, DEFAULT_CPM_RULES);
    expect(r.caveats.some((c) => c.includes("ESTIMATED"))).toBe(true);
  });
});

describe("computeCpm — overhead allocation", () => {
  const inputs = {
    movements: [move("M1", "101", 1000), move("M2", "202", 3000)],
    fuel: [],
    settlements: [],
    vouchers: [voucher("V1", 4000)],
  };

  it("assigns NO overhead by default, and says so loudly", () => {
    // The default is deliberately understated-and-known rather than allocated-and-invented.
    const r = computeCpm(inputs, PLAIN);
    expect(r.trucks.every((t) => t.allocatedOverhead === 0)).toBe(true);
    expect(r.excluded.unallocatedOverhead).toBe(4000);
    expect(r.caveats.some((c) => c.includes("EXCLUDES") && c.includes("4000.00"))).toBe(true);
  });

  it("spreads overhead by miles when the rule says so", () => {
    // 1,000 and 3,000 miles → $1,000 and $3,000 of a $4,000 pool.
    const r = computeCpm(inputs, { ...PLAIN, overheadBasis: "loaded_miles" });
    const t101 = r.trucks.find((t) => t.tractor_unit === "101")!;
    const t202 = r.trucks.find((t) => t.tractor_unit === "202")!;
    expect(t101.allocatedOverhead).toBe(1000);
    expect(t202.allocatedOverhead).toBe(3000);
    expect(t101.allocatedCpm).toBe(100);
    expect(t202.allocatedCpm).toBe(100);
    expect(r.excluded.unallocatedOverhead).toBe(0);
  });

  it("spreads overhead evenly when the rule says per truck", () => {
    // The same $4,000 lands very differently: the low-mileage truck absorbs half.
    const r = computeCpm(inputs, { ...PLAIN, overheadBasis: "equal_per_truck" });
    const t101 = r.trucks.find((t) => t.tractor_unit === "101")!;
    expect(t101.allocatedOverhead).toBe(2000);
    expect(t101.allocatedCpm).toBe(200);
  });

  it("keeps direct and allocated apart at every level", () => {
    const r = computeCpm(
      { ...inputs, fuel: [fuel("F1", "101", 500)] },
      { ...PLAIN, overheadBasis: "loaded_miles" },
    );
    const t101 = r.trucks.find((t) => t.tractor_unit === "101")!;
    expect(t101.directTotal).toBe(500);
    expect(t101.allocatedOverhead).toBe(1000);
    expect(t101.totalCpm).toBe(round1(t101.directCpm + t101.allocatedCpm));
  });

  it("excludes vouchers outside the configured accounts rather than pooling them", () => {
    const r = computeCpm(
      { ...inputs, vouchers: [voucher("V1", 4000, "20000000"), voucher("V2", 9999, "61000000")] },
      { ...PLAIN, overheadBasis: "loaded_miles", overheadAccounts: ["20000000"] },
    );
    expect(r.excluded.outOfScopeVouchers).toBe(9999);
    const t101 = r.trucks.find((t) => t.tractor_unit === "101")!;
    expect(t101.allocatedOverhead).toBe(1000);
  });
});

describe("computeCpm — the honesty ledger", () => {
  it("excludes owner-operators by default and reports their pool separately", () => {
    // D-MC20: an owner-operator payment bundles truck, fuel and maintenance into one rate.
    const r = computeCpm(
      {
        movements: [move("M1", "101", 1000)],
        fuel: [],
        settlements: [settle("S1", "101", 300), settle("S2", "101", 2900, "owner_operator")],
      },
      PLAIN,
    );
    expect(r.trucks[0]!.directSettlement).toBe(300);
    expect(r.excluded.ownerOperatorSettlement).toBe(2900);
    expect(r.caveats.some((c) => c.includes("owner-operator"))).toBe(true);
  });

  it("includes owner-operators only when explicitly asked", () => {
    const r = computeCpm(
      {
        movements: [move("M1", "101", 1000)],
        fuel: [],
        settlements: [settle("S2", "101", 2900, "owner_operator")],
      },
      { ...PLAIN, includeOwnerOperators: true },
    );
    expect(r.trucks[0]!.directSettlement).toBe(2900);
    expect(r.excluded.ownerOperatorSettlement).toBe(0);
  });

  it("excludes untruck-able cost rather than spreading it over trucks that have one", () => {
    // Silently spreading this would inflate every truck by cost McLeod never placed.
    const r = computeCpm(
      {
        movements: [move("M1", "101", 1000)],
        fuel: [fuel("F1", "101", 100), fuel("F2", null, 750)],
        settlements: [settle("S1", null, 250)],
      },
      PLAIN,
    );
    expect(r.trucks[0]!.directFuel).toBe(100);
    expect(r.excluded.fuelWithoutTruck).toBe(750);
    expect(r.excluded.settlementWithoutTruck).toBe(250);
    expect(r.caveats.some((c) => c.includes("no ") && c.includes("tractor"))).toBe(true);
  });

  it("counts movements with no truck, whose miles are missing from the denominator", () => {
    const r = computeCpm(
      { movements: [move("M1", "101", 1000), move("M2", null, 5000)], fuel: [], settlements: [] },
      PLAIN,
    );
    expect(r.excluded.movementsWithoutTruck).toBe(1);
    expect(r.fleet.loadedMiles).toBe(1000);
  });

  it("returns zeroes rather than dividing by zero on an empty window", () => {
    const r = computeCpm({ movements: [], fuel: [], settlements: [] }, PLAIN);
    expect(r.fleet.trucks).toBe(0);
    expect(r.fleet.totalCpm).toBe(0);
    expect(r.trucks).toEqual([]);
  });

  it("gives a truck with cost but no miles a zero rate rather than Infinity", () => {
    // A fuel purchase on a truck that ran no recorded movement. Infinity would poison every rollup.
    const r = computeCpm({ movements: [], fuel: [fuel("F1", "101", 500)], settlements: [] }, PLAIN);
    expect(Number.isFinite(r.trucks[0]!.directCpm)).toBe(true);
    expect(r.trucks[0]!.directCpm).toBe(0);
    expect(r.trucks[0]!.directFuel).toBe(500);
  });
});

/** Cents are reported to one decimal; comparing a sum needs the same rounding. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

describe("computeCpm — the Samsara miles basis (owner ruling 2026-08-27)", () => {
  it("divides by measured miles when they exist, fleet-wide, and states the basis", () => {
    const r = computeCpm(
      {
        movements: [move("M1", "101", 900)],
        fuel: [fuel("F1", "101", 600)],
        settlements: [settle("S1", "101", 400)],
        // Measured 1,000 mi against 900 loaded: the 100-mile gap IS the measured empty share.
        actualMilesByUnit: { "101": 1000 },
      },
      PLAIN,
    );
    expect(r.milesBasis).toBe("samsara_actual");
    const t = r.trucks[0]!;
    expect(t.actualMiles).toBe(1000);
    expect(t.totalMiles).toBe(1000);
    expect(t.loadedMiles).toBe(900);
    expect(t.deadheadMilesEstimated).toBe(0);
    expect(t.directCpm).toBe(100); // $1,000 over 1,000 measured miles
    expect(r.caveats.some((c) => c.includes("Samsara GPS actuals"))).toBe(true);
    expect(r.caveats.some((c) => c.includes("11.1% above loaded"))).toBe(true);
  });

  it("a truck with cost but no measured miles gets NO rate, and the report names it — never a mixed basis", () => {
    const r = computeCpm(
      {
        movements: [move("M1", "101", 900), move("M2", "202", 500)],
        fuel: [fuel("F1", "101", 600), fuel("F2", "202", 300)],
        settlements: [],
        actualMilesByUnit: { "101": 1000 }, // 202 has McLeod activity but no Samsara miles
      },
      PLAIN,
    );
    const t202 = r.trucks.find((t) => t.tractor_unit === "202")!;
    expect(t202.actualMiles).toBe(0);
    expect(t202.totalMiles).toBe(0);
    expect(t202.directCpm).toBe(0); // not computed on loaded miles — that would be a second basis
    expect(r.caveats.some((c) => c.includes("no Samsara miles"))).toBe(true);
    // The fleet denominator is measured miles only; 202's loaded 500 never enters it.
    expect(r.fleet.totalMiles).toBe(1000);
  });

  it("a measured truck with no settled movements still appears — its miles were driven", () => {
    const r = computeCpm(
      { movements: [], fuel: [], settlements: [], actualMilesByUnit: { "303": 800 } },
      PLAIN,
    );
    expect(r.trucks).toHaveLength(1);
    expect(r.trucks[0]!.totalMiles).toBe(800);
  });

  it("without measured miles the harness falls back to the estimate basis and says so", () => {
    const r = computeCpm(
      { movements: [move("M1", "101", 900)], fuel: [], settlements: [], actualMilesByUnit: {} },
      PLAIN,
    );
    expect(r.milesBasis).toBe("mcleod_loaded_plus_deadhead_estimate");
    expect(r.trucks[0]!.actualMiles).toBeNull();
    expect(r.trucks[0]!.totalMiles).toBe(900);
  });
});

describe("computeCpm — fixed costs from the office schedule (T1)", () => {
  const fixedCosts = (byUnit: Record<string, number>, byCategory: Record<string, number>, monthCount = 1) => ({
    byUnit,
    byCategory,
    total: Object.values(byUnit).reduce((a, b) => a + b, 0),
    monthCount,
  });

  it("charges the schedule in its own column and adds it to total CPM, never to direct", () => {
    const r = computeCpm(
      {
        movements: [move("M1", "101", 1000)],
        fuel: [fuel("F1", "101", 300)],
        settlements: [settle("S1", "101", 500)],
        fixedCosts: fixedCosts({ "101": 2500 }, { lease: 2500 }),
      },
      PLAIN,
    );
    const t = r.trucks[0]!;
    expect(t.fixedCost).toBe(2500);
    expect(t.directTotal).toBe(800); // fixed never blends into the measured figure
    expect(t.directCpm).toBe(80);
    expect(t.fixedCpm).toBe(250);
    expect(t.totalCpm).toBe(330);
    expect(r.fleet.fixedTotal).toBe(2500);
    expect(r.caveats.some((c) => c.includes("contracts, not measurements"))).toBe(true);
  });

  it("a scheduled truck with no activity appears with its fixed cost and zero miles", () => {
    const r = computeCpm(
      {
        movements: [move("M1", "101", 1000)],
        fuel: [],
        settlements: [],
        fixedCosts: fixedCosts({ "999": 3000 }, { lease: 3000 }),
      },
      PLAIN,
    );
    const idle = r.trucks.find((t) => t.tractor_unit === "999")!;
    expect(idle.fixedCost).toBe(3000);
    expect(idle.totalMiles).toBe(0);
    expect(idle.totalCpm).toBe(0); // no denominator — cost shown, rate not fabricated
  });

  it("names how many active trucks the schedule does not cover", () => {
    const r = computeCpm(
      {
        movements: [move("M1", "101", 1000), move("M2", "202", 500)],
        fuel: [],
        settlements: [],
        fixedCosts: fixedCosts({ "101": 2500 }, { lease: 2500 }),
      },
      PLAIN,
    );
    expect(r.caveats.some((c) => c.includes("1 truck(s) with activity"))).toBe(true);
  });

  it("an empty schedule keeps full CPM equal to direct CPM and says so; no schedule input, no caveat", () => {
    const withEmpty = computeCpm(
      {
        movements: [move("M1", "101", 1000)],
        fuel: [fuel("F1", "101", 300)],
        settlements: [],
        fixedCosts: fixedCosts({}, {}),
      },
      PLAIN,
    );
    expect(withEmpty.trucks[0]!.totalCpm).toBe(withEmpty.trucks[0]!.directCpm);
    expect(withEmpty.caveats.some((c) => c.includes("NOT in these figures"))).toBe(true);
    const without = computeCpm(
      { movements: [move("M1", "101", 1000)], fuel: [], settlements: [] },
      PLAIN,
    );
    expect(without.caveats.some((c) => c.includes("fixed-cost"))).toBe(false);
  });
});
