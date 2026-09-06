import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { getBillingActivity } from "./billingActivity.js";

const ORG = "11111111-1111-1111-1111-111111111111";

/**
 * The weekly activity service (W2). Its whole job is to fetch, filter and hand over, so what is
 * pinned is the filtering: which bills count, and which are excluded but stated.
 *
 * Function fixtures, because `supabaseRecorder` records filters without applying them — a flat array
 * answers a July window with June's rows, and a bucketing assertion then passes for the wrong reason.
 */
const BILLS = [
  // 2026-07-06 is a Monday. Two loads in its week, both GL-booked.
  { id: "b1", delivery_date: "2026-07-08", total_charges: 3000, other_charge: 200, distance: 1000, post_key: "K1", post_module: "BILL" },
  { id: "b2", delivery_date: "2026-07-10", total_charges: 1800, other_charge: 0, distance: 600, post_key: "K2", post_module: "BILL" },
  // The next week, and a bill with no distance in it.
  { id: "b3", delivery_date: "2026-07-14", total_charges: 900, other_charge: 0, distance: null, post_key: "K3", post_module: "BILL" },
  // Not booked by the GL yet — counted as unposted, never as revenue (D-MC12).
  { id: "b4", delivery_date: "2026-07-09", total_charges: 999999, other_charge: 0, distance: 9999, post_key: null, post_module: null },
  // Outside the window; the fixture filters, so a service that dropped its bounds would pick it up.
  { id: "b5", delivery_date: "2026-08-03", total_charges: 5000, other_charge: 0, distance: 1000, post_key: "K5", post_module: "BILL" },
];

const recorder = () =>
  createSupabaseRecorder({
    tables: {
      mcleod_billing: (q) => {
        const ops = q.ops;
        const gte = ops.find((o) => o.method === "gte" && o.args[0] === "delivery_date")?.args[1] as string | undefined;
        const lt = ops.find((o) => o.method === "lt" && o.args[0] === "delivery_date")?.args[1] as string | undefined;
        return BILLS.filter((b) => (!gte || b.delivery_date >= gte) && (!lt || b.delivery_date < lt));
      },
    },
  });

describe("getBillingActivity", () => {
  it("buckets the window's booked bills into Monday weeks, org-scoped", async () => {
    const rec = recorder();
    const r = await getBillingActivity(rec.client, ORG, "2026-07-01", "2026-08-01", "week");
    expect(r.periods.map((p) => p.from)).toEqual(["2026-07-06", "2026-07-13"]);
    expect(r.periods[0]!.loads).toBe(2);
    expect(r.periods[0]!.revenue).toBe(5000);
    expect(r.periods[0]!.billedMiles).toBe(1600);
    expect(r.grain).toBe("week");
    expectOrgScoped(rec, ORG);
  });

  /**
   * The same predicate every other revenue figure on this section uses. Without it the weekly view
   * would quietly disagree with the income statement above it — by $999,999 in this fixture.
   */
  it("counts only what the GL booked, and states how many it left out", async () => {
    const r = await getBillingActivity(recorder().client, ORG, "2026-07-01", "2026-08-01", "week");
    expect(r.unpostedBills).toBe(1);
    expect(r.periods.every((p) => p.revenue !== 999_999)).toBe(true);
  });

  it("ends the window where the caller asked, not wherever the table ends", async () => {
    const r = await getBillingActivity(recorder().client, ORG, "2026-07-01", "2026-08-01", "week");
    expect(r.periods.map((p) => p.from)).not.toContain("2026-08-03");
    expect(r.window).toEqual({ from: "2026-07-01", to: "2026-08-01" });
  });

  it("keeps a bill with no distance as a load, and says so", async () => {
    const r = await getBillingActivity(recorder().client, ORG, "2026-07-01", "2026-08-01", "week");
    const second = r.periods.find((p) => p.from === "2026-07-13")!;
    expect(second.loads).toBe(1);
    expect(second.loadsWithoutDistance).toBe(1);
    expect(second.revenuePerBilledMile).toBeNull();
  });

  it("serves a monthly grain from the same rule", async () => {
    const r = await getBillingActivity(recorder().client, ORG, "2026-07-01", "2026-08-01", "month");
    expect(r.periods).toHaveLength(1);
    expect(r.periods[0]!.from).toBe("2026-07-01");
    expect(r.periods[0]!.loads).toBe(3);
  });
});
