import { z } from "zod";

/**
 * TMS (dispatch) integration contract — the NEUTRAL shape the on-prem sync agent POSTs to FuelGuard after it
 * reads the carrier's TMS (McLeod LoadMaster `ws` API is the first provider). Keeping the wire contract
 * provider-neutral means the agent owns the McLeod-specific field mapping, and FuelGuard never has to reach
 * into the carrier's network or learn a vendor's schema. Matching keys (unit numbers / driver ids) are
 * resolved to our ids on ingest.
 */

/** One movement / load, normalized by the agent. `temperature_controlled` is the reefer-alert gate. */
export const tmsMovementInputSchema = z.object({
  external_id: z.string().min(1), // the movement/order id in the TMS (idempotency key)
  vehicle_unit: z.string().trim().min(1).optional(), // matched to vehicles.unit_number
  trailer_unit: z.string().trim().min(1).optional(), // matched to trailers.unit_number
  started_at: z.string().optional(), // ISO; when the movement began
  ended_at: z.string().optional(), // ISO; when it completed (open if omitted)
  temperature_controlled: z.boolean().default(false), // true = reefer load that required the unit to run
  setpoint_f: z.number().nullable().optional(),
  commodity: z.string().nullable().optional(),
  raw: z.record(z.string(), z.unknown()).optional(), // original TMS record, for audit/debug
});
export type TmsMovementInput = z.infer<typeof tmsMovementInputSchema>;

export const tmsMovementsPayloadSchema = z.object({
  // Bounded per request; the agent chunks larger syncs into ≤1000-row batches (keeps bodies well under the
  // ingest size limit and each request cheap + retryable).
  movements: z.array(tmsMovementInputSchema).max(1000),
});
export type TmsMovementsPayload = z.infer<typeof tmsMovementsPayloadSchema>;

/** One driver home-time / time-off window, normalized by the agent. */
export const driverTimeOffInputSchema = z.object({
  external_id: z.string().optional(),
  // Match keys (any one the carrier's data provides) → resolved to drivers on ingest.
  driver_employee_id: z.string().trim().min(1).optional(), // matched to drivers.employee_id
  driver_samsara_id: z.string().trim().min(1).optional(), // matched to drivers.samsara_driver_id
  start_at: z.string(), // ISO; window start (required)
  end_at: z.string().optional(), // ISO; window end (open if omitted)
  kind: z.enum(["home_time", "pto", "unavailable"]).default("home_time"),
  raw: z.record(z.string(), z.unknown()).optional(),
});
export type DriverTimeOffInput = z.infer<typeof driverTimeOffInputSchema>;

export const driverTimeOffPayloadSchema = z.object({
  windows: z.array(driverTimeOffInputSchema).max(1000),
});
export type DriverTimeOffPayload = z.infer<typeof driverTimeOffPayloadSchema>;

/** TMS providers we support (extensible). */
export const TMS_PROVIDERS = ["mcleod"] as const;
export type TmsProvider = (typeof TMS_PROVIDERS)[number];
