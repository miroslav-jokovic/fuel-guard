import { z } from "zod";
import { canonicalMeter, fleetpalId, timestamp } from "./primitives.js";

/**
 * The equipment side of FleetPal: the unit itself, what its meters read, what it is scheduled for,
 * and what is wrong with it (FLEETPAL-INTEGRATION-PLAN.md §F1).
 *
 * Every VMRS-shaped field here — `component`, `complaint`, `reason_for_repair`,
 * `vmrs_manufacturer`, `vmrs_equipment_category` — is an **id**, and the id is all we ever store
 * (D-FP8). The vendor will resolve it to a code and an English description through `/v1/vmrs-*`;
 * the code is a fact about a repair we performed and is ours, the description is licensed TMC
 * material and is not, so it is fetched at display time and dropped. Nothing in this file has a
 * description field, and that is the design rather than an omission.
 */

// ── the unit ────────────────────────────────────────────────────────────────────────────────────

/**
 * A truck, a trailer, or anything else the shop maintains — FleetPal does not separate them, and
 * `vmrs_equipment_category` is its own answer to which is which.
 *
 * ⚠ **That category is a HINT and never the decision** (D-FP7, §2.6). Our matcher resolves a unit
 * by VIN first and `number` second, against `vehicles` and `trailers`; a unit whose VIN matches
 * trailer 4102 is a trailer whatever its category says, because the VIN is a fact about the
 * equipment and the category is a data-entry field in somebody else's system.
 *
 * `archived` is a timestamp-or-null rather than a boolean: archived units stay readable and reject
 * new activity, so an archived unit with historic work orders is normal and must not be dropped
 * from a cost report about the months it was running.
 */
export const fleetpalUnitSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  name: z.string(),
  /** The fleet number. What most integrations match on, and our fallback when there is no VIN. */
  number: z.string(),
  /** Check-digit validated by the vendor when present, and stored uppercase. Our primary match key. */
  vin: z.string(),
  license_plate: z.string(),
  color: z.string(),
  model: z.string(),
  model_year: z.number().int().nullable(),
  serial_number: z.string(),
  ownership: z.string(),
  owner: fleetpalId.nullable(),
  engine_hp: z.number().int().nullable(),
  engine_model: z.string(),
  engine_serial_number: z.string(),
  engine_vmrs_manufacturer: fleetpalId.nullable(),
  tire_size: z.string(),
  transmission_gears: z.number().int().nullable(),
  transmission_model: z.string(),
  transmission_serial_number: z.string(),
  transmission_vmrs_manufacturer: fleetpalId.nullable(),
  vmrs_equipment_category: fleetpalId.nullable(),
  vmrs_manufacturer: fleetpalId.nullable(),
  /** When the unit was archived, or null while active. Archive happens in the app, not through the API. */
  archived: timestamp.nullable(),
  created: timestamp,
  updated: timestamp,
});
export type FleetpalUnit = z.infer<typeof fleetpalUnitSchema>;

// ── meters ──────────────────────────────────────────────────────────────────────────────────────

/**
 * One meter reading. **`value` is canonical — metres for `ODOMETER` and `HUBOMETER`, hours for
 * `ENGINE_HOURS` and `APU_HOURS`** — never the company's display units. See `primitives.ts` §2.
 *
 * This is also the one shape we ever WRITE (F14, the Samsara odometer push), and the vendor rejects
 * a write three ways that a reader never sees: the meter type must already be tracked on the unit,
 * the value must not sit out of order against the readings either side of its timestamp, and a unit
 * may not hold two readings of the same type at the same timestamp with different values. The
 * pusher treats an out-of-order rejection as expected rather than as an error to retry.
 */
export const fleetpalMeterSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  unit: fleetpalId,
  type: z.string(),
  value: canonicalMeter,
  /** `API` for anything created through the API; other values for app and integration sources. */
  source: z.string(),
  timestamp,
  created: timestamp,
  updated: timestamp,
});
export type FleetpalMeter = z.infer<typeof fleetpalMeterSchema>;

// ── preventive maintenance ──────────────────────────────────────────────────────────────────────

/**
 * One trigger on a PM schedule. The schedule comes due on whichever of its intervals fires first.
 *
 * ⚠ **`value_int` is canonical for meter intervals and a COUNT for time ones** — 40,000 miles
 * arrives as its metre equivalent, while six months arrives as `value_int: 6` with
 * `value_time_type: "MONTH"`. Reading the two the same way is how a truck ends up due every six
 * metres. `last_done_meter_value` is the reading the next due point is measured from, and is null
 * on time intervals and before the first service.
 *
 * It has no `url` because it is not readable on its own — the vendor's rule is that an embedded
 * object carries a `url` only when it has its own endpoint, and a pm-schedule interval does not.
 */
