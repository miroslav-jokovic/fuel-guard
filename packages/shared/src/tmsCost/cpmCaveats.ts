import type { CpmRules } from "./cpmContract.js";
import { fixedCostCaveats, type FixedCostSummary } from "./fixedCosts.js";

/**
 * The caveat generator — extracted from cpmHarness.ts when revenue/net columns pushed that file
 * against its budget, and a natural seam: the arithmetic and the WARNINGS ABOUT the arithmetic
 * are different jobs. Everything here is generated from what actually happened in THIS run, not
 * written once and left to rot. A reader who ignores these will quote a number that does not
 * mean what they think.
 */
export interface CpmCaveatContext {
  rules: CpmRules;
  useActual: boolean;
  overheadPool: number;
  fleetTotal: number;
  fleetLoaded: number;
  fleetActual: number;
  fleetDeadhead: number;
  trucksWithoutMeasuredMiles: number;
  ownerOperatorSettlement: number;
  fuelWithoutTruck: number;
  settlementWithoutTruck: number;
  movementsWithoutTruck: number;
  /** Revenue context — present only when the caller supplied invoices. */
  hasRevenue: boolean;
  revenueWithoutTruck: number;
  ownerOperatorRevenue: number;
  /** Cost NOT subtracted from net (unallocated overhead under the `none` basis). */
  netExcludedOverhead: number;
  fixedCosts?: FixedCostSummary;
  uncoveredActiveTrucks: number;
}

const cents = (dollars: number, miles: number) =>
  miles <= 0 ? 0 : Math.round((dollars / miles) * 100 * 10) / 10;
const round = (n: number) => Math.round(n * 100) / 100;

export function buildCpmCaveats(ctx: CpmCaveatContext): string[] {
  const caveats: string[] = [];
  const { rules } = ctx;
  if (rules.overheadBasis === "none" && ctx.overheadPool > 0) {
    caveats.push(
      `Cost per mile EXCLUDES $${ctx.overheadPool.toFixed(2)} of overhead — no allocation basis is set. ` +
        `Every figure below is understated by that amount spread across ${ctx.fleetTotal.toFixed(0)} miles ` +
        `(about ${cents(ctx.overheadPool, ctx.fleetTotal).toFixed(1)}¢/mi).`,
    );
  }
  if (ctx.useActual) {
    const shift = ctx.fleetLoaded > 0 && ctx.fleetActual > 0
      ? ((ctx.fleetActual - ctx.fleetLoaded) / ctx.fleetLoaded) * 100
      : null;
    caveats.push(
      `Miles are Samsara GPS actuals — the fleet's mileage source of truth by owner ruling. The ` +
        `denominator already contains empty and out-of-route miles as driven; nothing is inferred. ` +
        `McLeod loaded miles (${ctx.fleetLoaded.toFixed(0)}) are shown for reference` +
        (shift == null
          ? `.`
          : shift >= 0
            ? ` — measured miles run ${shift.toFixed(1)}% above loaded, which IS the measured empty/out-of-route share.`
            : ` — measured miles run ${(-shift).toFixed(1)}% BELOW loaded, which usually means some trucks in the loaded total have no Samsara device (owner-operators), not that trucks drove less than their loads.`),
    );
    if (ctx.trucksWithoutMeasuredMiles > 0) {
      caveats.push(
        `${ctx.trucksWithoutMeasuredMiles} truck(s) carry McLeod activity but no Samsara miles in this ` +
          `window; their cost per mile is NOT computed rather than computed on a different basis ` +
          `than the rest of the fleet.`,
      );
    }
  }
  if (!ctx.useActual && rules.deadhead === "estimate" && ctx.fleetDeadhead > 0) {
    caveats.push(
      `${ctx.fleetDeadhead.toFixed(0)} deadhead miles are ESTIMATED by chaining stop coordinates, not read ` +
        `from McLeod, which records none. Great-circle is a floor, so real deadhead is higher and cost ` +
        `per mile correspondingly lower.`,
    );
  }
  if (!ctx.useActual && rules.deadhead === "exclude") {
    caveats.push(
      `Deadhead is EXCLUDED, so the denominator is loaded miles only and every figure is overstated by ` +
        `roughly the fleet's empty-mile share (~4-5% for this carrier).`,
    );
  }
  if (!rules.includeOwnerOperators && ctx.ownerOperatorSettlement > 0) {
    caveats.push(
      `$${ctx.ownerOperatorSettlement.toFixed(2)} of owner-operator settlement is excluded. Those payments ` +
        `bundle truck, fuel and maintenance into one contractor rate and are not comparable to a ` +
        `company truck's costs.`,
    );
  }
  if (ctx.fuelWithoutTruck > 0 || ctx.settlementWithoutTruck > 0) {
    caveats.push(
      `$${round(ctx.fuelWithoutTruck + ctx.settlementWithoutTruck).toFixed(2)} of direct cost carries no ` +
        `tractor in McLeod and is excluded rather than spread.`,
    );
  }
  if (ctx.movementsWithoutTruck > 0) {
    caveats.push(
      `${ctx.movementsWithoutTruck} movement(s) resolve to no tractor; their miles are absent from every ` +
        `denominator here.`,
    );
  }
  if (ctx.hasRevenue) {
    if (ctx.netExcludedOverhead > 0) {
      caveats.push(
        `NET per mile subtracts ONLY the costs in these figures (fuel + driver pay + scheduled fixed` +
          (rules.overheadBasis === "none" ? "" : " + allocated overhead") +
          `). $${ctx.netExcludedOverhead.toFixed(2)} of unallocated overhead is NOT subtracted, so net is ` +
          `OVERSTATED by about ${cents(ctx.netExcludedOverhead, ctx.fleetTotal).toFixed(1)}¢/mi until an ` +
          `allocation basis is ruled.`,
      );
    }
    if (ctx.ownerOperatorRevenue > 0) {
      caveats.push(
        `$${ctx.ownerOperatorRevenue.toFixed(2)} of booked revenue was hauled by owner-operator trucks — ` +
          `pooled with their settlements, not shown per company truck.`,
      );
    }
    if (ctx.revenueWithoutTruck > 0) {
      caveats.push(
        `$${ctx.revenueWithoutTruck.toFixed(2)} of booked revenue carries no tractor in McLeod and is ` +
          `excluded from every per-truck figure rather than spread.`,
      );
    }
  }
  if (ctx.fixedCosts) caveats.push(...fixedCostCaveats(ctx.fixedCosts, ctx.uncoveredActiveTrucks));
  return caveats;
}
