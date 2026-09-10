import { z } from "zod";
import { canonicalMeter, fleetpalId, money, timestamp } from "./primitives.js";

/**
 * The repair record — the reason this integration exists.
 *
 * FleetPal is the ONLY source in the stack that knows what one truck cost to repair.
 * `mcleod_gl_totals` is grained `org × company × period × post_module × glid` and carries no
 * equipment dimension at all; `mcleod_ap_vouchers` names the truck in free text D-FS5 forbids
 * parsing. So these four shapes are what makes per-unit maintenance cost possible (D-FP3).
 *
 * ── ⚠ THE COST THEY CARRY IS OPERATIONAL, NOT FINANCIAL ──────────────────────────────────────
 * None of it ever reaches `financial_entries` or the fleet report. D-FLEET2 made McLeod's general
 * ledger the entire financial input on 2026-09-03 and that stands. What FleetPal knows is what the
 * shop spent THROUGH FLEETPAL; what the ledger knows is what the company spent on maintenance
 * through every channel, and a roadside call invoiced straight to AP never touches FleetPal. The
 * two will disagree, the gap is not an error, and D-FP4 is why no surface prints one of these
 * totals without the coverage ratio measuring how much of the ledger it represents.
 *
 * ── D-FP5: TWO VIEWS, NEITHER DERIVED FROM THE OTHER ─────────────────────────────────────────
 * `ServiceHistory` is the historical record and covers CLOSED work orders only. `WorkOrder` + `Job`
 * + `JobItem` is the in-flight one, and is the only way to answer "is truck 654 in the shop right
 * now". Both are staged. A repair that is COMPLETED but not yet CLOSED appears in the second and
 * not the first, which is exactly the window a shop cares about most.
 */

// ── the work order ──────────────────────────────────────────────────────────────────────────────

/**
 * A visit to the shop.
 *
 * **`started` → `completed` is the only source of DOWNTIME anywhere in this product.** Nothing else
 * in the stack records when a truck went out of service and came back — not McLeod, not Samsara,
 * not our own roster. Both are nullable, so a work order that never started and one still open both
 * read as null and must not be counted as zero days out.
 *
 * ⚠ **Reconcile on `reference_number`, not `number`.** `number` is the sequential id within the
 * company; `reference_number` is what the app shows and what is printed on the paper a technician
 * is holding, including any shop prefix. `part_movements.work_order_ref` carries the reference,
 * because the whole point of that column is to match a human's document (D-INV10).
 */
export const fleetpalWorkOrderSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  number: z.number().int(),
  reference_number: z.string(),
  /** PENDING · OPEN · COMPLETED · CLOSED · CANCELED. Work finishes at COMPLETED, settles at CLOSED. */
  status: z.string(),
  unit: fleetpalId,
  /** Null when the work was handled outside our own locations — a vendor shop, or the roadside. */
  shop: fleetpalId.nullable(),
  priority: z.string(),
  /** VMRS repair class: SCHEDULED planned, NON_SCHEDULED unplanned, EMERGENCY roadside or breakdown. */
  repair_priority_class: z.string(),
  description: z.string(),
  scheduled_start: timestamp.nullable(),
  started: timestamp.nullable(),
  expected_completion: timestamp.nullable(),
  completed: timestamp.nullable(),
  cancellation_reason: z.string(),
  created: timestamp,
  updated: timestamp,
});
export type FleetpalWorkOrder = z.infer<typeof fleetpalWorkOrderSchema>;

// ── the job, and its lines ──────────────────────────────────────────────────────────────────────

/**
 * One task on a work order. `source` says what caused it to exist and exactly one of
 * `pm_schedule` / `defect` / `issue` points at the origin — which is what makes the
 * planned-versus-breakdown ratio derivable rather than guessed.
 *
 * `total` is nullable. A job with lines but no priced ones is a real state, and D-FIN10's rule
 * applies: read a missing total as null and print a dash, never as zero.
 */
export const fleetpalJobSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  work_order: fleetpalId,
  name: z.string(),
  description: z.string(),
  /** MANUAL · PM_SCHEDULE · DEFECT · ISSUE. */
  source: z.string(),
  component: z.string(),
  reason_for_repair: fleetpalId.nullable(),
  complaint: fleetpalId.nullable(),
  pm_schedule: fleetpalId.nullable(),
  defect: fleetpalId.nullable(),
  issue: fleetpalId.nullable(),
  billable: z.boolean(),
  items_count: z.number().int(),
  total: money.nullable(),
  created: timestamp,
  updated: timestamp,
});
export type FleetpalJob = z.infer<typeof fleetpalJobSchema>;