export const fleetpalIntervalSchema = z.looseObject({
  id: fleetpalId,
  type: z.string(),
  value_int: z.number().int().nullable(),
  value_time_type: z.string().nullable(),
  threshold_int: z.number().int().nullable(),
  threshold_time_type: z.string().nullable(),
  last_done_meter_value: canonicalMeter.nullable(),
  /** Display position. Carries no scheduling meaning — do not sort due-dates by it. */
  order: z.number().int(),
});
export type FleetpalInterval = z.infer<typeof fleetpalIntervalSchema>;

export const fleetpalPmScheduleSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  unit: fleetpalId,
  name: z.string(),
  description: z.string(),
  component: z.string(),
  reason_for_repair: z.string(),
  /** When last completed, or null if it never has been. */
  last_done: timestamp.nullable(),
  auto_create_wo: z.boolean(),
  intervals: z.array(fleetpalIntervalSchema),
  created: timestamp,
  updated: timestamp,
});
export type FleetpalPmSchedule = z.infer<typeof fleetpalPmScheduleSchema>;

// ── what is wrong with it ───────────────────────────────────────────────────────────────────────

/**
 * A defect found on an inspection.
 *
 * ⚠ **`dvirs` is an array of ids that NOTHING RESOLVES.** There is no `/v1/dvirs` endpoint in the
 * vendor's API — verified against the full path list, §2.10.1 — so these are opaque references we
 * store and cannot follow. Any DVIR surface in the product comes from our own driver app. They are
 * kept because a defect carried across several inspections lists several of them, which is
 * evidence of how long it went unrepaired even when we cannot open the reports themselves.
 *
 * ⚠ **This resource has NO `updated` field and therefore no `updated_after` filter**, so it cannot
 * be watermarked like the rest. §2.7's bounded re-read applies: pull `is_resolved=false` in full
 * for the outstanding ones, plus `detected_after=<last run>` to catch the ones that resolved in
 * between. F7 owns that, and its code says so — three resources syncing differently invites a
 * later maintainer to "fix" the odd ones out.
 */
export const fleetpalDefectSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  unit: fleetpalId,
  dvirs: z.array(z.string()),
  name: z.string().nullable(),
  description: z.string().nullable(),
  severity: z.string().nullable(),
  component: fleetpalId.nullable(),
  complaint: fleetpalId.nullable(),
  detected_on: timestamp,
  /** The repair itself is a job with `source: "DEFECT"` pointing back here. */
  is_resolved: z.boolean(),
  resolved_on: timestamp.nullable(),
  driver_comment: z.string().nullable(),
  repair_note: z.string().nullable(),
});
export type FleetpalDefect = z.infer<typeof fleetpalDefectSchema>;

/** A reported problem, ahead of any work order. Unlike a defect this one IS watermarked. */
export const fleetpalIssueSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  name: z.string(),
  unit: fleetpalId,
  description: z.string(),
  priority: z.string(),
  component: z.string(),
  reason_for_repair: fleetpalId.nullable(),
  complaint: fleetpalId.nullable(),
  reported: timestamp,
  status: z.string(),
  reason_closed: z.string(),
  created: timestamp,
  updated: timestamp,
});
export type FleetpalIssue = z.infer<typeof fleetpalIssueSchema>;

/**
 * A dated obligation against a unit — registration, insurance, a permit.
 *
 * ⚠ **`target_status` is "a unit status id" and NOTHING EXPOSES THOSE IDS.** The vendor references
 * a unit-status resource three times across the document and ships no endpoint for it, and `Unit`
 * itself carries no status field at all (§2.10.5). So we can read that lapsing this obligation
 * changes the unit's status, and we cannot say to what. It is stored as the opaque id it is.
 *
 * Like defects, this resource has **no `updated` field**: the bounded re-read is
 * `is_completed=false` in full, which is small.
 */
export const fleetpalExpirationSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  unit: fleetpalId,
  name: z.string(),
  description: z.string(),
  expiration_date: timestamp,
  threshold_value: z.number().int().nullable(),
  threshold_type: z.string().nullable(),
  alters_unit_status: z.boolean(),
  target_status: z.string().nullable(),
  is_completed: z.boolean(),
  /** Derived by the vendor from the date and the threshold: PLANNED · DUE_SOON · OVERDUE · COMPLETED. */
  status: z.string(),
});
export type FleetpalExpiration = z.infer<typeof fleetpalExpirationSchema>;
