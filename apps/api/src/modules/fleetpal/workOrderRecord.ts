/**
 * Named FleetPal work orders in full — jobs, their part and labour lines, and the vendor invoices billed
 * against them — for the rendered repair record of a roadside inspection (INSPECTION-CHALLENGE-PLAN IC11 B2,
 * D-IC14; Q-IC12 (a): the "receipt" is our rendering of FleetPal's data, because FleetPal's API serves no
 * files). The inspections module asks through this module's index, as it does for `readWorkOrdersOnUnits`.
 *
 * ── AN INVOICE REACHES A WORK ORDER ONLY THROUGH ITS PURCHASE ORDER ──────────────────────────────
 * `fleetpal_po_invoices` names a purchase order; only a WORK_ORDER-type purchase order names a work order
 * (0351). An outside vendor's bill for the repair is therefore found only when the shop raised the PO on
 * the work order — which is what the rendering says when it lists none.
 *
 * ── "AS OF" IS THE LEAST RECENT OF THE RESOURCES READ ────────────────────────────────────────────
 * Each FleetPal resource syncs on its own clock (`fleetpal_sync_state`). The record is only as current as
 * the stalest of the five it is drawn from, so that is the time the rendering states.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged, type WorkOrderInvoice, type WorkOrderJob, type WorkOrderLine, type WorkOrderRecord, type WorkOrderDetailDto } from "@silvicom/shared";

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

const IN_CHUNK = 150;
const RESOURCES = ["work-orders", "jobs", "job-items", "purchase-orders", "purchase-order-invoices"] as const;

export type { WorkOrderInvoice, WorkOrderJob, WorkOrderLine, WorkOrderRecord };

export interface WorkOrderRecords {
  orders: Map<string, WorkOrderRecord>;
  /** The least recent sync of the resources read; null when one has never synced. */
  asOf: string | null;
}

function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += IN_CHUNK) out.push(xs.slice(i, i + IN_CHUNK));
  return out;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

