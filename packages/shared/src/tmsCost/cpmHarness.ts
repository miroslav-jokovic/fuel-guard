import { inferDeadheadLegs } from "./movementFact.js";
import { buildCpmCaveats } from "./cpmCaveats.js";
import { apportionByWeight } from "./apportion.js";
import { buildGlTieOut } from "./cpmTieOut.js";
import { summariseFleet } from "./cpmFleet.js";
import type { SettlementPayeeType } from "./settlementFact.js";
import {
  classifyOwnerOperatorUnits,
  accumulateOwnerOperatorPay,
  creditOwnerOperatorRevenue,
  summariseOwnerOperators,
} from "./ownerOperators.js";
import {
  DEFAULT_CPM_RULES,
  type CpmRules,
  type CpmInputs,
  type CpmReport,
  type TruckCpm,
  type MilesBasis,
} from "./cpmContract.js";

/**
 * Cents per mile, per truck — the harness C1 through C4 were built to feed.
 *
 * **This file is a different kind of thing from the four that precede it, and the difference is the
 * most important comment in it.** C1–C4 extract: McLeod decides the answer and the general ledger
 * proves whether we read it correctly, which is why each of those sweeps can say "$0.00 difference"
 * and mean it. This file ALLOCATES, and allocation has no ground truth in the source. There is no
 * query that reveals what share of the insurance premium belongs to truck 1234.
 *
 * So the design goal here is not accuracy — it is **auditability**. Every figure this produces is
 * traceable to either a fact McLeod asserted or a rule someone chose, the two are never added
 * together into a single number, and the rule is passed in rather than baked in. A CPM figure whose
 * assumptions are invisible is worse than no CPM figure, because it gets quoted.
 *
 * Direct cost is measured. Allocated cost is a policy. The output keeps them apart at every level.
 */


const round = (n: number) => Math.round(n * 100) / 100;
/**
 * Cents, to one decimal — beyond that is false precision on an allocated number. NULL when there
 * are no miles to divide by (D-FIN10): a truck with $1,000 of fuel and no measured miles used to
 * print $0.00 per mile, which is a plausible number and a wrong one, and only the collapsed
 * explainer said "not computed". Null cannot be mistaken for cheap.
 */
const cents = (dollars: number, miles: number): number | null =>
  miles <= 0 ? null : Math.round((dollars / miles) * 100 * 10) / 10;

interface Bucket {
  tractor_unit: string;
  movements: number;
  loadedMiles: number;
  deadheadMiles: number;
  fuel: number;
  settlement: number;
}

function bucketFor(map: Map<string, Bucket>, unit: string): Bucket {
  let b = map.get(unit);
  if (!b) {
    b = { tractor_unit: unit, movements: 0, loadedMiles: 0, deadheadMiles: 0, fuel: 0, settlement: 0 };
    map.set(unit, b);
  }
  return b;
}

/**
 * Compute cost per mile per truck.
 *
 * Pure: no clock, no randomness, no I/O. Feed it a window's facts and the rules, get a report.
 *
 * The arithmetic is deliberately boring. What is worth reviewing is which cost lands where:
 *
 *  · **Fuel** uses `settled_amount` — what the carrier actually owed after the card discount, and the
 *    figure C2 reconciled to the ledger to the cent. Using `total_amount` would overstate fuel by the
 *    discount, 14.6% in June 2026.
 *  · **Settlement** uses `total_pay` — what the payee received — not `posted_pay`, which is the
 *    accrual the ledger recorded and is a reconciliation figure rather than a cost (D-MC24).
 *  · **Overhead** is AP vouchers plus office settlements, and it is spread only if a basis says so.
 *  · **Anything without a truck is excluded and counted**, never spread silently across trucks that
 *    happen to have one.
 */
