import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { countWorkOrderInvoices } from "./workOrderInvoiceCounts.js";

/**
 * The invoice count a roadside repair's work orders show (ROADSIDE-REPAIR-FLOW-PLAN RR2). The fixtures honour
 * the query's own filters, so a read that drops the org or the work order counts another carrier's or another
 * order's invoices.
 */
const ORG = "org-1";
const matches = (q: RecordedQuery, r: Record<string, unknown>) =>
  q.filters().every((f) => (Array.isArray(f.val) ? f.val.includes(r[f.col]) : r[f.col] === f.val));
const table = (rows: Record<string, unknown>[]) => (q: RecordedQuery) => ({ data: rows.filter((r) => matches(q, r)) });

const recorder = () =>
  createSupabaseRecorder({
    tables: {
      fleetpal_purchase_orders: table([
        { org_id: ORG, fleetpal_id: "po-1", work_order_fleetpal_id: "wo-1" },
        { org_id: ORG, fleetpal_id: "po-2", work_order_fleetpal_id: "wo-1" },
        { org_id: ORG, fleetpal_id: "po-x", work_order_fleetpal_id: "wo-other" },
        { org_id: "org-2", fleetpal_id: "po-theirs", work_order_fleetpal_id: "wo-2" },
      ]),
      fleetpal_po_invoices: table([
        { org_id: ORG, purchase_order_fleetpal_id: "po-1" },
        { org_id: ORG, purchase_order_fleetpal_id: "po-1" },
        { org_id: ORG, purchase_order_fleetpal_id: "po-2" },
        { org_id: ORG, purchase_order_fleetpal_id: "po-x" },
        { org_id: "org-2", purchase_order_fleetpal_id: "po-theirs" },
      ]),
    },
  });

describe("countWorkOrderInvoices", () => {
  it("counts each work order's invoices through its purchase orders, only the orders asked about, in this org", async () => {
    const rec = recorder();
    const counts = await countWorkOrderInvoices(rec.client, ORG, ["wo-1", "wo-2", "wo-1"]);
    expect([...counts]).toEqual([["wo-1", 3]]);
    expectOrgScoped(rec, ORG);
  });

  it("asks nothing for no work orders", async () => {
    const rec = recorder();
    expect((await countWorkOrderInvoices(rec.client, ORG, [])).size).toBe(0);
    expect(rec.queries).toHaveLength(0);
  });
});
