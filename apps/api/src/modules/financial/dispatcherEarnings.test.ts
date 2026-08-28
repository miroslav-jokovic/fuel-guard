import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { earningsByDispatcher } from "./dispatcherEarnings.js";

const ORG = "11111111-1111-1111-1111-111111111111";

/**
 * Shaped after the June 2026 sandbox read: a handful of named dispatchers, one bill whose order
 * carried no operations user, and one the GL never posted.
 */
const BILLS = [
  { id: "1", external_id: "b1", order_external_id: "o1", tractor_unit: "754", driver_external_id: null, dispatcher_user_id: "vladi", dispatcher_name: "Vladi Popov", bill_date: "2026-06-02", transfer_date: null, total_charges: "3000.00", other_charge: "150.00", excise_tax: "12.00", post_key: "k1", post_module: "BILL" },
  { id: "2", external_id: "b2", order_external_id: "o2", tractor_unit: "755", driver_external_id: null, dispatcher_user_id: "vladi", dispatcher_name: "Vladi Popov", bill_date: "2026-06-03", transfer_date: null, total_charges: "2000.00", other_charge: "0", excise_tax: "0", post_key: "k2", post_module: "BILL" },
  { id: "3", external_id: "b3", order_external_id: "o3", tractor_unit: "756", driver_external_id: null, dispatcher_user_id: "chris", dispatcher_name: "Chris", bill_date: "2026-06-04", transfer_date: null, total_charges: "5000.00", other_charge: "500.00", excise_tax: "0", post_key: "k3", post_module: "BILL" },
  // Staged but never booked by the GL — must not reach the revenue columns.
  { id: "4", external_id: "b4", order_external_id: "o4", tractor_unit: "757", driver_external_id: null, dispatcher_user_id: "chris", dispatcher_name: "Chris", bill_date: "2026-06-05", transfer_date: null, total_charges: "9999.00", other_charge: "0", excise_tax: "0", post_key: null, post_module: null },
  // The order carried no operations user. Its own bucket, never spread across the named ones.
  { id: "5", external_id: "b5", order_external_id: "o5", tractor_unit: "758", driver_external_id: null, dispatcher_user_id: null, dispatcher_name: null, bill_date: "2026-06-06", transfer_date: null, total_charges: "800.00", other_charge: "0", excise_tax: "0", post_key: "k5", post_module: "BILL" },
];

const recorder = () => createSupabaseRecorder({ tables: { mcleod_billing: BILLS } });

describe("earningsByDispatcher", () => {
  it("groups booked revenue per dispatcher, largest first, org-scoped", async () => {
    const rec = recorder();
    const rows = await earningsByDispatcher(rec.client, ORG, "2026-06-01", "2026-07-01");
    expect(rows.map((r) => r.dispatcherName)).toEqual(["Chris", "Vladi Popov", null]);
    expect(rows[0]!.revenue).toBe(5500); // 5000 linehaul + 500 accessorial
    expect(rows[1]!.revenue).toBe(5150); // 3000 + 150 + 2000
    expectOrgScoped(rec, ORG);
  });

  it("counts loads and holds linehaul apart from accessorial", async () => {
    const rec = recorder();
    const rows = await earningsByDispatcher(rec.client, ORG, "2026-06-01", "2026-07-01");
    const vladi = rows.find((r) => r.dispatcherUserId === "vladi")!;
    expect(vladi.loads).toBe(2);
    expect(vladi.linehaul).toBe(5000);
    expect(vladi.accessorial).toBe(150);
  });

  // The revenue predicate is the GL's own posting, the same one CPM uses. A staged-but-unposted
  // bill counted here would put this table permanently at odds with the income statement.
  it("excludes a bill the GL never booked, and reports it as unposted instead", async () => {
    const rec = recorder();
    const rows = await earningsByDispatcher(rec.client, ORG, "2026-06-01", "2026-07-01");
    const chris = rows.find((r) => r.dispatcherUserId === "chris")!;
    expect(chris.loads).toBe(1);
    expect(chris.revenue).toBe(5500);
    expect(chris.unpostedLoads).toBe(1);
  });

  it("excludes excise tax — money collected for the government is not an earning", async () => {
    const rec = recorder();
    const rows = await earningsByDispatcher(rec.client, ORG, "2026-06-01", "2026-07-01");
    const vladi = rows.find((r) => r.dispatcherUserId === "vladi")!;
    // 3000 + 150 + 2000 = 5150, and the 12.00 of excise on bill b1 is not in it.
    expect(vladi.revenue).toBe(5150);
  });

  it("keeps an unassigned bill in its own bucket rather than dropping or spreading it", async () => {
    const rec = recorder();
    const rows = await earningsByDispatcher(rec.client, ORG, "2026-06-01", "2026-07-01");
    const unassigned = rows.find((r) => r.dispatcherUserId === null)!;
    expect(unassigned.revenue).toBe(800);
    expect(unassigned.dispatcherName).toBeNull();
    // The whole window's booked revenue is still accounted for across the rows.
    expect(rows.reduce((a, r) => a + r.revenue, 0)).toBe(5500 + 5150 + 800);
  });

  it("returns nothing for a window with no bills", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_billing: [] } });
    expect(await earningsByDispatcher(rec.client, ORG, "2026-06-01", "2026-07-01")).toEqual([]);
  });
});
