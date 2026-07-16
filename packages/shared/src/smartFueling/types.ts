/**
 * Smart Fueling — shared domain contracts + defaults (pure). Distinct from `fuel.ts` (the fuel-transaction
 * domain): this module is about ROUTE fuel PLANNING — stations, prices, discount model, and the per-org
 * planning policy. Chain-agnostic by design; Pilot is loaded as data, never hardcoded in logic.
 * See SMART-FUELING-PLAN.md.
 */

/** A physical truck-stop location (global reference fact). */
export interface FuelStation {
  id: string;
  brand: string; // 'pilot' | 'flying_j' | 'one9' | ... — never special-cased in logic; policy lives in settings
  storeNumber: string | null;
  name: string | null;
  lat: number;
  lng: number;
  state: string | null; // 2-letter; drives avoid-states
  exit: string | null;
  hasDiesel: boolean;
  hasDef: boolean;
  status: "active" | "closed";
}

/** A price observation for a station+product (net is org-specific via the discount deal). */
export interface FuelPrice {
  stationId: string;
  product: "diesel" | "def";
  postedPrice: number | null;
  netPrice: number | null;
  source: string; // 'pilot_email' | 'efs'
  observedAt: string; // ISO
}

export type DiscountType = "flat" | "retail_minus" | "cost_plus" | "per_site" | "none";
export interface DiscountRule {
  brand: string;
  type: DiscountType;
  /** Cents per gallon: retail_minus/flat subtract; cost_plus adds. */
  centsOff: number;
}

/** The truck combination's routing profile (US customary as stored; converted to HERE units at call time). */
export interface TruckProfile {
  heightIn: number;
  lengthIn: number;
  widthIn: number;
  axleCount: number;
  grossWeightLb: number;
}

/** Per-org planning policy + safety parameters. Every fleet-specific value is configuration, not code. */
export interface RouteFuelSettings {
  reservePct: number;
  corridorMiles: number;
  minPurchaseGal: number;
  mpgSafetyFactor: number;
  deviationThresholdMi: number;
  priceTtlHours: number;
  /** true = top off at every stop. false = min-drawdown: buy only enough to reach the next cheaper stop. */
  alwaysFillFull: boolean;
  /** When min-drawdown is active, cap a non-cheapest partial fill at this % of tank (full fill only at the cheapest reachable stop). */
  fillCapPct: number;
  avoidStates: string[];
  /** States to top off before entering (sparse fueling — e.g. Massachusetts has one truck stop) — stations here stay usable. */
  fuelBeforeStates: string[];
  avoidBrands: string[];
  preferredBrands: string[];
  emergencyBrands: string[];
  /** Truck-stop networks this org has turned ON — a hard registry filter applied BEFORE the solver
   *  (the registry may hold more networks than an org uses). Empty is not allowed (resolve falls back). */
  enabledBrands: string[];
  emergencyFillGallons: number;
  planDef: boolean;
  defaultProfile: TruckProfile;
}

export const DEFAULT_ROUTE_FUEL_SETTINGS: RouteFuelSettings = {
  reservePct: 20,
  corridorMiles: 2.5,
  minPurchaseGal: 50,
  mpgSafetyFactor: 0.9,
  deviationThresholdMi: 3,
  priceTtlHours: 30,
  alwaysFillFull: false, // min-drawdown on by default: buy just enough to reach the next cheaper stop
  fillCapPct: 75,
  avoidStates: ["CA"],
  fuelBeforeStates: ["MA"], // top off before entering — Massachusetts has essentially one truck stop
  avoidBrands: ["one9"],
  preferredBrands: ["pilot", "flying_j"],
  emergencyBrands: ["one9"],
  enabledBrands: ["pilot", "flying_j", "one9"],
  emergencyFillGallons: 50,
  planDef: false,
  defaultProfile: { heightIn: 162, lengthIn: 840, widthIn: 102, axleCount: 5, grossWeightLb: 80000 },
};
