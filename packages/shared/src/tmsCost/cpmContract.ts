import type { TmsMovementFact } from "./movementFact.js";
import type { FixedCostSummary } from "./fixedCosts.js";
import type { TmsFuelPurchaseFact } from "./fuelFact.js";
import type { TmsSettlementFact } from "./settlementFact.js";
import type { TmsApVoucherFact } from "./expenseFact.js";
import type { TmsOfficeSettlementLine } from "./ledgerControl.js";
import type { OwnerOperatorSummary } from "./ownerOperators.js";

/**
 * The cost-per-mile CONTRACT — the rules a caller chooses, the facts it supplies, and the shape it
 * gets back. Split from `cpmHarness.ts` on 2026-08-28 when the owner rulings pushed that file past
 * the 500-line budget; the arithmetic stayed there, the vocabulary moved here.
 *
 * Worth reading before the arithmetic. The whole design turns on keeping MEASURED cost and
 * ALLOCATED cost apart at every level — different fields, different columns, never summed into one
 * number without the reader being told — and that discipline is expressed in these types.
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
   * none of it — the honest default while the pool was a guess, and the wrong one now that it is the
   * income statement minus what was attributed (see `DEFAULT_CPM_RULES`). It remains available for a
   * reader who wants the direct-only figure, and the caveats still size what it withholds.
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
 * The default rules, chosen to be defensible rather than flattering.
 *
 * These defaults reversed on 2026-08-28, and the reversal is worth recording because the earlier
 * reasoning was sound for the world it was written in. While the overhead pool was assembled from
 * AP vouchers it was a FRAGMENT of unknown size, and spreading a fragment invents a per-truck number
 * without knowing how wrong it is — so assigning none of it produced a figure understated and known
 * to be, the safe direction for something a carrier prices freight against.
 *
 * The pool is no longer a fragment. Anchored on the income statement (`glExpenseTotal`), it is
 * exactly the cost the carrier incurred and did not attribute, and withholding it stopped being
 * conservative: June 2026 reported $1.21/mi for a fleet spending $2.05/mi, with the missing 38.9%
 * sitting in a card headed "not in these figures". Understating by 40% is not the safe direction
 * either. So overhead is allocated, on total miles.
 */
export const DEFAULT_CPM_RULES: CpmRules = {
  deadhead: "estimate",
  // Owner ruling 2026-08-28, and it reverses the note above. "Assign none of it" was the honest
  // default only while the pool was a guess built from AP vouchers; once the pool is the income
  // statement minus what was attributed, leaving it unassigned is the LESS honest choice, because
  // the page then reports $1.21/mi for a fleet actually spending $2.05/mi and the difference sits
  // in a card nobody reads. Overhead follows total miles: a truck that runs more consumes more of
  // the tolls, tyres, maintenance and insurance exposure the pool is made of.
  overheadBasis: "total_miles",
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
  /**
   * GL-BOOKED revenue per tractor unit, aggregated by the caller under the documented posting
   * predicate (post_key + module BILL — the projection's own rule). The owner's point, verbatim:
   * cost per mile alone is half the answer; what matters is what a truck is LEFT WITH per mile.
   * Revenue hauled by owner-operator trucks routes to its own excluded pool when the rules
   * exclude them — showing their revenue against a cost column that pools their pay elsewhere
   * would print a margin no truck earned.
   */
  revenueByUnit?: Record<string, number>;
  /** Booked revenue whose invoice names no tractor — excluded and stated, never spread (D-FS5). */
  revenueWithoutTruck?: number;

  /**
   * GL-booked revenue as INDIVIDUAL bills, carrying the order each was raised against.
   *
   * `revenueByUnit` cannot answer the question the owner asked on 2026-08-28, because a truck is
   * not wholly a company truck or wholly an owner-operator's. Measured in June: five owner-operator
   * payees ran eight tractors, and four of those tractors were ALSO driven by a company driver in
   * the same month. Classifying the whole unit sent 100% of its revenue to the owner-operator pool
   * while its company driver's pay stayed in the truck's cost column, so those four trucks showed
   * cost against no revenue and a falsely negative net per mile.
   *
   * With the bills carried at order grain the split follows the SETTLEMENT, which is what McLeod
   * actually asserts: an order settled to an `O` payee is that payee's load, everything else is the
   * company's. `drs_payee.type_of` agrees with `drs_settle_hist.payee_type` on all 2,765 June
   * settlements, so the classification has one meaning and no tie-break is needed.
   */
  /**
   * Revenue-account deduction dollars per owner-operator payee, classified by the caller against
   * McLeod's chart of accounts (0272/0274). Equipment rental, insurance collection and installment
   * sale — the carrier's earning beyond the load share it kept.
   */
  ownerOperatorDeductionIncome?: Record<string, number>;

  revenueBills?: Array<{
    tractor_unit: string | null;
    order_external_id: string | null;
    dollars: number;
  }>;

  /**
   * Total GL expenses for the window's months — the COMPLETENESS ANCHOR (owner ruling 2026-08-28).
   *
   * The overhead pool used to be built up from AP vouchers plus office ledger lines, and that
   * undercounted badly, because most of this carrier's cost never passes through AP: lease and
   * insurance post as journal entries, and 0257's voucher sweep sees neither. Measured on June
   * 2026: the report accounted for $1,992,498 of a $3,634,060 income statement, leaving 38.9% of
   * every dollar the carrier spent outside a report someone prices freight against.
   *
   * So the pool is now derived by SUBTRACTION from the GL total rather than assembled from parts:
   * whatever is not attributed to a truck or to the owner-operator pool is overhead, by definition.
   * That is total-preserving — no account can be forgotten, and none can be counted twice.
   *
   * Subtraction rather than an account-exclusion list is deliberate and was measured too: EFS fuel
   * ($963,725.33 in June) EXCEEDS the GL's "Fuel for Hired Vehicles" line ($899,741.93), because
   * EFS also buys DEF, additives and reefer fuel that post to their own accounts. An exclusion list
   * keyed on the fuel account would have left ~$64k double-counted; subtracting what was actually
   * attributed cannot.
   *
   * Month-grained, so it is only meaningful on a month-aligned window; `computeCpm` refuses to
   * allocate otherwise and says so rather than prorating a number the ledger never asserted.
   */
  glExpenseTotal?: number;
}

