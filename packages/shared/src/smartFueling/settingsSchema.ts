/** Zod schema for the Planned-Fueling Settings form (shared by web validation + type). Mirrors the
 *  driver-performance schema. Bounds keep the planner in a safe, sensible envelope. */
import { z } from "zod";

const brandList = z.array(z.string().trim().min(1)).max(30);
const stateList = z.array(z.string().trim().length(2)).max(60);

export const routeFuelSettingsFormSchema = z.object({
  // Safety & feasibility
  reserve_pct: z.coerce.number().min(0).max(50),
  mpg_safety_factor: z.coerce.number().min(0.5).max(1),
  emergency_fill_gallons: z.coerce.number().min(0).max(500),
  min_purchase_gal: z.coerce.number().min(0).max(500),
  // Corridor & routing
  corridor_miles: z.coerce.number().min(0.5).max(25),
  deviation_threshold_mi: z.coerce.number().min(0).max(100),
  // Prices
  price_ttl_hours: z.coerce.number().int().min(1).max(8760),
  // Policy
  always_fill_full: z.boolean(),
  fill_cap_pct: z.coerce.number().min(10).max(100),
  plan_def: z.boolean(),
  preferred_brands: brandList,
  avoid_brands: brandList,
  emergency_brands: brandList,
  avoid_states: stateList,
  fuel_before_states: stateList,
  // Default truck routing profile (HERE) — US customary inches / lb
  default_height_in: z.coerce.number().min(100).max(200),
  default_length_in: z.coerce.number().min(200).max(1000),
  default_width_in: z.coerce.number().min(90).max(130),
  default_axle_count: z.coerce.number().int().min(2).max(12),
  default_gross_weight_lb: z.coerce.number().min(10000).max(200000),
});

export type RouteFuelSettingsForm = z.infer<typeof routeFuelSettingsFormSchema>;

/** Field defaults for the form when the org has no saved row yet (mirrors DEFAULT_ROUTE_FUEL_SETTINGS). */
export const ROUTE_FUEL_SETTINGS_DEFAULTS: RouteFuelSettingsForm = {
  reserve_pct: 20,
  mpg_safety_factor: 0.9,
  emergency_fill_gallons: 50,
  min_purchase_gal: 50,
  corridor_miles: 2.5,
  deviation_threshold_mi: 3,
  price_ttl_hours: 30,
  always_fill_full: false,
  fill_cap_pct: 75,
  plan_def: false,
  preferred_brands: ["pilot", "flying_j"],
  avoid_brands: ["one9"],
  emergency_brands: ["one9"],
  avoid_states: ["CA"],
  fuel_before_states: ["MA"],
  default_height_in: 162,
  default_length_in: 840,
  default_width_in: 102,
  default_axle_count: 5,
  default_gross_weight_lb: 80000,
};
