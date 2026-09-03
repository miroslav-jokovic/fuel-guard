import type { CpmUnmeasured, TruckCpm } from "./cpmContract.js";

const round = (n: number) => Math.round(n * 100) / 100;

export interface FleetSums {
  fleetFuel: number;
  fleetSettlement: number;
  fleetDirect: number;
  allocatedTotal: number;
  unallocatedOverhead: number;
  fleetFixed: number;
  fleetRevenue: number;
  fleetNet: number;
  /** Dollars on trucks with no miles this window — in every total, outside every rate. */
  unmeasured: CpmUnmeasured;
  /** The numerators of the fleet's per-mile figures: whole-fleet dollars minus `unmeasured`. */
  measuredDirect: number;
  measuredFixed: number;
  measuredAllocated: number;
  measuredRevenue: number;
  measuredNet: number;
}

/**
 * The fleet's sums, split into what can be rated and what cannot (D-FIN10). Extracted from
 * `cpmHarness.ts` on 2026-09-03 when the measured/unmeasured split pushed it past the 500-line
 * budget; the arithmetic is addition, the point is which side of the line each dollar lands on.
 *
 * The fleet's per-mile figures divide MEASURED trucks' dollars by measured miles. A truck with
 * cost but no miles used to keep its dollars in the numerator while contributing nothing to the
 * denominator, so the fleet rate read high by exactly the cost of the trucks the report could not
 * rate — June 2026's owner-operator units without Samsara devices, for one. Those dollars stay in
 * every `*Total` (the tie-out needs them) and are named in `unmeasured` as their own line, so
 * nothing is hidden and nothing is smeared.
 */
export function summariseFleet(trucks: TruckCpm[], allocations: number[], overheadPool: number): FleetSums {
  let fleetFuel = 0;
  let fleetSettlement = 0;
  let fleetFixed = 0;
  let fleetRevenue = 0;
  const unmeasured: CpmUnmeasured = { trucks: 0, directTotal: 0, fixedTotal: 0, allocatedTotal: 0, revenueTotal: 0 };
  for (const t of trucks) {
    fleetFuel = round(fleetFuel + t.directFuel);
    fleetSettlement = round(fleetSettlement + t.directSettlement);
    fleetFixed = round(fleetFixed + t.fixedCost);
    fleetRevenue = round(fleetRevenue + t.revenue);
    if (t.totalMiles > 0) continue;
    if (t.directTotal === 0 && t.fixedCost === 0 && t.allocatedOverhead === 0 && t.revenue === 0) continue;
    unmeasured.trucks++;
    unmeasured.directTotal = round(unmeasured.directTotal + t.directTotal);
    unmeasured.fixedTotal = round(unmeasured.fixedTotal + t.fixedCost);
    unmeasured.allocatedTotal = round(unmeasured.allocatedTotal + t.allocatedOverhead);
    unmeasured.revenueTotal = round(unmeasured.revenueTotal + t.revenue);
  }
  const fleetDirect = round(fleetFuel + fleetSettlement);
  const allocatedTotal = round(allocations.reduce((sum, a) => sum + a, 0));
  const unallocatedOverhead = round(overheadPool - allocatedTotal);
  const fleetNet = round(fleetRevenue - fleetDirect - allocatedTotal - fleetFixed);
  const measuredDirect = round(fleetDirect - unmeasured.directTotal);
  const measuredFixed = round(fleetFixed - unmeasured.fixedTotal);
  const measuredAllocated = round(allocatedTotal - unmeasured.allocatedTotal);
  const measuredRevenue = round(fleetRevenue - unmeasured.revenueTotal);
  const measuredNet = round(measuredRevenue - measuredDirect - measuredAllocated - measuredFixed);
  return {
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
  };
}
