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

// ═══════════════════════════════════════════════════════════════════════════════
// Roster: drivers, tractors, trailers (MCLEOD-ROSTER-SYNC-PLAN M3, D-MR3/D-MR11)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The carrier's TMS owns WHO IS EMPLOYED and WHAT IS IN THE FLEET; telematics owns what they did.
 * These three shapes carry the first answer across the seam, and they are provider-NEUTRAL for the
 * same reason the movement contract above is: the on-prem agent owns the vendor field mapping, so
 * FuelGuard never learns a vendor schema. That matters more against a database than an API — McLeod's
 * `dbo.driver` has 159 columns and no compatibility promise, and coupling the deployable to it would
 * make every carrier upgrade our problem.
 *
 * EVERY IDENTITY FIELD IS OPTIONAL, on purpose. The agent sends the subset its configured mode needs:
 * link-only sends match keys alone, so no date of birth or home address crosses the wire until the
 * milestone that actually writes them. The alternative — a required full payload — would move PII for
 * no reason during the phase that is only measuring a match, and would force a contract change later.
 *
 * There is no `row_hash` field. The agent holds the change-detection state (a hash over its own column
 * allowlist, in state.json) and posts only rows that moved; the ingest stays stateless and idempotent
 * on `external_id`, which is what makes a full re-push always safe.
 */

