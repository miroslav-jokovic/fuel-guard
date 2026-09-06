import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { getFuelTieOut } from "./fuelTieOut.js";

/**
 * D-FIN12 at service grain: the four reads are org-scoped, only FUEL-module rows reach the
 * arithmetic, the chart of accounts supplies names, and a tractor that settled to an
 * owner-operator this month routes its fuel to the asset account. The decomposition itself has its
 * own suite in shared (fuelTieOut.test.ts).
 */
const ORG = "11111111-1111-1111-1111-111111111111";

describe("getFuelTieOut", () => {
  it("assembles the month from GL totals, the chart, settlements and EFS lines — org-scoped throughout", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        mcleod_gl_totals: [
          { post_module: "FUEL", glid: "40050000", line_count: 10, net_amount: "900.00", abs_amount: "900.00" },
          { post_module: "FUEL", glid: "17000000", line_count: 2, net_amount: "320.00", abs_amount: "320.00" },
          { post_module: "SET", glid: "20500010", line_count: 5, net_amount: "0", abs_amount: "5000.00" }, // not FUEL — ignored
        ],
        mcleod_gl_accounts: [
          { glid: "40050000", descr: "Fuel for Hired Vehicles", type_id: "Operating Expenses" },
          { glid: "17000000", descr: "Fuel Advance", type_id: "Current Assets" },
        ],
        mcleod_settlements: [
          { external_id: "S1", tractor_unit: "999", payee_type: "owner_operator", is_void: false, total_pay: 1, posted_pay: 1, accrued_at: "2026-06-05T00:00:00Z" },
          { external_id: "S2", tractor_unit: "101", payee_type: "company_driver", is_void: false, total_pay: 1, posted_pay: 1, accrued_at: "2026-06-05T00:00:00Z" },
          { external_id: "S3", tractor_unit: "555", payee_type: "owner_operator", is_void: true, total_pay: 1, posted_pay: 1, accrued_at: "2026-06-05T00:00:00Z" }, // voided — not a contractor truck this month
        ],
        efs_transactions: [
          { item: "ULSD", amt: "900.00", unit: "101", tran_date: "2026-06-10" },
          { item: "ULSD", amt: "300.00", unit: "999", tran_date: "2026-06-11" },
          { item: "DEFD", amt: "20.00", unit: "999", tran_date: "2026-06-11" },
          { item: "ULSD", amt: "50.00", unit: "555", tran_date: "2026-06-12" },
        ],
      },
    });
    const t = await getFuelTieOut(rec.client, ORG, "2026-06-01", "2026-07-01");
    expect(t.rows.find((r) => r.glid === "40050000")).toMatchObject({ label: "Fuel for Hired Vehicles", gl: 900, efs: 950, residual: -50 });
    expect(t.rows.find((r) => r.glid === "17000000")).toMatchObject({ label: "Fuel Advance", gl: 320, efs: 320, residual: 0 });
    expect(t.rows.some((r) => r.glid === "20500010")).toBe(false);
    expect(t.ownerOperatorUnits).toBe(1);
    expectOrgScoped(rec, ORG);
  });
});
