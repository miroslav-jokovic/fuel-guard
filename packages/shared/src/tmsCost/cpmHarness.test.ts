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
    expect(withDeadhead.trucks[0]!.directCpm!).toBeLessThan(without.trucks[0]!.directCpm!);
    expect(without.trucks[0]!.directCpm).toBe(100);
    expect(withDeadhead.trucks[0]!.directCpm).toBeCloseTo(91.1, 1);
  });

  // Two tests that asserted the deadhead caveats' wording went with the caveat machinery at G7.
  // The arithmetic they sat beside is still covered above: the estimate basis lowers the rate,
  // and excluding it raises the rate, both to the cent.
});

describe("computeCpm — overhead allocation", () => {
  const inputs = {
    movements: [move("M1", "101", 1000), move("M2", "202", 3000)],
    fuel: [],
    settlements: [],
    vouchers: [voucher("V1", 4000)],
  };

  // Owner ruling 2026-08-28: the default reversed. Leaving the pool unassigned was the honest
  // choice only while it was a guess assembled from AP vouchers; once it is the income statement
  // minus what was attributed, withholding it reports $1.21/mi for a fleet spending $2.05/mi.
  it("allocates overhead by total miles by default", () => {
    const r = computeCpm(inputs, PLAIN);
    // 1,000 and 3,000 miles → $1,000 and $3,000 of a $4,000 pool. Nothing left over.
    expect(r.trucks.find((t) => t.tractor_unit === "101")!.allocatedOverhead).toBe(1000);
    expect(r.trucks.find((t) => t.tractor_unit === "202")!.allocatedOverhead).toBe(3000);
    expect(r.excluded.unallocatedOverhead).toBe(0);
  });

  // The escape hatch survives the ruling: a reader who wants the direct-only figure can still ask
  // for it, and the caveat still carries the size of what was withheld.
  it("still withholds and reports the pool when the basis is none", () => {
    const r = computeCpm(inputs, { ...PLAIN, overheadBasis: "none" });
    expect(r.trucks.every((t) => t.allocatedOverhead === 0)).toBe(true);
    expect(r.excluded.unallocatedOverhead).toBe(4000);
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
    expect(t101.totalCpm).toBe(round1(t101.directCpm! + t101.allocatedCpm!));
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
  });

  it("counts movements with no truck, whose miles are missing from the denominator", () => {
    const r = computeCpm(
      { movements: [move("M1", "101", 1000), move("M2", null, 5000)], fuel: [], settlements: [] },
      PLAIN,
    );
    expect(r.excluded.movementsWithoutTruck).toBe(1);
    expect(r.fleet.loadedMiles).toBe(1000);
  });

  it("returns null rates rather than dividing by zero on an empty window", () => {
    const r = computeCpm({ movements: [], fuel: [], settlements: [] }, PLAIN);
    expect(r.fleet.trucks).toBe(0);
    expect(r.fleet.totalCpm).toBeNull();
    expect(r.trucks).toEqual([]);
  });

  it("gives a truck with cost but no miles NO rate — null, not Infinity and not a fabricated zero (D-FIN10)", () => {
    // A fuel purchase on a truck that ran no recorded movement. Infinity would poison every rollup;
    // $0.00 would read as cheap. Null is the only honest rate.
    const r = computeCpm({ movements: [], fuel: [fuel("F1", "101", 500)], settlements: [] }, PLAIN);
    expect(r.trucks[0]!.directCpm).toBeNull();
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
    expect(t202.directCpm).toBeNull(); // not computed on loaded miles — that would be a second basis
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

describe("computeCpm — revenue and net per mile (the owner's margin requirement)", () => {
  it("joins GL-booked revenue per truck and nets it against every cost in the report", () => {
    const r = computeCpm(
      {
        movements: [move("M1", "101", 1000)],
        fuel: [fuel("F1", "101", 300)],
        settlements: [settle("S1", "101", 500)],
        revenueByUnit: { "101": 2000 },
        revenueWithoutTruck: 75,
      },
      PLAIN,
    );
    const t = r.trucks[0]!;
    expect(t.revenue).toBe(2000);
    expect(t.revenueCpm).toBe(200);
    // 2000 earned − 300 fuel − 500 pay. The 400 of scheduled fixed cost that used to sit in this
    // sum went with the schedule at G7 (§4): nothing is charged per truck from a contract any more.
    expect(t.netTotal).toBe(1200);
    expect(t.netCpm).toBe(120);
    expect(r.fleet.revenueTotal).toBe(2000);
    expect(r.fleet.netTotal).toBe(1200);
    expect(r.excluded.revenueWithoutTruck).toBe(75);
  });

  it("routes an owner-operator truck's revenue to the excluded pool beside its settlement", () => {
    const r = computeCpm(
      {
        movements: [],
        fuel: [],
        settlements: [settle("S1", "900", 2900, "owner_operator")],
        revenueByUnit: { "900": 4200 },
      },
      PLAIN,
    );
    expect(r.excluded.ownerOperatorRevenue).toBe(4200);
    expect(r.excluded.ownerOperatorSettlement).toBe(2900);
    expect(r.trucks.find((t) => t.tractor_unit === "900")).toBeUndefined();
    // Including owner-operators flips the routing: the truck appears with revenue AND its pay.
    const inc = computeCpm(
      {
        movements: [],
        fuel: [],
        settlements: [settle("S1", "900", 2900, "owner_operator")],
        revenueByUnit: { "900": 4200 },
      },
      { ...PLAIN, includeOwnerOperators: true },
    );
    const t900 = inc.trucks.find((t) => t.tractor_unit === "900")!;
    expect(t900.revenue).toBe(4200);
    expect(t900.netTotal).toBe(1300);
    expect(inc.excluded.ownerOperatorRevenue).toBe(0);
  });

  it("states that net omits unallocated overhead, sized in cents per mile", () => {
    // Only meaningful under the `none` basis now — with overhead allocated there is nothing left
    // for net to omit, which is the point of the 2026-08-28 ruling.
    const r = computeCpm(
      {
        movements: [move("M1", "101", 1000)],
        fuel: [],
        settlements: [],
        vouchers: [voucher("V1", 5000)],
        revenueByUnit: { "101": 3000 },
      },
      { ...PLAIN, overheadBasis: "none" },
    );
    // Net deliberately does NOT subtract the unallocated pool — the caveat carries the size.
    expect(r.trucks[0]!.netTotal).toBe(3000);
  });

  it("under the default basis net subtracts the overhead, because it is no longer unallocated", () => {
    const r = computeCpm(
      {
        movements: [move("M1", "101", 1000)],
        fuel: [],
        settlements: [],
        vouchers: [voucher("V1", 5000)],
        revenueByUnit: { "101": 3000 },
      },
      PLAIN,
    );
    expect(r.trucks[0]!.allocatedOverhead).toBe(5000);
    expect(r.trucks[0]!.netTotal).toBe(-2000); // $3,000 earned against $5,000 of real cost
  });

  it("a truck with revenue but no cost rows in the window still appears", () => {
    const r = computeCpm(
      { movements: [], fuel: [], settlements: [], revenueByUnit: { "777": 1500 } },
      PLAIN,
    );
    const t = r.trucks.find((x) => x.tractor_unit === "777")!;
    expect(t.revenue).toBe(1500);
    expect(t.netTotal).toBe(1500);
    expect(t.netCpm).toBeNull(); // no miles — no fabricated rate
  });

  it("without a revenue input nothing changes and no revenue caveats appear", () => {
    const r = computeCpm(
      { movements: [move("M1", "101", 1000)], fuel: [fuel("F1", "101", 300)], settlements: [] },
      PLAIN,
    );
    expect(r.trucks[0]!.revenue).toBe(0);
    expect(r.fleet.revenueTotal).toBe(0);
  });
});

/**
 * The 2026-08-28 owner rulings, pinned against the numbers that produced them.
 *
 * Every figure quoted in these tests was measured against the McLeod sandbox and the carrier's own
 * June 2026 income statement, not invented for the fixture.
 */
const settleFor = (
  id: string,
  tractor: string | null,
  total_pay: number,
  payee_type: "company_driver" | "owner_operator",
  payee_id: string,
  order_external_id: string,
) =>
  tmsSettlementFactSchema.parse({
    external_id: id,
    company_id: "TMS",
    tractor_unit: tractor,
    payee_type,
    payee_id,
    order_external_id,
    total_pay,
    posted_pay: total_pay,
  });

describe("computeCpm — the GL anchors the overhead pool (owner ruling 2026-08-28)", () => {
  const base = {
    movements: [move("M1", "101", 1000), move("M2", "202", 1000)],
    fuel: [fuel("F1", "101", 300), fuel("F2", "202", 300)],
    settlements: [settle("S1", "101", 200), settle("S2", "202", 200)],
  };

  it("derives the pool by subtraction, so no account can be forgotten", () => {
    // $1,000 attributed (600 fuel + 400 pay) against a $3,000 income statement → $2,000 overhead.
    const r = computeCpm({ ...base, glExpenseTotal: 3000 }, PLAIN);
    expect(r.excluded.overheadSource).toBe("gl_remainder");
    expect(r.trucks[0]!.allocatedOverhead).toBe(1000);
    expect(r.trucks[1]!.allocatedOverhead).toBe(1000);
  });

  // The failure this replaces: the pool was built from AP vouchers, which never see the journal
  // entries this carrier posts its lease and insurance through. June 2026 accounted for $1,992,498
  // of a $3,634,060 income statement and left 38.9% of every dollar outside the report.
  it("beats the voucher build-up, which sees only what passed through AP", () => {
    const withVouchers = { ...base, vouchers: [voucher("V1", 400)] };
    const apOnly = computeCpm(withVouchers, PLAIN);
    const glAnchored = computeCpm({ ...withVouchers, glExpenseTotal: 3000 }, PLAIN);
    expect(apOnly.excluded.overheadSource).toBe("ap_vouchers");
    expect(apOnly.fleet.totalCpm!).toBeLessThan(glAnchored.fleet.totalCpm!);
  });

  it("does not double-count the vouchers that are already inside the GL total", () => {
    const r = computeCpm({ ...base, vouchers: [voucher("V1", 400)], glExpenseTotal: 3000 }, PLAIN);
    // $2,000, not $2,400 — the pool REPLACES the build-up rather than adding to it.
    expect(r.trucks.reduce((a, t) => a + t.allocatedOverhead, 0)).toBe(2000);
  });

  // Fuel advanced to an owner-operator is a receivable in McLeod (account 17000000), never an
  // expense, so the GL total never contained it — but our EFS feed booked it as cost. Subtracting
  // it as though the ledger knew about it would shrink the pool by money the P&L never held.
  it("adds owner-operator fuel back, because the income statement never carried it", () => {
    const withOwnerOp = {
      movements: [move("M1", "101", 1000), move("M2", "999", 1000)],
      fuel: [fuel("F1", "101", 300), fuel("F2", "999", 500)],
      settlements: [settle("S1", "101", 200), settle("S2", "999", 900, "owner_operator")],
      glExpenseTotal: 3000,
    };
    const r = computeCpm(withOwnerOp, PLAIN);
    // 3000 − attributed(300 + 500 + 200) − ownerOpPay(900) + ownerOpFuel(500) = 1600.
    expect(r.trucks.find((t) => t.tractor_unit === "101")!.allocatedOverhead).toBe(1600);
  });

  it("refuses a negative remainder rather than spreading a credit across trucks", () => {
    const r = computeCpm({ ...base, glExpenseTotal: 500 }, PLAIN);
    expect(r.excluded.overheadSource).toBe("ap_vouchers"); // fell back, did not go negative
    expect(r.trucks.every((t) => t.allocatedOverhead >= 0)).toBe(true);
  });
});

describe("computeCpm — a mixed truck splits by settlement, not by unit", () => {
  /**
   * Measured June 2026: five owner-operator payees ran eight tractors, and four of those tractors
   * were also driven by a company driver in the same month. Unit-level classification sent 100% of
   * such a truck's revenue to the owner-operator pool while its company driver's pay stayed in the
   * truck's cost column — so the truck showed cost against no revenue.
   */
  const mixed = {
    movements: [move("M1", "751", 1000)],
    fuel: [],
    settlements: [
      settleFor("S1", "751", 900, "owner_operator", "SCORELIL", "ORD-OO"),
      settleFor("S2", "751", 300, "company_driver", "DRIVER1", "ORD-CO"),
    ],
    revenueBills: [
      { tractor_unit: "751", order_external_id: "ORD-OO", dollars: 1000 },
      { tractor_unit: "751", order_external_id: "ORD-CO", dollars: 400 },
    ],
  };

  it("keeps the company load's revenue on the truck that earned it", () => {
    const r = computeCpm(mixed, PLAIN);
    const t = r.trucks.find((x) => x.tractor_unit === "751")!;
    expect(t.revenue).toBe(400); // the company order only
    expect(t.directSettlement).toBe(300); // and the company driver's pay only
  });

  it("routes the owner-operator load's revenue to its own pool", () => {
    const r = computeCpm(mixed, PLAIN);
    expect(r.excluded.ownerOperatorRevenue).toBe(1000);
    expect(r.excluded.ownerOperatorSettlement).toBe(900);
  });

  // The regression: under unit-grain the whole $1,400 left the truck and its $300 of company pay
  // stayed, printing cost against no revenue.
  it("the old unit-grain path still shows the distortion it was replaced for", () => {
    const unitGrain = computeCpm(
      { ...mixed, revenueBills: undefined, revenueByUnit: { "751": 1400 } },
      PLAIN,
    );
    const t = unitGrain.trucks.find((x) => x.tractor_unit === "751")!;
    expect(t.revenue).toBe(0);
    expect(t.directSettlement).toBe(300);
  });
});

describe("computeCpm — owner-operator deals are read back, not configured", () => {
  /** Real June 2026 rates: SCORELIL settles at 95%, SWISSANM at 88%. */
  const inputs = {
    movements: [],
    fuel: [],
    settlements: [
      settleFor("S1", "762", 9500, "owner_operator", "SCORELIL", "ORD-A"),
      settleFor("S2", "512", 8800, "owner_operator", "SWISSANM", "ORD-B"),
    ],
    revenueBills: [
      { tractor_unit: "762", order_external_id: "ORD-A", dollars: 10000 },
      { tractor_unit: "512", order_external_id: "ORD-B", dollars: 10000 },
    ],
  };

  it("derives each payee's own percentage from what actually settled", () => {
    const r = computeCpm(inputs, PLAIN);
    const scorelil = r.ownerOperators.find((o) => o.payeeId === "SCORELIL")!;
    const swissanm = r.ownerOperators.find((o) => o.payeeId === "SWISSANM")!;
    expect(scorelil.dealPct).toBe(95);
    expect(swissanm.dealPct).toBe(88);
  });

  it("states the carrier's gross margin per payee, which is the earning they actually produce", () => {
    const r = computeCpm(inputs, PLAIN);
    expect(r.ownerOperators.find((o) => o.payeeId === "SCORELIL")!.grossMargin).toBe(500);
    expect(r.ownerOperators.find((o) => o.payeeId === "SWISSANM")!.grossMargin).toBe(1200);
  });

  it("reads no deal rather than a round number when the loads carry no revenue", () => {
    const r = computeCpm({ ...inputs, revenueBills: [] }, PLAIN);
    expect(r.ownerOperators.every((o) => o.dealPct === null)).toBe(true);
  });

  it("names the trucks each payee ran, so a shared tractor is visible", () => {
    const r = computeCpm(inputs, PLAIN);
    expect(r.ownerOperators.find((o) => o.payeeId === "SCORELIL")!.units).toEqual(["762"]);
  });
});

describe("computeCpm — deduction income reaches the contractor margin", () => {
  const inputs = {
    movements: [],
    fuel: [],
    settlements: [settleFor("S1", "762", 9500, "owner_operator", "SCORELIL", "ORD-A")],
    revenueBills: [{ tractor_unit: "762", order_external_id: "ORD-A", dollars: 10000 }],
  };

  it("adds revenue-account deductions on top of the retained load share", () => {
    // $500 kept of the load, plus $1,200 of equipment rental and insurance collection.
    const r = computeCpm({ ...inputs, ownerOperatorDeductionIncome: { SCORELIL: 1200 } }, PLAIN);
    const o = r.ownerOperators[0]!;
    expect(o.grossMargin).toBe(500);
    expect(o.deductionIncome).toBe(1200);
    expect(o.netMargin).toBe(1700);
  });

  it("leaves the margin alone when a payee has no deduction income", () => {
    const r = computeCpm(inputs, PLAIN);
    expect(r.ownerOperators[0]!.deductionIncome).toBe(0);
    expect(r.ownerOperators[0]!.netMargin).toBe(500);
  });

  // The caller passes ONLY revenue-account dollars. A `Fuel Advance` repayment is a receivable
  // settling and an expense-account credit already reduced that expense in the ledger — both would
  // invent earnings, and the classification lives with the chart of accounts, not here.
  it("credits only the payee it is keyed to", () => {
    const two = {
      ...inputs,
      settlements: [
        ...inputs.settlements,
        settleFor("S2", "512", 8800, "owner_operator", "SWISSANM", "ORD-B"),
      ],
      revenueBills: [
        ...inputs.revenueBills,
        { tractor_unit: "512", order_external_id: "ORD-B", dollars: 10000 },
      ],
      ownerOperatorDeductionIncome: { SCORELIL: 1200 },
    };
    const r = computeCpm(two, PLAIN);
    expect(r.ownerOperators.find((o) => o.payeeId === "SCORELIL")!.netMargin).toBe(1700);
    expect(r.ownerOperators.find((o) => o.payeeId === "SWISSANM")!.netMargin).toBe(1200);
  });
});

describe("computeCpm — a truck without miles has no rate, and the fleet rate is over measured trucks (D-FIN10)", () => {
  it("prints null, never $0.00, for a truck with cost and no miles — and sorts it last", () => {
    const r = computeCpm(
      {
        movements: [move("M1", "101", 1000)],
        fuel: [fuel("F1", "101", 300), fuel("F2", "202", 1000)],
        settlements: [],
        actualMilesByUnit: { "101": 1000 },
      },
      PLAIN,
    );
    const idle = r.trucks.find((t) => t.tractor_unit === "202")!;
    expect(idle.directTotal).toBe(1000); // the dollars are real
    expect(idle.directCpm).toBeNull();
    expect(idle.totalCpm).toBeNull();
    expect(idle.netCpm).toBeNull();
    expect(r.trucks[r.trucks.length - 1]!.tractor_unit).toBe("202");
  });

  it("keeps unmeasured dollars out of the fleet rate and names them as their own line", () => {
    const r = computeCpm(
      {
        movements: [move("M1", "101", 1000)],
        fuel: [fuel("F1", "101", 300), fuel("F2", "202", 1000)],
        settlements: [settle("S1", "202", 500)],
        actualMilesByUnit: { "101": 1000 },
        revenueByUnit: { "101": 2000, "202": 700 },
      },
      PLAIN,
    );
    // Fleet rate: truck 101 only — $300 over 1,000 miles, not $1,800.
    expect(r.fleet.directCpm).toBe(30);
    expect(r.fleet.revenueCpm).toBe(200);
    expect(r.fleet.netCpm).toBe(170);
    // Totals still cover every truck, so the tie-out is untouched.
    expect(r.fleet.directTotal).toBe(1800);
    expect(r.fleet.revenueTotal).toBe(2700);
    expect(r.fleet.unmeasured).toEqual({ trucks: 1, directTotal: 1500, fixedTotal: 0, allocatedTotal: 0, revenueTotal: 700 });
  });

  it("applies the same rule under the estimate basis, and reads null when no truck has miles at all", () => {
    const r = computeCpm({ movements: [], fuel: [fuel("F1", "101", 100)], settlements: [] }, PLAIN);
    expect(r.trucks[0]!.directCpm).toBeNull();
    expect(r.fleet.directCpm).toBeNull();
    expect(r.fleet.unmeasured.trucks).toBe(1);
  });
});
