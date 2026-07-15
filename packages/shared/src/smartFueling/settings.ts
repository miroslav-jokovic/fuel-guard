/**
 * Resolve a `route_fuel_settings` DB row into typed config with defaults, and compose a truck's effective
 * routing profile (per-vehicle override falling back to org default). Pure — shared by the API planner and the
 * web view so both plan with identical rules. Mirrors driverPerformance/settings.ts.
 */
import { DEFAULT_ROUTE_FUEL_SETTINGS } from "./types.js";
import type { RouteFuelSettings, TruckProfile } from "./types.js";

export interface RouteFuelSettingsRow {
  reserve_pct?: number | string | null;
  corridor_miles?: number | string | null;
  min_purchase_gal?: number | string | null;
  mpg_safety_factor?: number | string | null;
  deviation_threshold_mi?: number | string | null;
  price_ttl_hours?: number | string | null;
  always_fill_full?: boolean | null;
  avoid_states?: string[] | null;
  avoid_brands?: string[] | null;
  preferred_brands?: string[] | null;
  emergency_brands?: string[] | null;
  emergency_fill_gallons?: number | string | null;
  plan_def?: boolean | null;
  default_height_in?: number | string | null;
  default_length_in?: number | string | null;
  default_width_in?: number | string | null;
  default_axle_count?: number | string | null;
  default_gross_weight_lb?: number | string | null;
}

const num = (v: unknown, d: number): number => {
  const n = Number(v);
  return v != null && Number.isFinite(n) ? n : d;
};
const arr = (v: string[] | null | undefined, d: string[]): string[] => (Array.isArray(v) && v.length ? v : d);

export function resolveRouteFuelConfig(row: RouteFuelSettingsRow | null | undefined): RouteFuelSettings {
  const d = DEFAULT_ROUTE_FUEL_SETTINGS;
  return {
    reservePct: num(row?.reserve_pct, d.reservePct),
    corridorMiles: num(row?.corridor_miles, d.corridorMiles),
    minPurchaseGal: num(row?.min_purchase_gal, d.minPurchaseGal),
    mpgSafetyFactor: num(row?.mpg_safety_factor, d.mpgSafetyFactor),
    deviationThresholdMi: num(row?.deviation_threshold_mi, d.deviationThresholdMi),
    priceTtlHours: num(row?.price_ttl_hours, d.priceTtlHours),
    alwaysFillFull: row?.always_fill_full ?? d.alwaysFillFull,
    avoidStates: arr(row?.avoid_states, d.avoidStates),
    avoidBrands: arr(row?.avoid_brands, d.avoidBrands),
    preferredBrands: arr(row?.preferred_brands, d.preferredBrands),
    emergencyBrands: arr(row?.emergency_brands, d.emergencyBrands),
    emergencyFillGallons: num(row?.emergency_fill_gallons, d.emergencyFillGallons),
    planDef: row?.plan_def ?? d.planDef,
    defaultProfile: {
      heightIn: num(row?.default_height_in, d.defaultProfile.heightIn),
      lengthIn: num(row?.default_length_in, d.defaultProfile.lengthIn),
      widthIn: num(row?.default_width_in, d.defaultProfile.widthIn),
      axleCount: num(row?.default_axle_count, d.defaultProfile.axleCount),
      grossWeightLb: num(row?.default_gross_weight_lb, d.defaultProfile.grossWeightLb),
    },
  };
}

/** Per-vehicle routing-profile overrides (null when the truck has no stored value → org default is used). */
export interface VehicleProfileOverrides {
  heightIn?: number | null;
  lengthIn?: number | null;
  widthIn?: number | null;
  axleCount?: number | null;
  /** From the LOAD (dispatcher form), capped to the legal max; falls back to the org default when unknown. */
  grossWeightLb?: number | null;
}

/**
 * Compose the truck combination profile HERE routing should use: each dimension is the per-vehicle override
 * when present, else the org default. Gross weight comes from the load (never above the org's legal default).
 */
export function effectiveTruckProfile(
  overrides: VehicleProfileOverrides | null | undefined,
  settings: RouteFuelSettings,
): TruckProfile {
  const dflt = settings.defaultProfile;
  const o = overrides ?? {};
  const grossReq = o.grossWeightLb ?? dflt.grossWeightLb;
  return {
    heightIn: o.heightIn ?? dflt.heightIn,
    lengthIn: o.lengthIn ?? dflt.lengthIn,
    widthIn: o.widthIn ?? dflt.widthIn,
    axleCount: o.axleCount ?? dflt.axleCount,
    grossWeightLb: Math.min(grossReq, dflt.grossWeightLb), // never route as heavier than the legal max
  };
}
