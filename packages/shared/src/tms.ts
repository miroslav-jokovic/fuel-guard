import { z } from "zod";
import type { LoadStatus } from "./loadsContract.js";

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

// ═══════════════════════════════════════════════════════════════════════════════
// Dispatchable loads from the TMS (Phase 3E, D48)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * One STOP on an ingested load, normalized by the on-prem agent from McLeod's StopService.
 * Deliberately the same vocabulary as a manually-created stop — the agent owns the McLeod field
 * mapping so FuelGuard never learns a vendor schema (the D48 seam).
 */
export const tmsStopInputSchema = z.object({
  seq: z.number().int().min(1).max(50),
  kind: z.enum(["pickup", "dropoff"]),
  name: z.string().min(1).max(200),
  address_line: z.string().max(300).nullish(),
  city: z.string().max(120).nullish(),
  state: z.string().max(60).nullish(),
  postal_code: z.string().max(20).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lon: z.number().min(-180).max(180).nullish(),
  appointment_start: z.string().nullish(),
  appointment_end: z.string().nullish(),
  notes: z.string().max(500).nullish(),
});
export type TmsStopInput = z.infer<typeof tmsStopInputSchema>;

/**
 * One dispatchable load. Distinct from `tmsMovementInputSchema`, which exists only to answer
 * "was this a temperature-controlled movement?" for reefer alerting — this one carries the driver,
 * the stops, the appointment windows and the proof-of-work expectations a driver actually works.
 *
 * Match keys are unit numbers / employee ids, resolved to our ids on ingest; anything unresolved is
 * REPORTED back rather than silently dropped, so an operator can fix the mapping.
 */
export const tmsLoadInputSchema = z.object({
  external_id: z.string().min(1), // the order/movement id in the TMS — the idempotency key
  ref: z.string().min(1).max(60), // the load number a human quotes on the phone
  driver_employee_id: z.string().trim().min(1).nullish(),
  vehicle_unit: z.string().trim().min(1).nullish(),
  trailer_unit: z.string().trim().min(1).nullish(),
  equipment: z.string().max(60).nullish(),
  commodity: z.string().max(200).nullish(),
  hazmat: z.boolean().default(false),
  total_miles: z.number().nonnegative().max(99_999).nullish(),
  notes: z.string().max(2000).nullish(),
  /** The TMS's own status, when it has one — used to detect a cancellation upstream. */
  external_status: z.string().max(60).nullish(),
  canceled: z.boolean().default(false),
  stops: z.array(tmsStopInputSchema).max(50).default([]),
  raw: z.record(z.string(), z.unknown()).optional(),
});
export type TmsLoadInput = z.infer<typeof tmsLoadInputSchema>;

export const tmsLoadsPayloadSchema = z.object({
  loads: z.array(tmsLoadInputSchema).max(500),
});
export type TmsLoadsPayload = z.infer<typeof tmsLoadsPayloadSchema>;

/** What the ingest did with each load — the agent logs this, and dispatch sees the amendments. */
export const TMS_LOAD_OUTCOMES = ["created", "updated", "amended", "unchanged", "canceled", "skipped"] as const;
export type TmsLoadOutcome = (typeof TMS_LOAD_OUTCOMES)[number];

export interface TmsLoadResult {
  external_id: string;
  ref: string;
  outcome: TmsLoadOutcome;
  /** Set on `amended` — the fields the TMS changed on a load dispatch has already approved. */
  changed?: string[];
  /** Set on `skipped` — why we did not touch it. */
  reason?: string;
}

/**
 * The fields an amendment compares. Deliberately the ones that change what a driver actually does —
 * a note or a mileage estimate drifting is not worth interrupting dispatch over.
 */
export const AMENDABLE_LOAD_FIELDS = [
  "ref",
  "equipment",
  "commodity",
  "hazmat",
  "driver_id",
  "vehicle_id",
  "trailer_id",
] as const;

/**
 * A load past `approved` is dispatch's decision, not the feed's. Once it has been approved the ingest
 * stops writing and starts REPORTING: the diff becomes an `amended` event for a human to apply or
 * dismiss (D48). Before approval the feed is still the source of truth and may overwrite freely.
 */
export function tmsMayOverwrite(status: LoadStatus): boolean {
  return status === "draft" || status === "pending_approval";
}
