import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { readApVouchersWindow } from "./financialReads.js";

/**
 * D-FIN7: the AP window is ONE expression on both sides — coalesce(distribution_date, invoice_date),
 * what the agent sweeps on and the projection stamps occurred_at with. This pins the reader's half:
 * a distributed voucher is windowed by its distribution date, an undistributed one by its invoice
 * date, and nothing else about the query changed (org scope, stable paging order).
 */
const ORG = "11111111-1111-1111-1111-111111111111";

describe("readApVouchersWindow — one economic date", () => {
  it("windows on distribution_date, falling back to invoice_date only when distribution is null", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_ap_vouchers: [] } });
    await readApVouchersWindow(rec.client, ORG, "2026-06-01", "2026-07-01");
    const q = rec.queries.find((x) => x.table === "mcleod_ap_vouchers")!;
    const or = q.ops.find((o) => o.method === "or");
    expect(or?.args[0]).toBe(
      "and(distribution_date.gte.2026-06-01,distribution_date.lt.2026-07-01)," +
        "and(distribution_date.is.null,invoice_date.gte.2026-06-01,invoice_date.lt.2026-07-01)",
    );
    // No bare distribution_date range remains — that was the half-window the audit found.
    expect(q.ops.some((o) => (o.method === "gte" || o.method === "lt") && o.args[0] === "distribution_date")).toBe(false);
    expect(q.ops.filter((o) => o.method === "order").map((o) => o.args[0])).toEqual(["distribution_date", "id"]);
    expectOrgScoped(rec, ORG);
  });
});
