/**
 * A plan's money, twice (D-FP5, FUEL-PLANNING-PRECISION-PLAN §2): what the pumps post and what this carrier
 * pays. The owner asked on 2026-09-10 for "price with and without discounts" on every suggested stop; the Pilot
 * daily report has carried both on every row all along (2,729 rows in the week before, average discount
 * $0.595/gal) and the planner read only the net. Pure, so the arithmetic that the summary tile and the history
 * row both show is one function rather than two.
 *
 * Unknown stays unknown: a stop with no pump price makes the pump total null, never a total that silently
 * omits a stop — the same rule the solver applies to `totalCost`.
 */
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface PricedStop {
  gallons: number;
  netPrice: number | null;
  postedPrice: number | null;
}

export interface PlanPricing {
  /** What the carrier pays, at its net prices. Null when any stop's net is unknown. */
  totalCost: number | null;
  /** What the same gallons would cost at the posted pump prices. Null when any stop's pump price is unknown. */
  totalCostAtPump: number | null;
  /** Pump minus net across the plan — the contract discount the plan captures. Null when either total is. */
  discountSavings: number | null;
}

/** Per-gallon discount at one stop: pump minus net, or null when either side is unknown. Signed — a cost-plus
 *  rule can legitimately put the net above the pump, and that is shown, not hidden. */
export function discountPerGal(postedPrice: number | null, netPrice: number | null): number | null {
  return postedPrice != null && netPrice != null ? round3(postedPrice - netPrice) : null;
}

export function planPricing(stops: PricedStop[]): PlanPricing {
  const totalCost = stops.some((s) => s.netPrice == null) ? null : round2(stops.reduce((t, s) => t + s.gallons * s.netPrice!, 0));
  const totalCostAtPump = stops.some((s) => s.postedPrice == null) ? null : round2(stops.reduce((t, s) => t + s.gallons * s.postedPrice!, 0));
  const discountSavings = totalCost != null && totalCostAtPump != null ? round2(totalCostAtPump - totalCost) : null;
  return { totalCost, totalCostAtPump, discountSavings };
}
