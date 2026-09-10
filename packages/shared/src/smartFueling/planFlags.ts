/**
 * Every flag a fuel plan can carry, and the sentence a dispatcher reads for it (D-FP7,
 * FUEL-PLANNING-PRECISION-PLAN §2). Unit 748's plan of 2026-09-10 carried four flags — off-network,
 * overnight reset, HOS-limited, stale fuel reading — and the page rendered none of them: it knew exactly one
 * flag by name. The map is `Record<PlanFlag, string>` by construction, so a flag added to the solver, the
 * truck state or the API without a sentence here fails typecheck (the `FINDING_SECTIONS` pattern).
 */
export const PLAN_FLAG_COPY = {
  // The plan as a whole
  no_fuel_reading_cannot_plan: "No live fuel level for this truck, so no plan was built.",
  INFEASIBLE_no_reachable_fuel: "No station is reachable above the reserve. The driver must refuel before continuing.",
  starts_below_reserve: "The truck is already below its reserve, so the first stop is urgent.",
  // Stations and prices
  some_stations_missing_price: "Some stations on this corridor have no price. They were passed over while a priced one was in range.",
  estimated_prices_used: "At least one price is an estimate from station history or a brand average, and its stop says so.",
  off_network_stop_used: "A stop is at an enabled but non-preferred network, because no preferred station was in range there.",
  emergency_fill_used: "An emergency stop was needed: only an avoided pump was in range, or the tank was at the critical level. It buys just enough to reach the next preferred station.",
  avoided_state_fill_used: "A capped splash inside an avoided state was still needed to reach the destination.",
  topped_off_before_avoided_state: "The truck tops off at the last preferred station before entering an avoided or fuel-before state.",
  // Hours of service — they never move a stop; they time the driver's day
  overnight_reset_required: "The trip needs at least one 10-hour reset. A stop where the day ends is tagged.",
  cycle_restart_required: "The driver's cycle runs out on this trip. A 34-hour restart is assumed before continuing.",
  no_hos: "No hours-of-service clocks were available, so the plan is fuel only.",
  // The truck's inputs
  no_fuel_reading: "No fuel reading came from the truck.",
  stale_fuel_reading: "The fuel reading is more than an hour old. The plan treats it as the current level.",
  post_fill_reading_distrusted: "The fuel reading is from just after a fill and may not have settled.",
  below_reserve: "The truck's current fuel is below its reserve.",
  no_baseline_mpg: "This truck has no measured MPG, so range is planned on 6 MPG derated by the safety factor.",
  load_weight_unknown: "No load weight was entered, so fills are not capped for legal gross weight.",
  manual_fuel_entry: "Planned from a manually entered fuel level, not live telematics.",
  fills_uncapped_no_load_weight: "A large fill on a truck with no load weight entered. Double-check gross weight before topping off.",
} as const satisfies Record<string, string>;

export type PlanFlag = keyof typeof PLAN_FLAG_COPY;

/** The subset `buildTruckFuelState` can raise about the truck's own inputs. */
export type TruckFlag = Extract<PlanFlag,
  "no_fuel_reading" | "stale_fuel_reading" | "post_fill_reading_distrusted" | "below_reserve" | "no_baseline_mpg" | "no_hos" | "load_weight_unknown">;

/** The sentence for a flag; a flag from an older saved plan the map does not know renders as its code. */
export const planFlagCopy = (flag: string): string => (PLAN_FLAG_COPY as Record<string, string>)[flag] ?? flag;
