import {
  fleetpalJobItemSchema,
  fleetpalJobSchema,
  fleetpalServiceHistorySchema,
  fleetpalWorkOrderSchema,
  type FleetpalJob,
  type FleetpalJobItem,
  type FleetpalServiceHistory,
  type FleetpalWorkOrder,
} from "@silvicom/shared";
import type { ResourceIngest } from "./types.js";

/**
 * The repair record's four resources (FLEETPAL-INTEGRATION-PLAN.md F6).
 *
 * Each spec is a description, not a procedure — `runIngest` owns the walk, the staging call and the
 * watermark. What lives here is the vendor's path, the contract, and the one mapping that turns a
 * payload into 0349's columns.
 *
 * ── WHY BOTH THE WORK ORDER *AND* THE SERVICE HISTORY ARE STAGED ──────────────────────────────
 * `service-history` is the richer table by far — it carries the five-way cost split, the labour
 * hours and the meter at the time — but it exists only for CLOSED work orders. A repair that is
 * open right now appears in `work-orders` + `jobs` + `job-items` and nowhere else, so a product
 * that staged only service history could tell you what last month cost and not what is in the shop
 * today. They are two views of one thing and both are needed (§2.1).
 *
 * ── ⚠ EVERY VENDOR ID IS STAGED AS TEXT, NEVER RESOLVED HERE ──────────────────────────────────
 * `unit`, `shop`, `work_order`, `job`, `part` and the VMRS ids stay exactly as the vendor sent
 * them. Resolution happens at READ, joining on `(org_id, fleetpal_id)`. 0349's header says why at
 * length: the sweep pages each resource separately, so a child routinely arrives before its parent,
 * and a foreign key would turn that ordinary case into a failed sweep.
 */

export const workOrdersIngest: ResourceIngest<FleetpalWorkOrder> = {
  resource: "work-orders",
  path: "/v1/work-orders/",
  rpc: "stage_fleetpal_work_orders",
  schema: fleetpalWorkOrderSchema,
  updatedOf: (row) => row.updated,
  map: (row) => ({
    fleetpal_id: row.id,
    number: row.number,
    // ⚠ `reference_number`, not `number`: the reference is what a technician is holding, prefix
    // included, and it is what `part_movements.work_order_ref` will carry in F13.
    reference_number: row.reference_number,
    status: row.status,
    priority: row.priority,
    repair_priority_class: row.repair_priority_class,
    unit_fleetpal_id: row.unit,
    shop_fleetpal_id: row.shop,
    description: row.description,
    scheduled_start: row.scheduled_start,
    expected_completion: row.expected_completion,
    // `started` → `completed` is the only source of downtime anywhere in this product. Both stay
    // null when absent; a work order that never started must not read as zero days out.
    started: row.started,
    completed: row.completed,
    cancellation_reason: row.cancellation_reason,
    vendor_created_at: row.created,
    vendor_updated_at: row.updated,
  }),
};

export const jobsIngest: ResourceIngest<FleetpalJob> = {
  resource: "jobs",
  path: "/v1/jobs/",
  rpc: "stage_fleetpal_jobs",
  schema: fleetpalJobSchema,
  updatedOf: (row) => row.updated,
  map: (row) => ({
    fleetpal_id: row.id,
    work_order_fleetpal_id: row.work_order,
    name: row.name,
    description: row.description,
    component: row.component,
    complaint: row.complaint,
    reason_for_repair: row.reason_for_repair,
    // `source` plus exactly one of the three ids below is what makes the planned-versus-breakdown
    // ratio derivable rather than guessed.
    source: row.source,
    defect_fleetpal_id: row.defect,
    issue_fleetpal_id: row.issue,
    pm_schedule_fleetpal_id: row.pm_schedule,
    billable: row.billable,
    items_count: row.items_count,
    total: row.total,
  }),
};

export const jobItemsIngest: ResourceIngest<FleetpalJobItem> = {
  resource: "job-items",
  path: "/v1/job-items/",
  rpc: "stage_fleetpal_job_items",
  schema: fleetpalJobItemSchema,
  updatedOf: (row) => row.updated,
  map: (row) => ({
    fleetpal_id: row.id,
    job_fleetpal_id: row.job,
    item_type: row.type,
    description: row.description,
    part_fleetpal_id: row.part,
    part_number: row.part_number,
    universal_product_code: row.universal_product_code,
    manufacturer: row.manufacturer,
    manufacturer_part_number: row.manufacturer_part_number,
    component: row.component,
    cause: row.cause,
    unit_of_measure: row.unit_of_measure,
    // ⚠ HOURS on a LABOR line and a count on a PART one, with `unit_of_measure` saying which.
    // Summing quantity across types produces a number with no meaning.
    quantity: row.quantity,
    price: row.price,
    total: row.total,
    vendor_created_at: row.created,
    vendor_updated_at: row.updated,
  }),
};

export const serviceHistoryIngest: ResourceIngest<FleetpalServiceHistory> = {
  resource: "service-history",
  path: "/v1/service-history/",
  rpc: "stage_fleetpal_service_history",
  schema: fleetpalServiceHistorySchema,
  updatedOf: (row) => row.updated,
  map: (row) => ({
    fleetpal_id: row.id,
    work_order_fleetpal_id: row.work_order,
    work_order_reference: row.work_order_reference,
    unit_fleetpal_id: row.unit,
    shop_fleetpal_id: row.shop,
    vendor_fleetpal_id: row.vendor,
    customer_fleetpal_id: row.customer,
    // `unit_owner_name` is deliberately NOT staged. For an owner-operator's truck it is a person's
    // name, and the id beside it already answers every question a maintenance report asks; a name
    // we display nowhere is a disclosure with no purpose.
    name: row.name,
    description: row.description,
    source: row.source,
    component: row.component,
    complaint: row.complaint,
    reason_for_repair: row.reason_for_repair,
    defect_fleetpal_id: row.defect,
    issue_fleetpal_id: row.issue,
    pm_schedule_fleetpal_id: row.pm_schedule,
    billable: row.billable,
    items_count: row.items_count,
    // Every total is nullable, `total_labor_hours` included. They are staged as sent and never
    // recomputed: a total that disagrees with its parts is a fact about the vendor's data, and
    // D-FIN10's rule applies at read — print a dash, never a zero.
    total: row.total,
    total_parts: row.total_parts,
    total_labor: row.total_labor,
    total_fees: row.total_fees,
    total_tax: row.total_tax,
    total_services: row.total_services,
    total_labor_hours: row.total_labor_hours,
    // ⚠ CANONICAL METRES AND HOURS, as received (D-FP9). The conversion lives at read.
    odometer: row.odometer,
    hubometer: row.hubometer,
    engine_hours: row.engine_hours,
    apu_hours: row.apu_hours,
    started: row.started,
    completed: row.completed,
    vendor_created_at: row.created,
    vendor_updated_at: row.updated,
  }),
};
