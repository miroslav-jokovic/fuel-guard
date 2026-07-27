import { z } from "zod";
import { orgModuleSchema } from "./entitlements.js";

// Driver App API contract (plan §23.2 / D24). The client parses responses with these — never trusts
// raw shapes. Numeric columns arrive as number|string from PostgREST, so coerce.

export const meDriverSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  status: z.string(),
  employee_id: z.string().nullable(),
  phone: z.string().nullable(),
});
export type MeDriver = z.infer<typeof meDriverSchema>;

export const meAssignedVehicleSchema = z.object({
  id: z.uuid(),
  unit_number: z.string(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  fuel_type: z.string(),
  tank_capacity_gal: z.coerce.number(),
  current_odometer: z.coerce.number(),
});
export type MeAssignedVehicle = z.infer<typeof meAssignedVehicleSchema>;

export const meDriverResponseSchema = z.object({
  driver: meDriverSchema,
  vehicles: z.array(meAssignedVehicleSchema),
  /** Which modules this tenant has bought — the app hides what it does not have (D55). */
  modules: z.array(orgModuleSchema).default([]),
});
export type MeDriverResponse = z.infer<typeof meDriverResponseSchema>;
