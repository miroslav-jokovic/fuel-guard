import { inferDeadheadLegs, type TmsMovementFact } from "./movementFact.js";
import { fixedCostCaveats, type FixedCostSummary } from "./fixedCosts.js";
import type { TmsFuelPurchaseFact } from "./fuelFact.js";
import type { TmsSettlementFact, SettlementPayeeType } from "./settlementFact.js";
import type { TmsApVoucherFact } from "./expenseFact.js";
import type { TmsOfficeSettlementLine } from "./ledgerControl.js";

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

/** How to treat the miles McLeod does not record. */
export const DEADHEAD_TREATMENTS = ["estimate", "exclude"] as const;
export type DeadheadTreatment = (typeof DEADHEAD_TREATMENTS)[number];

/** How to spread cost that carries no truck. */
export const OVERHEAD_BASES = ["total_miles", "loaded_miles", "equal_per_truck", "none"] as const;
export type OverheadBasis = (typeof OVERHEAD_BASES)[number];

export interface CpmRules {
  /**
   * `estimate` adds the great-circle deadhead chained from stop coordinates — roughly 4% of loaded
   * miles for this carrier, and a FLOOR, since road distance runs above great-circle. `exclude`
   * divides by loaded miles alone, which overstates cost per mile by about that same 4%.
   *
   * Neither is "right". `estimate` is the better default because the miles were genuinely driven and
   * the truck genuinely burned fuel over them; the alternative silently attributes empty-mile cost to
   * loaded miles.
   */
  deadhead: DeadheadTreatment;

  /**
   * The basis for spreading unattributed cost. `none` reports overhead as a fleet total and assigns
   * none of it, which is the honest default before finance has ruled.
   */
  overheadBasis: OverheadBasis;

  /**
   * Owner-operator settlements bundle the truck, its fuel and its maintenance into one contractor
   * payment (D-MC20). Including them alongside company trucks produces an average that describes
   * neither, so they are excluded by default and reported in their own pool.
   */
  includeOwnerOperators: boolean;

  /**
   * AP expense accounts treated as fleet overhead. `null` means every account.
   *
   * Accounts are the ONLY classification `voucher_hist` carries, so this is where a finance decision
   * about "which spend is a cost of running trucks" has to be expressed.
   */
  overheadAccounts: string[] | null;
}

/**
 * The default rules, chosen to be defensible and conservative rather than flattering.
 *
 * `overheadBasis: "none"` matters most: until finance signs an allocation rule, this harness assigns
 * no overhead to any truck and reports the unallocated pool as its own number. That produces a cost
 * per mile that is UNDERSTATED and known to be, which is the safe direction for a figure someone
 * might price freight against.
 */
export const DEFAULT_CPM_RULES: CpmRules = {
  deadhead: "estimate",
  overheadBasis: "none",
  includeOwnerOperators: false,
  overheadAccounts: null,
};

export interface CpmInputs {
  movements: TmsMovementFact[];
  fuel: TmsFuelPurchaseFact[];
  settlements: TmsSettlementFact[];
  vouchers?: TmsApVoucherFact[];
  officeLines?: TmsOfficeSettlementLine[];
  /**
   * MEASURED total miles per tractor unit — Samsara GPS actuals, the fleet's mileage source of
   * truth by owner ruling (2026-08-27). When present, this IS the denominator: it already
   * contains empty and out-of-route miles as driven, so nothing is inferred and nothing added.
   * McLeod's loaded miles stay in the report as the reference the pay and ops numbers are built
   * on. When absent (Samsara not yet synced for the window), the harness falls back to
   * loaded-plus-inferred-deadhead and SAYS SO — a fleet-wide basis note, never a silent switch,
   * and never a per-truck mix: a truck with movements but no measured miles gets NO cost per
   * mile rather than one computed on a basis its neighbours didn't use.
   */
  actualMilesByUnit?: Record<string, number>;
  /**
   * The office's fixed-cost schedule summed for the window (fixedCosts.ts): lease, insurance,
   * GPS — the dollars McLeod structurally cannot attribute (T1, TRUCK-COST-ATTRIBUTION-PLAN).
   * A contract's assertion, not a measurement: charged in its own column, its caveats generated
   * from what the summary actually contains, never blended into the measured direct figures.
   */
  fixedCosts?: FixedCostSummary;
}

/** Which denominator this report's figures stand on. One basis per report, never mixed. */
export type MilesBasis = "samsara_actual" | "mcleod_loaded_plus_deadhead_estimate";