/** Which denominator this report's figures stand on. One basis per report, never mixed. */
export type MilesBasis = "samsara_actual" | "mcleod_loaded_plus_deadhead_estimate";

/**
 * The buckets a GL-anchored report sorts the income statement into. They sum to `glExpenseTotal`
 * when `anchored`; `residual` is the proof, and it is 0.00 or the report is wrong.
 *
 *   glExpenseTotal = attributedDirect + fixedCharged + ownerOperatorSettlement
 *                  + allocatedOverhead + unallocatedOverhead + residual
 *
 * `fixedCostOnOwnerOperatorTrucks` is informational: those dollars sit INSIDE the pool (they were
 * never charged to a row of this table), so they are not a separate term of the sum.
 */
export interface CpmGlTieOut {
  anchored: boolean;
  glExpenseTotal: number;
  attributedDirect: number;
  fixedCharged: number;
  allocatedOverhead: number;
  unallocatedOverhead: number;
  ownerOperatorSettlement: number;
  fixedCostOnOwnerOperatorTrucks: number;
  residual: number;
}

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
  /** GL-booked revenue this truck hauled. Zero when the caller supplied no invoices. */
  revenue: number;
  /** Revenue minus every cost IN THIS REPORT (direct + allocated + fixed) — the caveat names what is not. */
  netTotal: number;
  /** Cents per mile. Direct, allocated and fixed kept apart; `total` is their sum. */
  directCpm: number;
  allocatedCpm: number;
  fixedCpm: number;
  totalCpm: number;
  revenueCpm: number;
  netCpm: number;
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
    revenueTotal: number;
    netTotal: number;
    directCpm: number;
    allocatedCpm: number;
    fixedCpm: number;
    totalCpm: number;
    revenueCpm: number;
    netCpm: number;
  };
  /**
   * The owner-operator side, per payee. Empty when the rules include them in the truck figures.
   * `dealPct` is read back from what settled (pay ÷ revenue), never configured — June 2026 measured
   * 88%, 90% and 95% across five payees, so a single fleet-wide rate would have been fiction.
   */
  ownerOperators: OwnerOperatorSummary[];
  /**
   * Every dollar of the income statement in exactly one bucket — present whenever the caller
   * anchored the report on a GL total (D-FIN11, FINANCE-GO-LIVE-PLAN). `residual` is 0.00 when the
   * anchor held; when it was refused, `anchored` is false and `residual` is the over-attribution.
   * This is what "100% precise" means for one report, and the monthly close (D-FIN14) is this
   * block persisted per month.
   */
  glTieOut: CpmGlTieOut | null;
  /**
   * Everything the per-truck figures do NOT contain. This is the honesty ledger, and it is the first
   * thing a reviewer should read.
   */
  excluded: {
    /**
     * Overhead left unassigned — the whole pool under the `none` basis, and under any other basis
     * whatever could not be weighed (a pool with no miles to spread it over). Never silently zero.
     */
    unallocatedOverhead: number;
    /**
     * Schedule dollars for units that ran only for an owner-operator this window. Those trucks are
     * outside the table (D-MC20), so their lease is charged to no row here; it stays in the shared
     * pool and is named rather than spread unannounced.
     */
    fixedCostOnOwnerOperatorTrucks: number;
    /**
     * Where the pool came from. `gl_remainder` is the income statement minus what this report
     * attributed, so nothing the carrier spent falls outside the report; `ap_vouchers` is the
     * older build-up, which misses journal-posted cost (lease, insurance) and understated June
     * 2026 by 38.9%. The page must state which is in force — the two differ by ~40% of fleet cost
     * and a reader cannot tell from the number alone.
     */
    overheadSource: "gl_remainder" | "ap_vouchers";
    /** The GL expense total the pool was derived from, when one anchored it. */
    glExpenseTotal: number | null;
    /** AP vouchers that fell outside `overheadAccounts`. */
    outOfScopeVouchers: number;
    /** Owner-operator settlements, when excluded. Their own pool, never averaged in. */
    ownerOperatorSettlement: number;
    /**
     * Fuel bought on the carrier's card for a purely owner-operator truck. Reported because it
     * LOOKS like a cost from the EFS side and is not one: McLeod books it to `Fuel Advance`
     * (account 17000000, a Current Asset) and the contractor repays it through the FEE settlement
     * deduction. June 2026 — $62,131.62 advanced, $54,941.30 repaid.
     */
    ownerOperatorFuelAdvanced: number;
    /** Revenue hauled by owner-operator trucks, pooled beside their settlements when excluded. */
    ownerOperatorRevenue: number;
    /** Booked revenue naming no tractor — a fact about the source, stated rather than spread. */
    revenueWithoutTruck: number;
    /** Fuel and settlement rows carrying no tractor at all — cost McLeod could not place. */
    fuelWithoutTruck: number;
    settlementWithoutTruck: number;
    /** Movements whose miles cannot join a truck, so their miles are absent from the denominator. */
    movementsWithoutTruck: number;
  };
  /** Free-text warnings a reader must see before quoting any figure here. */
  caveats: string[];
}