async function inChunks<T>(ids: readonly string[], page: (ids: string[], from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const out: T[] = [];
  for (const c of chunks([...new Set(ids)])) out.push(...(await fetchAllPaged<T>((from, to) => page(c, from, to))));
  return out;
}

export async function readWorkOrderRecords(admin: SupabaseClient, orgId: string, workOrderIds: readonly string[]): Promise<WorkOrderRecords> {
  const sync = await admin.from("fleetpal_sync_state").select("resource, last_run_at").eq("org_id", orgId).in("resource", [...RESOURCES]);
  if (sync.error) throw new Error(`fleetpal_sync_state: ${sync.error.message}`);
  const runs = (sync.data ?? []) as { resource: string; last_run_at: string | null }[];
  const asOf = runs.length === RESOURCES.length && runs.every((r) => r.last_run_at)
    ? runs.map((r) => r.last_run_at!).sort()[0]!
    : null;
  const orders = new Map<string, WorkOrderRecord>();
  if (workOrderIds.length === 0) return { orders, asOf };

  type OrderRow = { fleetpal_id: string; reference_number: string | null; status: string | null; vendor_created_at: string | null; completed: string | null; description: string | null };
  const orderRows = await inChunks<OrderRow>(workOrderIds, (ids, from, to) =>
    admin.from("fleetpal_work_orders").select("fleetpal_id, reference_number, status, vendor_created_at, completed, description")
      .eq("org_id", orgId).in("fleetpal_id", ids).order("id").range(from, to));
  for (const o of orderRows) {
    orders.set(o.fleetpal_id, {
      fleetpalId: o.fleetpal_id, reference: o.reference_number, status: o.status, openedAt: o.vendor_created_at,
      completedAt: o.completed, description: o.description, jobs: [], invoices: [],
    });
  }

  type JobRow = { fleetpal_id: string; work_order_fleetpal_id: string; name: string | null; description: string | null; complaint: string | null; total: unknown };
  const jobRows = await inChunks<JobRow>([...orders.keys()], (ids, from, to) =>
    admin.from("fleetpal_jobs").select("fleetpal_id, work_order_fleetpal_id, name, description, complaint, total")
      .eq("org_id", orgId).in("work_order_fleetpal_id", ids).order("id").range(from, to));
  type ItemRow = { job_fleetpal_id: string; item_type: string | null; description: string | null; part_number: string | null; quantity: unknown; unit_of_measure: string | null; total: unknown };
  const itemRows = await inChunks<ItemRow>(jobRows.map((j) => j.fleetpal_id), (ids, from, to) =>
    admin.from("fleetpal_job_items").select("job_fleetpal_id, item_type, description, part_number, quantity, unit_of_measure, total")
      .eq("org_id", orgId).in("job_fleetpal_id", ids).order("id").range(from, to));
  const linesOf = new Map<string, WorkOrderLine[]>();
  for (const i of itemRows) {
    linesOf.set(i.job_fleetpal_id, [...(linesOf.get(i.job_fleetpal_id) ?? []), {
      type: i.item_type, description: i.description, partNumber: i.part_number, quantity: num(i.quantity), unitOfMeasure: i.unit_of_measure, total: num(i.total),
    }]);
  }
  for (const j of jobRows) {
    orders.get(j.work_order_fleetpal_id)?.jobs.push({
      name: j.name, description: j.description, complaint: j.complaint, lines: linesOf.get(j.fleetpal_id) ?? [], total: num(j.total),
    });
  }

  type PoRow = { fleetpal_id: string; work_order_fleetpal_id: string; reference_number: string | null };
  const poRows = await inChunks<PoRow>([...orders.keys()], (ids, from, to) =>
    admin.from("fleetpal_purchase_orders").select("fleetpal_id, work_order_fleetpal_id, reference_number")
      .eq("org_id", orgId).in("work_order_fleetpal_id", ids).order("id").range(from, to));
  const poOf = new Map(poRows.map((p) => [p.fleetpal_id, p]));
  type InvoiceRow = { fleetpal_id: string; purchase_order_fleetpal_id: string; invoice_number: string | null; invoice_date: string | null; invoice_type: string | null; amount: unknown };
  const invoiceRows = await inChunks<InvoiceRow>([...poOf.keys()], (ids, from, to) =>
    admin.from("fleetpal_po_invoices").select("fleetpal_id, purchase_order_fleetpal_id, invoice_number, invoice_date, invoice_type, amount")
      .eq("org_id", orgId).in("purchase_order_fleetpal_id", ids).order("id").range(from, to));
  for (const inv of invoiceRows) {
    const po = poOf.get(inv.purchase_order_fleetpal_id)!;
    orders.get(po.work_order_fleetpal_id)?.invoices.push({
      invoiceId: inv.fleetpal_id, purchaseOrder: po.reference_number, invoiceNumber: inv.invoice_number, invoiceDate: inv.invoice_date, invoiceType: inv.invoice_type, amount: num(inv.amount),
    });
  }
  return { orders, asOf };
}

/**
 * Which work order the drawer is asking for: by OUR row id — the id every Shop list carries — or by
 * FleetPal's own id, which is all a roadside repair holds (its candidates are snapshots taken when the
 * proposal was made, 0606), so the inspection page can open the same drawer without a second reader (F16).
 */
export type WorkOrderKey = { rowId: string } | { fleetpalId: string };

/**
 * One work order for the drawer (F14), scoped to the org before anything is read. Null when the org has no
 * such row, which the route answers 404: a work order of another carrier's is "not found", never "forbidden".
 */
export async function readWorkOrderDetail(admin: SupabaseClient, orgId: string, key: WorkOrderKey): Promise<WorkOrderDetailDto | null> {
  const q = admin.from("fleetpal_work_orders").select("id, fleetpal_id, unit_fleetpal_id").eq("org_id", orgId);
  const row = await ("rowId" in key ? q.eq("id", key.rowId) : q.eq("fleetpal_id", key.fleetpalId)).maybeSingle();
  if (row.error) throw new Error(`fleetpal_work_orders: ${row.error.message}`);
  const wo = row.data as { id: string; fleetpal_id: string; unit_fleetpal_id: string | null } | null;
  if (!wo) return null;
  const { orders, asOf } = await readWorkOrderRecords(admin, orgId, [wo.fleetpal_id]);
  const record = orders.get(wo.fleetpal_id);
  if (!record) return null;
  let unitNumber: string | null = null;
  if (wo.unit_fleetpal_id) {
    const unit = await admin.from("fleetpal_units").select("number").eq("org_id", orgId).eq("fleetpal_id", wo.unit_fleetpal_id).maybeSingle();
    if (unit.error) throw new Error(`fleetpal_units: ${unit.error.message}`);
    unitNumber = (unit.data as { number: string | null } | null)?.number ?? null;
  }
  return { id: wo.id, record, unitNumber, asOf };
}