export function computeCpm(inputs: CpmInputs, rules: CpmRules = DEFAULT_CPM_RULES): CpmReport {
  const buckets = new Map<string, Bucket>();
  const caveats: string[] = [];

  // One basis per report (owner ruling 2026-08-27): Samsara measured miles when the window has
  // them, the McLeod estimate otherwise — decided fleet-wide, stated in the output, never mixed
  // per truck.
  const actualByUnit = inputs.actualMilesByUnit ?? {};
  const useActual = Object.keys(actualByUnit).length > 0;
  const milesBasis: MilesBasis = useActual ? "samsara_actual" : "mcleod_loaded_plus_deadhead_estimate";

  let movementsWithoutTruck = 0;
  for (const m of inputs.movements) {
    if (!m.tractor_unit) {
      movementsWithoutTruck++;
      continue;
    }
    const b = bucketFor(buckets, m.tractor_unit);
    b.movements++;
    b.loadedMiles = round(b.loadedMiles + (m.loaded_miles ?? 0));
  }

  if (useActual) {
    // A truck Samsara measured that settled no movement still ran — its miles (and any fuel it
    // burned) belong in the report, not silently outside it.
    for (const unit of Object.keys(actualByUnit)) bucketFor(buckets, unit);
  } else if (rules.deadhead === "estimate") {
    for (const leg of inferDeadheadLegs(inputs.movements)) {
      const b = bucketFor(buckets, leg.tractor_unit);
      b.deadheadMiles = round(b.deadheadMiles + leg.miles);
    }
  }

  // A scheduled truck that ran nothing still costs its lease — it belongs in the report with its
  // fixed cost and zero miles, not silently outside it.
  const fixedByUnit = inputs.fixedCosts?.byUnit ?? {};
  for (const unit of Object.keys(fixedByUnit)) bucketFor(buckets, unit);

  let fuelWithoutTruck = 0;
  for (const f of inputs.fuel) {
    if (!f.tractor_unit) {
      fuelWithoutTruck = round(fuelWithoutTruck + f.settled_amount);
      continue;
    }
    bucketFor(buckets, f.tractor_unit).fuel = round(
      bucketFor(buckets, f.tractor_unit).fuel + f.settled_amount,
    );
  }

  // Who is a contractor and which tractors are theirs — see `ownerOperators.ts` for why this is
  // settled at order grain rather than by tractor.
  const { ownerOpUnits, ownerOpOrders, pureOwnerOpUnits } = classifyOwnerOperatorUnits(
    inputs.settlements,
    rules.includeOwnerOperators,
  );
  const ownerOpByPayee = rules.includeOwnerOperators
    ? new Map<string, ReturnType<typeof accumulateOwnerOperatorPay> extends Map<string, infer V> ? V : never>()
    : accumulateOwnerOperatorPay(inputs.settlements);

  let settlementWithoutTruck = 0;
  let ownerOperatorSettlement = 0;
  for (const s of inputs.settlements) {
    const isOwnerOperator: boolean = s.payee_type === ("owner_operator" as SettlementPayeeType);
    if (isOwnerOperator && !rules.includeOwnerOperators) {
      ownerOperatorSettlement = round(ownerOperatorSettlement + s.total_pay);
      continue;
    }
    if (!s.tractor_unit) {
      settlementWithoutTruck = round(settlementWithoutTruck + s.total_pay);
      continue;
    }
    bucketFor(buckets, s.tractor_unit).settlement = round(
      bucketFor(buckets, s.tractor_unit).settlement + s.total_pay,
    );
  }

  // Revenue: GL-booked dollars per unit, routed AFTER settlements so owner-operator units are
  // known. An owner-op truck's revenue against a cost column whose pay is pooled elsewhere would
  // print a margin no truck earned — it follows the pay into the excluded pool instead.
  const hasRevenue = inputs.revenueByUnit !== undefined || inputs.revenueBills !== undefined;
  const revenueWithoutTruck = round(inputs.revenueWithoutTruck ?? 0);
  let ownerOperatorRevenue = 0;
  const revenueByUnit: Record<string, number> = {};

  if (inputs.revenueBills) {
    // Order grain: the precise path. A bill follows the settlement that paid its order, so a truck
    // that ran for both an owner-operator and a company driver keeps each side's revenue with the
    // pay that earned it — instead of the whole unit falling to one side of the line.
    for (const bill of inputs.revenueBills) {
      const dollars = round(bill.dollars);
      const isOwnerOp =
        !rules.includeOwnerOperators &&
        bill.order_external_id !== null &&
        ownerOpOrders.has(bill.order_external_id);
      if (isOwnerOp) {
        ownerOperatorRevenue = round(ownerOperatorRevenue + dollars);
        // Credit the payee whose order it was, so each contractor's deal percentage is readable.
        creditOwnerOperatorRevenue(ownerOpByPayee, inputs.settlements, bill.order_external_id, dollars);
        continue;
      }
      if (!bill.tractor_unit) continue; // counted in revenueWithoutTruck by the caller
      revenueByUnit[bill.tractor_unit] = round((revenueByUnit[bill.tractor_unit] ?? 0) + dollars);
      bucketFor(buckets, bill.tractor_unit);
    }
  } else {
    // Unit grain: the older path, kept for callers that only have per-unit totals. It cannot split
    // a mixed truck, so a unit with ANY owner-operator settlement goes wholly to that pool.
    for (const [unit, dollars] of Object.entries(inputs.revenueByUnit ?? {})) {
      if (!rules.includeOwnerOperators && ownerOpUnits.has(unit)) {
        ownerOperatorRevenue = round(ownerOperatorRevenue + dollars);
        continue;
      }
      revenueByUnit[unit] = round(dollars);
      bucketFor(buckets, unit); // a truck that earned still ran, even if its costs missed the window
    }
  }

  // Overhead pool: unattributed by construction. voucher_hist has no equipment column and OFF posts
  // straight to the ledger, so nothing here can be placed on a truck without a rule.
  let overheadPool = 0;
  let outOfScopeVouchers = 0;
  for (const v of inputs.vouchers ?? []) {
    const account = v.ap_glid?.trim() ?? "";
    const inScope = rules.overheadAccounts === null || rules.overheadAccounts.includes(account);
    if (inScope) overheadPool = round(overheadPool + v.amount);
    else outOfScopeVouchers = round(outOfScopeVouchers + v.amount);
  }
  for (const l of inputs.officeLines ?? []) overheadPool = round(overheadPool + Math.abs(l.amount));

  /**
   * The GL-anchored pool, when the ledger can anchor it: everything the carrier spent that this
   * report did not put on a truck or in the owner-operator pool.
   *
   * This REPLACES the voucher build-up rather than adding to it — the AP vouchers are already
   * inside the GL total, and adding both is the double-count #357 removed from the fuel side.
   *
   * Two guards. The window must be month-aligned, because GL totals are month-grained and a
   * part-month window would charge a whole month's overhead against part of a month's miles. And a
   * negative remainder is refused: it means more was attributed than the ledger booked, which is a
   * staging problem worth showing rather than a credit worth spreading across trucks.
   */
  /**
   * Fuel bought on the carrier's card for an owner-operator's truck — and it is NOT a carrier
   * expense, which is the opposite of what it looks like from the EFS side.
   *
   * Measured against the ledger on 2026-08-28 rather than reasoned about. McLeod books that fuel to
   * `Fuel Advance` (account 17000000, a Current ASSET), and the owner-operator repays it through the
   * FEE settlement deduction, which credits the same asset. June 2026: the FUEL module debited
   * $62,131.62 and the DRS module credited $54,941.30 against it — a receivable that grew $7,190.32,
   * never a line on the income statement.
   *
   * That matters twice. It stays out of the owner-operator's cost, because they pay for it. And it
   * has to be ADDED BACK when the overhead pool is derived from GL expenses, because our EFS feed
   * booked it as an expense and the general ledger never did — subtracting it as though the GL knew
   * about it would shrink the overhead pool by money the income statement never contained.
   *
   * Computed here rather than in the fuel loop because a unit is not known to be owner-operator
   * until its settlements have been read.
   */
  /**
   * Units that ran ONLY for an owner-operator in this window.
   *
   * The distinction matters because four of June's eight owner-operator tractors were also driven
   * by a company driver. A mixed truck stays in the company table carrying its company-side pay and
   * revenue — dropping it would lose that driver's cost entirely — while a truck that ran purely
   * for a contractor leaves, because none of its economics are the carrier's to average.
   *
   * Its fuel goes with it. Fuel carries no order in McLeod, so a MIXED truck's fuel cannot be split
   * by settlement the way its revenue can; it stays on the company side and the caveats name the
   * trucks affected rather than inventing a ratio to divide it by.
   */
  let ownerOperatorFuel = 0;
  for (const unit of pureOwnerOpUnits) {
    const b = buckets.get(unit);
    if (b) ownerOperatorFuel = round(ownerOperatorFuel + b.fuel);
  }
  // A purely owner-operator truck leaves the company table entirely: it must not appear as a row,
  // must not dilute the mileage denominator, and must not draw a share of company overhead.
  for (const unit of pureOwnerOpUnits) buckets.delete(unit);

  const attributedDirect = round(
    [...buckets.values()].reduce((sum, b) => sum + b.fuel + b.settlement, 0),
  );
  /**
   * Scheduled fixed cost that this report charges to a truck in the table. It is ATTRIBUTED cost
   * in exactly the sense fuel and pay are, and it leaves the pool for the same reason (D-FIN1,
   * FINANCE-GO-LIVE-PLAN §1.1): lease, insurance and GPS are inside the income statement, so a
   * pool computed as "GL minus fuel and pay" still contained them, and the day the office filled
   * the schedule every scheduled dollar would have been charged to its truck AND spread again
   * over every truck by miles — about $573k a month at this carrier, counted twice. Found by the
   * 2026-09-03 audit while the schedule was still empty, which is the only reason the page had
   * never shown it.
   *
   * Summed over the trucks that REMAIN after the purely owner-operator units leave: a scheduled
   * unit that ran only for a contractor is charged nowhere in this table, so its schedule dollars
   * stay inside the pool and are named in the tie-out rather than silently spread.
   */
  const fixedCharged = round(
    [...buckets.keys()].reduce((sum, unit) => sum + (fixedByUnit[unit] ?? 0), 0),
  );
  const fixedCostOnOwnerOperatorTrucks = round((inputs.fixedCosts?.total ?? 0) - fixedCharged);
  // The caller supplies `glExpenseTotal` only for a month-aligned window — GL totals are
  // month-grained, and charging a whole month's overhead against part of a month's miles would
  // invent a figure the ledger never asserted. See `computeCpmForWindow`.
  let glRemainder: number | null = null;
  if (inputs.glExpenseTotal !== undefined && inputs.glExpenseTotal > 0) {
    // No owner-operator term beyond the pay: `attributedDirect` is summed AFTER the purely
    // owner-operator units leave the buckets, so their fuel is already outside it — which is the
    // right side of the line, because McLeod booked that fuel to a receivable and the income
    // statement never carried it either. Adding it back here would credit the pool twice.
    const remainder = round(
      inputs.glExpenseTotal - attributedDirect - ownerOperatorSettlement - fixedCharged,
    );
    // A negative remainder means more was attributed than the ledger booked. That is a staging
    // problem worth surfacing, never a credit worth spreading across trucks.
    if (remainder >= 0) {
      glRemainder = remainder;
      overheadPool = remainder;
    }
  }

  // Denominators, before any overhead is spread.
  const list = [...buckets.values()];
  let fleetLoaded = 0;
  let fleetDeadhead = 0;
  let fleetActual = 0;
  for (const b of list) {
    fleetLoaded = round(fleetLoaded + b.loadedMiles);
    fleetDeadhead = round(fleetDeadhead + b.deadheadMiles);
    if (useActual) fleetActual = round(fleetActual + (actualByUnit[b.tractor_unit] ?? 0));
  }
  const fleetTotal = useActual ? fleetActual : round(fleetLoaded + fleetDeadhead);

  // The pool is spread by largest-remainder apportionment (D-FIN11), so the per-truck column adds
  // back to the pool to the cent — `round(pool × share)` per row never did, and a table whose rows
  // cannot be summed to its own total cannot take part in a tie-out. A basis with nothing to
  // weigh (no miles at all under `total_miles`) apportions nothing, and the pool is then reported
  // as UNALLOCATED below rather than claimed as spread.
  const milesFor = (b: Bucket) =>
    useActual ? (actualByUnit[b.tractor_unit] ?? 0) : round(b.loadedMiles + b.deadheadMiles);
  const weights = list.map((b) =>
    rules.overheadBasis === "total_miles"
      ? milesFor(b)
      : rules.overheadBasis === "loaded_miles"
        ? b.loadedMiles
        : rules.overheadBasis === "equal_per_truck"
          ? 1
          : 0,
  );
  const allocations = apportionByWeight(overheadPool, weights);

  const trucks: TruckCpm[] = list.map((b, i) => {
    const actual = useActual ? (actualByUnit[b.tractor_unit] ?? 0) : null;
    const totalMiles = milesFor(b);
    const allocatedOverhead = allocations[i] ?? 0;
    const directTotal = round(b.fuel + b.settlement);
    const fixedCost = round(fixedByUnit[b.tractor_unit] ?? 0);
    const revenue = round(revenueByUnit[b.tractor_unit] ?? 0);
    const netTotal = round(revenue - directTotal - allocatedOverhead - fixedCost);
    return {
      tractor_unit: b.tractor_unit,
      movements: b.movements,
      loadedMiles: b.loadedMiles,
      deadheadMilesEstimated: b.deadheadMiles,
      actualMiles: actual,
      totalMiles,
      directFuel: b.fuel,
      directSettlement: b.settlement,
      directTotal,
      allocatedOverhead,
      fixedCost,
      revenue,
      netTotal,
      directCpm: cents(directTotal, totalMiles),
      allocatedCpm: cents(allocatedOverhead, totalMiles),
      fixedCpm: cents(fixedCost, totalMiles),
      totalCpm: cents(round(directTotal + allocatedOverhead + fixedCost), totalMiles),
      revenueCpm: cents(revenue, totalMiles),
      netCpm: cents(netTotal, totalMiles),
    };
  });

  // Most expensive first; a truck with no rate sorts last, after every truck that has one.
  trucks.sort((a, b) => (b.totalCpm ?? -Infinity) - (a.totalCpm ?? -Infinity));

  // Whole-fleet sums, and the measured/unmeasured split behind the per-mile figures (D-FIN10) —
  // see `cpmFleet.ts` for why a truck without miles stays in every total and out of every rate.
  const {
    fleetFuel,
    fleetSettlement,
    fleetDirect,
    allocatedTotal,
    unallocatedOverhead,
    fleetFixed,
    fleetRevenue,
    fleetNet,
    unmeasured,
    measuredDirect,
    measuredFixed,
    measuredAllocated,
    measuredRevenue,
    measuredNet,
  } = summariseFleet(trucks, allocations, overheadPool);

  // Every dollar of the income statement in exactly one bucket, residual 0.00 or the report is
  // wrong — see `cpmTieOut.ts` for the arithmetic and what a refused anchor reports instead.
  const glTieOut = buildGlTieOut({
    glExpenseTotal: inputs.glExpenseTotal,
    anchored: glRemainder !== null,
    attributedDirect,
    fixedCharged,
    allocatedTotal,
    unallocatedOverhead,
    ownerOperatorSettlement,
    fixedCostOnOwnerOperatorTrucks,
  });

  caveats.push(
    ...buildCpmCaveats({
      rules,
      useActual,
      overheadPool,
      fleetTotal,
      fleetLoaded,
      fleetActual,
      fleetDeadhead,
      trucksWithoutMeasuredMiles: unmeasured.trucks,
      unmeasuredCost: round(unmeasured.directTotal + unmeasured.fixedTotal + unmeasured.allocatedTotal),
      ownerOperatorSettlement: rules.includeOwnerOperators ? 0 : ownerOperatorSettlement,
      fuelWithoutTruck,
      settlementWithoutTruck,
      movementsWithoutTruck,
      hasRevenue,
      revenueWithoutTruck,
      ownerOperatorRevenue,
      netExcludedOverhead: unallocatedOverhead,
      glAnchored: glRemainder !== null,
      fixedCharged,
      fixedCostOnOwnerOperatorTrucks,
      fixedCosts: inputs.fixedCosts,
      uncoveredActiveTrucks: inputs.fixedCosts
        ? list.filter(
            (b) =>
              (b.movements > 0 || b.fuel > 0 || b.settlement > 0) &&
              !((fixedByUnit[b.tractor_unit] ?? 0) > 0),
          ).length
        : 0,
    }),
  );

  return {
    rules,
    milesBasis,
    trucks,
    fleet: {
      trucks: trucks.length,
      loadedMiles: fleetLoaded,
      deadheadMilesEstimated: fleetDeadhead,
      totalMiles: fleetTotal,
      directFuel: fleetFuel,
      directSettlement: fleetSettlement,
      directTotal: fleetDirect,
      fixedTotal: fleetFixed,
      revenueTotal: fleetRevenue,
      netTotal: fleetNet,
      directCpm: cents(measuredDirect, fleetTotal),
      allocatedCpm: cents(measuredAllocated, fleetTotal),
      fixedCpm: cents(measuredFixed, fleetTotal),
      totalCpm: cents(round(measuredDirect + measuredAllocated + measuredFixed), fleetTotal),
      revenueCpm: cents(measuredRevenue, fleetTotal),
      netCpm: cents(measuredNet, fleetTotal),
      unmeasured,
    },
    /**
     * The owner-operator side, kept apart because the arithmetic is not the same question.
     *
     * A company truck's cost is the carrier's fuel and the driver's pay. An owner-operator's is a
     * contractual SHARE of the load — measured June 2026 at 88%, 90% and 95% depending on the
     * payee, five payees and three different deals — and the carrier's earning is the remainder,
     * not the linehaul. Averaging the two produces a number describing neither.
     *
     * `dealPct` is derived, not configured: pay ÷ revenue on that payee's own orders. It reads
     * back the contract from what actually settled, so a renegotiated split shows up without
     * anyone editing a table, and a payee whose loads are missing revenue reads as null rather
     * than as a suspiciously round number.
     */
    ownerOperators: summariseOwnerOperators(ownerOpByPayee, inputs.ownerOperatorDeductionIncome),
    glTieOut,
    excluded: {
      unallocatedOverhead,
      fixedCostOnOwnerOperatorTrucks,
      /**
       * Where the overhead pool came from. `gl_remainder` means it is the income statement minus
       * what this report attributed, so every dollar the carrier spent is accounted for somewhere;
       * `ap_vouchers` is the older build-up, which misses journal-posted cost (lease, insurance)
       * and is used only when the window is not month-aligned. The page must say which, because
       * the two differ by ~40% of the fleet's cost and a reader cannot tell from the number alone.
       */
      overheadSource: glRemainder === null ? ("ap_vouchers" as const) : ("gl_remainder" as const),
      glExpenseTotal: inputs.glExpenseTotal ?? null,
      outOfScopeVouchers,
      ownerOperatorSettlement: rules.includeOwnerOperators ? 0 : ownerOperatorSettlement,
      ownerOperatorFuelAdvanced: ownerOperatorFuel,
      ownerOperatorRevenue,
      revenueWithoutTruck,
      fuelWithoutTruck,
      settlementWithoutTruck,
      movementsWithoutTruck,
    },
    caveats,
  };
}
