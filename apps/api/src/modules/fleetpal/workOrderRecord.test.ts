import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { readWorkOrderRecords } from "./workOrderRecord.js";

/**
 * A named work order in full, for the roadside repair record (IC11 B2, Q-IC12 (a)). Pinned: parts and labour
 * reach the order through its jobs, a vendor invoice only through a purchase order raised on it, and "as of"
 * is the stalest of the five resources read — unknown when one never synced. Fixtures honour the query's own
 * `org_id` and `.in()` filters, so a read that forgets one gets another carrier's or another order's rows.
 */

const ORG = "org-1";
const RESOURCES = ["work-orders", "jobs", "job-items", "purchase-orders", "purchase-order-invoices"];

const matches = (q: RecordedQuery, r: Record<string, unknown>) =>
  q.filters().every((f) => (Array.isArray(f.val) ? f.val.includes(r[f.col]) : r[f.col] === f.val));
const table = (rows: Record<string, unknown>[]) => (q: RecordedQuery) => ({ data: rows.filter((r) => matches(q, r)) });

function recorder(sync = RESOURCES.map((resource, i) => ({ org_id: ORG, resource, last_run_at: `2026-10-16T1${i}:00:00Z` }))) {
  return createSupabaseRecorder({
    tables: {
      fleetpal_sync_state: table(sync),
      fleetpal_work_orders: table([
        { org_id: ORG, fleetpal_id: "wo-1", reference_number: "WO-1", status: "CLOSED", vendor_created_at: "2026-10-07T14:00:00Z", completed: null, description: "Brakes" },
        { org_id: ORG, fleetpal_id: "wo-2", reference_number: "WO-2", status: "OPEN", vendor_created_at: "2026-10-08T14:00:00Z", completed: null, description: null },
        { org_id: "org-2", fleetpal_id: "wo-1", reference_number: "THEIRS", status: "CLOSED", vendor_created_at: "2026-10-07T14:00:00Z", completed: null, description: null },
      ]),
      fleetpal_jobs: table([
        { org_id: ORG, fleetpal_id: "j-1", work_order_fleetpal_id: "wo-1", name: "Adjust brakes", description: null, complaint: "393.47", total: "312.50" },
        { org_id: ORG, fleetpal_id: "j-9", work_order_fleetpal_id: "wo-2", name: "Other order's job", description: null, complaint: null, total: null },
      ]),
      fleetpal_job_items: table([
        { org_id: ORG, job_fleetpal_id: "j-1", item_type: "LABOR", description: "Adjust", part_number: null, quantity: "1.500", unit_of_measure: null, total: "180.00" },
        { org_id: ORG, job_fleetpal_id: "j-1", item_type: "PART", description: "Slack adjuster", part_number: "HAL-1", quantity: "1", unit_of_measure: "EA", total: "132.50" },
        { org_id: ORG, job_fleetpal_id: "j-9", item_type: "PART", description: "Not this order", part_number: null, quantity: "1", unit_of_measure: null, total: "1" },
      ]),
      fleetpal_purchase_orders: table([
        { org_id: ORG, fleetpal_id: "po-1", work_order_fleetpal_id: "wo-1", reference_number: "PO-2201" },
        { org_id: ORG, fleetpal_id: "po-x", work_order_fleetpal_id: "wo-other", reference_number: "PO-OTHER" },
      ]),
      fleetpal_po_invoices: table([
        { org_id: ORG, purchase_order_fleetpal_id: "po-1", invoice_number: "INV-88", invoice_date: "2026-10-09T00:00:00Z", invoice_type: "STANDARD", amount: "1288.125" },
        { org_id: ORG, purchase_order_fleetpal_id: "po-x", invoice_number: "INV-NOT", invoice_date: null, invoice_type: "STANDARD", amount: "9" },
      ]),
    },
  });
}

describe("readWorkOrderRecords", () => {
  it("assembles a work order's jobs, their lines and the invoices billed through its purchase orders", async () => {
    const rec = recorder();
    const { orders } = await readWorkOrderRecords(rec.client, ORG, ["wo-1"]);
    expect([...orders.keys()]).toEqual(["wo-1"]);
    const wo = orders.get("wo-1")!;
    expect(wo).toMatchObject({ reference: "WO-1", status: "CLOSED", description: "Brakes" });
    expect(wo.jobs).toEqual([{
      name: "Adjust brakes", description: null, complaint: "393.47", total: 312.5,
      lines: [
        { type: "LABOR", description: "Adjust", partNumber: null, quantity: 1.5, unitOfMeasure: null, total: 180 },
        { type: "PART", description: "Slack adjuster", partNumber: "HAL-1", quantity: 1, unitOfMeasure: "EA", total: 132.5 },
      ],
    }]);
    expect(wo.invoices).toEqual([{ purchaseOrder: "PO-2201", invoiceNumber: "INV-88", invoiceDate: "2026-10-09T00:00:00Z", invoiceType: "STANDARD", amount: 1288.125 }]);
    expectOrgScoped(rec, ORG);
  });

  it("is as of the stalest resource it read", async () => {
    expect((await readWorkOrderRecords(recorder().client, ORG, ["wo-1"])).asOf).toBe("2026-10-16T10:00:00Z");
  });

  it("⚠ is as of an unknown time when one of the resources has never synced", async () => {
    const sync = RESOURCES.slice(1).map((resource) => ({ org_id: ORG, resource, last_run_at: "2026-10-16T12:00:00Z" }));
    expect((await readWorkOrderRecords(recorder(sync).client, ORG, ["wo-1"])).asOf).toBeNull();
  });

  it("reads nothing more for no work orders", async () => {
    const rec = recorder();
    expect((await readWorkOrderRecords(rec.client, ORG, [])).orders.size).toBe(0);
    expect(rec.queries.map((q) => q.table)).toEqual(["fleetpal_sync_state"]);
  });
});