export interface TruckCpm {
  tractor_unit: string;
  movements: number;
  loadedMiles: number;
  /** Inferred, never recorded by McLeod. Zero when the rule says `exclude` or the basis is Samsara. */
  deadheadMilesEstimated: number;
  /** Samsara's measured miles for this truck. Null under the estimate basis. */
  actualMiles: number | null;
  totalMiles: number;
  /** Costs McLeod attributed to this truck itself. */
  directFuel: number;
  directSettlement: number;
  directTotal: number;
  /** Overhead this run's rule assigned. Zero under `none`. */
  allocatedOverhead: number;
  /** The schedule's whole-month charge for this truck. A contract figure, not a measurement. */
  fixedCost: number;
  /** Cents per mile. Direct, allocated and fixed kept apart; `total` is their sum. */
  directCpm: number;
  allocatedCpm: number;
  fixedCpm: number;
  totalCpm: number;
}

export interface CpmReport {
  rules: CpmRules;
  milesBasis: MilesBasis;
  trucks: TruckCpm[];
  fleet: {
    trucks: number;
    loadedMiles: number;
    deadheadMilesEstimated: number;
    totalMiles: number;
    directFuel: number;
    directSettlement: number;
    directTotal: number;
    fixedTotal: number;
    directCpm: number;
    allocatedCpm: number;
    fixedCpm: number;
    totalCpm: number;
  };
  /**
   * Everything the per-truck figures do NOT contain. This is the honesty ledger, and it is the first
   * thing a reviewer should read.
   */
  excluded: {
    /** Overhead left unassigned — the whole pool under the default `none` basis. */
    unallocatedOverhead: number;
    /** AP vouchers that fell outside `overheadAccounts`. */
    outOfScopeVouchers: number;
    /** Owner-operator settlements, when excluded. Their own pool, never averaged in. */
    ownerOperatorSettlement: number;
    /** Fuel and settlement rows carrying no tractor at all — cost McLeod could not place. */
    fuelWithoutTruck: number;
    settlementWithoutTruck: number;
    /** Movements whose miles cannot join a truck, so their miles are absent from the denominator. */
    movementsWithoutTruck: number;
  };
  /** Free-text warnings a reader must see before quoting any figure here. */
  caveats: string[];
}