/**
 * One priced line on a job — the finest grain the vendor asserts, and therefore the grain we stage
 * (D-FP6 / D-FLEET9). A collector that pre-aggregated to the job would turn every later question
 * about parts-versus-labour into a schema change.
 *
 * ⚠ **`quantity` means HOURS on a `LABOR` line** and a count on a `PART` one, with
 * `unit_of_measure` saying which. Summing quantity across types produces a number with no meaning.
 *
 * ⚠ **`part` is null on one-off parts that were never added to the catalogue**, as well as on
 * labour, fee and tax lines — but `part_number` still carries what was typed. So F13's `issued`
 * movement can only be written for a line that resolves to a catalogue part we hold; a one-off is
 * a real repair and not a shelf event, and must not be invented into one.
 *
 * `part_number` is copied from the catalogue at the time, so it stays correct if the part is
 * renumbered later — which is the vendor doing for their line what `fleetpal_id` does for our
 * catalogue (F12).
 */
export const fleetpalJobItemSchema = z.looseObject({
  url: z.string(),
  id: fleetpalId,
  job: fleetpalId,
  /** PART · LABOR · FEE · TAX · SERVICE (work bought in from a vendor). */
  type: z.string(),
  description: z.string(),
  part: fleetpalId.nullable(),
  part_number: z.string().nullable(),
  universal_product_code: z.string().nullable(),
  manufacturer: fleetpalId.nullable(),
  manufacturer_part_number: z.string(),
  component: z.string(),
  cause: fleetpalId.nullable(),
  unit_of_measure: z.string().nullable(),
  quantity: z.number(),
  price: money,
  total: money,
  created: timestamp,
  updated: timestamp,
});
export type FleetpalJobItem = z.infer<typeof fleetpalJobItemSchema>;

// ── the pre-joined history ──────────────────────────────────────────────────────────────────────

/**
 * A job on a CLOSED work order, pre-joined by the vendor with the context a service-history report
 * needs. This one shape answers, per unit and per repair: what it cost split five ways, how many
 * labour hours went into it, what the meters read at the time, what was worked on and why, whether
 * it was planned, how long it took, and who did it.
 *
 * ⚠ **The four meter fields are canonical** — metres for `odometer` and `hubometer`, hours for the
 * other two — and each is null when the unit does not track that meter or has no reading near the
 * date. Null is not zero: a cost-per-mile computed against a missing odometer is the
 * plausible-but-wrong figure D-FIN10 exists to refuse.
 *
 * ⚠ **Every `total_*` is nullable**, including `total_labor_hours`. Print a dash, never a zero.
 *
 * `unit_owner_name` is our own company's name for a unit we own outright, and the customer's for
 * one we do not — which is how an owner-operator's repair separates without a second lookup.
 */
export const fleetpalServiceHistorySchema = z.looseObject({
  id: fleetpalId,
  work_order: fleetpalId,
  work_order_reference: z.string(),
  unit: fleetpalId,
  unit_owner_name: z.string(),
  shop: fleetpalId.nullable(),
  customer: fleetpalId.nullable(),
  /** The vendor that performed the work, or null when the work order has no purchase order. */
  vendor: fleetpalId.nullable(),
  started: timestamp.nullable(),
  /** Never null here — only jobs on closed work orders reach service history. */
  completed: timestamp,
  name: z.string(),
  description: z.string(),
  source: z.string(),
  component: z.string(),
  reason_for_repair: fleetpalId.nullable(),
  complaint: fleetpalId.nullable(),
  pm_schedule: fleetpalId.nullable(),
  defect: fleetpalId.nullable(),
  issue: fleetpalId.nullable(),
  billable: z.boolean(),
  items_count: z.number().int(),
  total: money.nullable(),
  total_parts: money.nullable(),
  total_labor: money.nullable(),
  total_fees: money.nullable(),
  total_tax: money.nullable(),
  total_services: money.nullable(),
  total_labor_hours: z.number().nullable(),
  odometer: canonicalMeter.nullable(),
  engine_hours: canonicalMeter.nullable(),
  hubometer: canonicalMeter.nullable(),
  apu_hours: canonicalMeter.nullable(),
  created: timestamp,
  updated: timestamp,
});
export type FleetpalServiceHistory = z.infer<typeof fleetpalServiceHistorySchema>;
