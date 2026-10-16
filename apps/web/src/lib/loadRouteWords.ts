import type { LiveMapLoadRoute } from "@silvicom/shared";

/**
 * Words about a load's route that both the map's truck card and the dispatch board's drawer say — in
 * `lib`, since neither feature may import the other's internals, and two copies would drift.
 */

/**
 * The truck is off the planned line (V2 plan §5.1): routed from where it is, the faint line is the plan;
 * without a second route (no HERE key), the fuel stops still sit on the plan from the pickup. Null on it.
 */
export function offRouteWords(route: Pick<LiveMapLoadRoute, "truckOnRoute" | "offRouteMiles" | "fromTruck">): string | null {
  if (route.truckOnRoute || route.offRouteMiles == null) return null;
  const off = `Truck is ${Math.round(route.offRouteMiles)} mi off the planned route`;
  return route.fromTruck
    ? `${off}; the road ahead is routed from where it is, and the planned route is shown faint.`
    : `${off}; fuel stops are planned from the pickup.`;
}
