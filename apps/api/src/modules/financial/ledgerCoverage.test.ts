import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { getLedgerCoverage } from "./ledgerCoverage.js";

const ORG = "11111111-1111-1111-1111-111111111111";

describe("getLedgerCoverage", () => {
  it("claims only the proven module (SET) and reports the rest as uncovered, never as zero", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        // June 2026's real measured shape: SET's one-sided value is what settlements accrued.
        mcleod_gl_totals: [
          { post_module: "SET", glid: "20500010", line_count: 2751, net_amount: 0, abs_amount: 2525787.48 },
          { post_module: "FUEL", glid: "20550000", line_count: 57486, net_amount: 0, abs_amount: 2383148.18 },
          { post_module: "BILL", glid: "12000000", line_count: 2, net_amount: 0, abs_amount: 6200 },
        ],
        // posted_pay sums to SET's one-sided value exactly → drift 0. The voided row must not
        // count: its dollars were never paid and never posted to the accrual either (D-MC18).
        mcleod_settlements: [
          { posted_pay: 1262893.0, is_void: false },
          { posted_pay: 0.74, is_void: false },
          { posted_pay: 999.99, is_void: true },
        ],
        // One GL-booked invoice and one unposted row: only the booked one may carry the BILL
        // claim — the unposted row is F3's still-unmeasured vocabulary and stays out of every sum.
        mcleod_billing: [
          { total_charges: 3000, other_charge: 100, excise_tax: 0, post_key: "PK-1", post_module: "BILL" },
          { total_charges: 999, other_charge: 0, excise_tax: 0, post_key: null, post_module: null },
        ],
      },
    });
    const report = await getLedgerCoverage(rec.client, ORG, "2026-06-01", "2026-07-01");

    expect(report.sweptMonth).toBe(true);
    // BILL claims only the GL-booked receivable: 3000 + 100 against a $3,100 one-sided module
    // (abs 6200 / 2) → drift 0. The unposted 999 row is in staging and in NO sum.
    const bill = report.modules.find((m) => m.post_module === "BILL")!;
    expect(bill.extracted).toBe(3100);
    expect(bill.oneSidedValue).toBe(3100);
    expect(bill.drift).toBe(0);
    const set = report.modules.find((m) => m.post_module === "SET")!;
    expect(set.oneSidedValue).toBe(1262893.74);
    expect(set.source).toContain("settlement sweep");
    expect(set.drift).toBe(0);
    // FUEL has staging via EFS, not a proven McLeod tie-out from OUR store — it must read as an
    // honest gap (source null), not as a claim of zero that would report the whole module missing.
    const fuel = report.modules.find((m) => m.post_module === "FUEL")!;
    expect(fuel.source).toBeNull();
    expect(fuel.extracted).toBeNull();
    expect(report.driftingModules).toEqual([]);
    expectOrgScoped(rec, ORG);
  });

  it("an unswept month says so instead of returning an empty report that reads as clean books", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_gl_totals: [], mcleod_settlements: [], mcleod_billing: [] } });
    const report = await getLedgerCoverage(rec.client, ORG, "2026-07-01", "2026-08-01");
    expect(report.sweptMonth).toBe(false);
    expect(report.modules).toEqual([]);
    expect(report.ledgerThroughput).toBe(0);
    expectOrgScoped(rec, ORG);
  });
});