const round = (n: number) => Math.round(n * 100) / 100;
/** Cents, to one decimal — beyond that is false precision on an allocated number. */
const cents = (dollars: number, miles: number) =>
  miles <= 0 ? 0 : Math.round((dollars / miles) * 100 * 10) / 10;

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

  // Denominators, before any overhead is spread.
  const list = [...buckets.values()];
  let fleetLoaded = 0;
  let fleetDeadhead = 0;
  let fleetActual = 0;
  let trucksWithoutMeasuredMiles = 0;
  for (const b of list) {
    fleetLoaded = round(fleetLoaded + b.loadedMiles);
    fleetDeadhead = round(fleetDeadhead + b.deadheadMiles);
    if (useActual) {
      const a = actualByUnit[b.tractor_unit] ?? 0;
      fleetActual = round(fleetActual + a);
      if (a <= 0 && (b.loadedMiles > 0 || b.fuel > 0 || b.settlement > 0)) trucksWithoutMeasuredMiles++;
    }
  }
  const fleetTotal = useActual ? fleetActual : round(fleetLoaded + fleetDeadhead);

  const basisTotal =
    rules.overheadBasis === "total_miles"
      ? fleetTotal
      : rules.overheadBasis === "loaded_miles"
        ? fleetLoaded
        : rules.overheadBasis === "equal_per_truck"
          ? list.length
          : 0;

  const trucks: TruckCpm[] = list.map((b) => {
    const actual = useActual ? (actualByUnit[b.tractor_unit] ?? 0) : null;
    const totalMiles = useActual ? (actual ?? 0) : round(b.loadedMiles + b.deadheadMiles);
    const share =
      basisTotal <= 0
        ? 0
        : rules.overheadBasis === "equal_per_truck"
          ? 1 / basisTotal
          : (rules.overheadBasis === "total_miles" ? totalMiles : b.loadedMiles) / basisTotal;
    const allocatedOverhead = round(overheadPool * share);
    const directTotal = round(b.fuel + b.settlement);
    const fixedCost = round(fixedByUnit[b.tractor_unit] ?? 0);
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
      directCpm: cents(directTotal, totalMiles),
      allocatedCpm: cents(allocatedOverhead, totalMiles),
      fixedCpm: cents(fixedCost, totalMiles),
      totalCpm: cents(round(directTotal + allocatedOverhead + fixedCost), totalMiles),
    };
  });

  trucks.sort((a, b) => b.totalCpm - a.totalCpm);

  let fleetFuel = 0;
  let fleetSettlement = 0;
  for (const b of list) {
    fleetFuel = round(fleetFuel + b.fuel);
    fleetSettlement = round(fleetSettlement + b.settlement);
  }
  const fleetDirect = round(fleetFuel + fleetSettlement);
  const allocatedTotal = rules.overheadBasis === "none" ? 0 : overheadPool;
  let fleetFixed = 0;
  for (const t of trucks) fleetFixed = round(fleetFixed + t.fixedCost);

  // The caveats are generated from what actually happened in THIS run, not written once and left to
  // rot. A reader who ignores them will quote a number that does not mean what they think.
  if (rules.overheadBasis === "none" && overheadPool > 0) {
    caveats.push(
      `Cost per mile EXCLUDES $${overheadPool.toFixed(2)} of overhead — no allocation basis is set. ` +
        `Every figure below is understated by that amount spread across ${fleetTotal.toFixed(0)} miles ` +
        `(about ${cents(overheadPool, fleetTotal).toFixed(1)}¢/mi).`,
    );
  }
  if (useActual) {
    caveats.push(
      `Miles are Samsara GPS actuals — the fleet's mileage source of truth by owner ruling. The ` +
        `denominator already contains empty and out-of-route miles as driven; nothing is inferred. ` +
        `McLeod loaded miles (${fleetLoaded.toFixed(0)}) are shown for reference` +
        (fleetLoaded > 0 && fleetActual > 0
          ? ` — measured miles run ${(((fleetActual - fleetLoaded) / fleetLoaded) * 100).toFixed(1)}% above loaded, which IS the measured empty/out-of-route share.`
          : `.`),
    );
    if (trucksWithoutMeasuredMiles > 0) {
      caveats.push(
        `${trucksWithoutMeasuredMiles} truck(s) carry McLeod activity but no Samsara miles in this ` +
          `window; their cost per mile is NOT computed rather than computed on a different basis ` +
          `than the rest of the fleet.`,
      );
    }
  }
  if (!useActual && rules.deadhead === "estimate" && fleetDeadhead > 0) {
    caveats.push(
      `${fleetDeadhead.toFixed(0)} deadhead miles are ESTIMATED by chaining stop coordinates, not read ` +
        `from McLeod, which records none. Great-circle is a floor, so real deadhead is higher and cost ` +
        `per mile correspondingly lower.`,
    );
  }
  if (!useActual && rules.deadhead === "exclude") {
    caveats.push(
      `Deadhead is EXCLUDED, so the denominator is loaded miles only and every figure is overstated by ` +
        `roughly the fleet's empty-mile share (~4-5% for this carrier).`,
    );
  }
  if (!rules.includeOwnerOperators && ownerOperatorSettlement > 0) {
    caveats.push(
      `$${ownerOperatorSettlement.toFixed(2)} of owner-operator settlement is excluded. Those payments ` +
        `bundle truck, fuel and maintenance into one contractor rate and are not comparable to a ` +
        `company truck's costs.`,
    );
  }
  if (fuelWithoutTruck > 0 || settlementWithoutTruck > 0) {
    caveats.push(
      `$${round(fuelWithoutTruck + settlementWithoutTruck).toFixed(2)} of direct cost carries no ` +
        `tractor in McLeod and is excluded rather than spread.`,
    );
  }
  if (movementsWithoutTruck > 0) {
    caveats.push(
      `${movementsWithoutTruck} movement(s) resolve to no tractor; their miles are absent from every ` +
        `denominator here.`,
    );
  }
  if (inputs.fixedCosts) {
    const uncoveredActive = list.filter(
      (b) =>
        (b.movements > 0 || b.fuel > 0 || b.settlement > 0) && !((fixedByUnit[b.tractor_unit] ?? 0) > 0),
    ).length;
    caveats.push(...fixedCostCaveats(inputs.fixedCosts, uncoveredActive));
  }

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
      directCpm: cents(fleetDirect, fleetTotal),
      allocatedCpm: cents(allocatedTotal, fleetTotal),
      fixedCpm: cents(fleetFixed, fleetTotal),
      totalCpm: cents(round(fleetDirect + allocatedTotal + fleetFixed), fleetTotal),
    },
    excluded: {
      unallocatedOverhead: rules.overheadBasis === "none" ? overheadPool : 0,
      outOfScopeVouchers,
      ownerOperatorSettlement: rules.includeOwnerOperators ? 0 : ownerOperatorSettlement,
      fuelWithoutTruck,
      settlementWithoutTruck,
      movementsWithoutTruck,
    },
    caveats,
  };
}