/** Employment status, already mapped by the agent onto FuelGuard's vocabulary (DRIVER_STATUSES). */
export const TMS_DRIVER_STATUSES = ["active", "inactive", "terminated"] as const;
export type TmsDriverStatus = (typeof TMS_DRIVER_STATUSES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const tmsDriverInputSchema = z.object({
  /** `dbo.driver.id`, trimmed. The roster link — NOT the telematics link. */
  external_id: z.string().trim().min(1).max(64),
  /** Which legal entity in the TMS this row belongs to (`dbo.company.id`: TMS, TMS2, …). */
  company_id: z.string().trim().min(1).max(32).optional(),

  // ── match keys ────────────────────────────────────────────────────────────────
  // The licence is THE key: measured 2026-08-24, McLeod carries a distinct one for 164 of 164 active
  // drivers and FuelGuard for 166 of 166, matching 162 of them. Name is the fallback and phone is not
  // available at all — McLeod holds no phone number for any of its 1,463 driver rows.
  cdl_number: z.string().trim().min(1).max(32).nullish(),
  cdl_state: z.string().trim().min(1).max(8).nullish(),
  /** Name PARTS, never a composed string: `dbo.driver.name` is the surname alone (verified — 0 of 164
   *  contain a comma and none contains the first name), so composing is the agent's job and parsing is
   *  nobody's. */
  first_name: z.string().trim().min(1).max(120).nullish(),
  middle_name: z.string().trim().min(1).max(120).nullish(),
  last_name: z.string().trim().min(1).max(120).nullish(),

  // ── identity, written from M4 onward ──────────────────────────────────────────
  status: z.enum(TMS_DRIVER_STATUSES).optional(),
  hire_date: isoDate.nullish(),
  termination_date: isoDate.nullish(),
  /** `license_date` — an EXPIRY (verified: 164/164 in the future, out to 2034). */
  cdl_expires_at: isoDate.nullish(),
  /** `medical_cert_expire`. Note `physical_date` is byte-identical to it and is not sent twice. */
  medical_card_expires_at: isoDate.nullish(),
  date_of_birth: isoDate.nullish(),
  /** Already validated by the agent — present only when it is a usable address. Where the TMS keeps
   *  it is the agent's business; this side is only ever told `email`. */
  email: z.string().trim().email().max(320).nullish(),
  address_line1: z.string().trim().max(300).nullish(),
  city: z.string().trim().max(120).nullish(),
  state: z.string().trim().max(60).nullish(),
  postal_code: z.string().trim().max(20).nullish(),
});
export type TmsDriverInput = z.infer<typeof tmsDriverInputSchema>;

export const tmsVehicleInputSchema = z.object({
  /** `dbo.tractor.id`, trimmed — which at this carrier IS the unit number. */
  external_id: z.string().trim().min(1).max(64),
  company_id: z.string().trim().min(1).max(32).optional(),

  // ── match keys ────────────────────────────────────────────────────────────────
  /** `serial_number`. Unique among ACTIVE tractors (197 of 198) but NOT across retired rows, where 72+
   *  VINs repeat — which is one reason the agent sends active rows only. */
  vin: z.string().trim().min(1).max(32).nullish(),
  unit_number: z.string().trim().min(1).max(64).nullish(),

  // ── identity, written from M4 onward ──────────────────────────────────────────
  status: z.enum(["active", "inactive"]).optional(),
  make: z.string().trim().max(120).nullish(),
  model: z.string().trim().max(120).nullish(),
  year: z.number().int().min(1900).max(2100).nullish(),
  plate: z.string().trim().max(32).nullish(),
  plate_state: z.string().trim().max(8).nullish(),
  registration_expires_at: isoDate.nullish(),
  /** `inspection_date` — the date the annual inspection was PERFORMED, not an expiry (verified:
   *  175/175 in the past). FuelGuard's column is an expiry, so the derivation happens on ingest and
   *  the raw observation crosses the wire unchanged. */
  annual_inspection_performed_at: isoDate.nullish(),
  /** `purchase_date` — 190 of 190 active tractors, every one in the past (measured 2026-08-24). */
  purchased_at: isoDate.nullish(),
});
export type TmsVehicleInput = z.infer<typeof tmsVehicleInputSchema>;

export const tmsTrailerInputSchema = z.object({
  /** `dbo.trailer.id`, trimmed. */
  external_id: z.string().trim().min(1).max(64),
  company_id: z.string().trim().min(1).max(32).optional(),

  // ── match keys ────────────────────────────────────────────────────────────────
  /** McLeod's bare unit number. FuelGuard prefixes reefers with `R` (`R532159` here is `532159`
   *  there); the INGEST normalises for matching and never rewrites a stored unit_number — renaming
   *  ~46 trailers is a user-visible decision, not a sync's (D-MR11). */
  unit_number: z.string().trim().min(1).max(64).nullish(),
  vin: z.string().trim().min(1).max(32).nullish(),

  // ── identity, written from M4 onward ──────────────────────────────────────────
  status: z.enum(["active", "inactive"]).optional(),
  /** From `trailer_type = 'R'` (45 of 240 active). The temperature columns McLeod also offers —
   *  `min_temp`, `max_temp`, `reefer_id`, `heater_code` — are entirely unpopulated at this carrier. */
  is_reefer: z.boolean().optional(),
  make: z.string().trim().max(120).nullish(),
  year: z.number().int().min(1900).max(2100).nullish(),
  plate: z.string().trim().max(32).nullish(),
  plate_state: z.string().trim().max(8).nullish(),
  /** `purchase_date` — 224 of 235 active trailers, all past. */
  purchased_at: isoDate.nullish(),
  /** `inspection_date` — 228 of 235, and 228 of 228 in the PAST, so it is the date the annual was
   *  performed, exactly like the tractor's. FuelGuard's column is an expiry; the +1 year derivation
   *  happens on ingest so the raw observation crosses the wire unchanged. */
  annual_inspection_performed_at: isoDate.nullish(),
  /** `axles` — 193 of 235, every populated row a 2. */
  axle_count: z.number().int().min(1).max(20).nullish(),
});
export type TmsTrailerInput = z.infer<typeof tmsTrailerInputSchema>;

// Batched at 1000 like the movement payloads — the whole active roster is 589 rows, so a sweep is one
// request per entity, and the cap only ever engages on a full historical push.
export const tmsDriversPayloadSchema = z.object({ drivers: z.array(tmsDriverInputSchema).max(1000) });
export const tmsVehiclesPayloadSchema = z.object({ vehicles: z.array(tmsVehicleInputSchema).max(1000) });
export const tmsTrailersPayloadSchema = z.object({ trailers: z.array(tmsTrailerInputSchema).max(1000) });
export type TmsDriversPayload = z.infer<typeof tmsDriversPayloadSchema>;
export type TmsVehiclesPayload = z.infer<typeof tmsVehiclesPayloadSchema>;
export type TmsTrailersPayload = z.infer<typeof tmsTrailersPayloadSchema>;

/**
 * Strip FuelGuard's reefer prefix so a McLeod unit number can be compared to a stored one.
 * MATCHING ONLY — never write the result back to `unit_number`.
 *
 * Measured effect (2026-08-24): trailer matches went from 157 of 235 to 201, and FuelGuard-only rows
 * from 50 to 6. The prefix is a real signal, not noise — FuelGuard has 46 `R`-prefixed trailers and
 * McLeod 45 with `trailer_type = 'R'` — which is why `is_reefer` comes from the type and never from
 * the prefix.
 */
export function trailerUnitMatchKey(unit: string | null | undefined): string {
  return (unit ?? "").trim().toUpperCase().replace(/^R(?=\d)/, "");
}

/**
 * One record leaving the active roster. Carries the link, the new status and the date — and nothing
 * else. A sweep about people LEAVING has no business moving their name, licence or address, and the
 * agent's retirement query does not read those columns at all.
 */
export const tmsRetireInputSchema = z.object({
  external_id: z.string().trim().min(1).max(64),
  company_id: z.string().trim().min(1).max(32).optional(),
  status: z.enum(["inactive", "terminated"]),
  termination_date: isoDate.nullish(),
  out_of_service_at: isoDate.nullish(),
});
export type TmsRetireInput = z.infer<typeof tmsRetireInputSchema>;
export const tmsRetirePayloadSchema = z.object({ retire: z.array(tmsRetireInputSchema).max(2000) });
