import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
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
          { total_charges: 3100, other_charge: 100, excise_tax: 0, post_key: "PK-1", post_module: "BILL" },
          { total_charges: 999, other_charge: 0, excise_tax: 0, post_key: null, post_module: null },
        ],
      },
    });
    const report = await getLedgerCoverage(rec.client, ORG, "2026-06-01", "2026-07-01");

    expect(report.sweptMonth).toBe(true);
    // BILL claims only the GL-booked receivable: the 3100 bill (its 100 of accessorials inside it) against a $3,100 one-sided module
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

  /**
   * July 2026 on the sandbox: 1,467 invoices +5,028,444.73 and 55 credits −213,124.32 net to the BILL
   * receivable — a credit's staged total_charges is POSITIVE and only bill_type says it is a credit
   * (TRUCK-DRIVER-PNL-PLAN §1.3 D2). Read unsigned, the claim would drift by twice the credits.
   */
  it("subtracts a credit memo from the BILL claim, so July's invoices and credits tie to the receivable", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        // The two July sums, plus 24.00 of excise on the credit so the excise is signed too.
        mcleod_gl_totals: [{ post_module: "BILL", glid: "12000000", line_count: 2, net_amount: 0, abs_amount: 9_630_592.82 }],
        mcleod_settlements: [],
        // A PostgREST-shaped fixture: it projects the select list, so a reader that stops selecting
        // bill_type gets rows without it — a whole-row fake would hide that ([[supabase-recorder-does-not-filter]]).
        mcleod_billing: postgrestFixture([
          { org_id: ORG, id: "i", delivery_date: "2026-07-10", bill_date: "2026-07-11", total_charges: 5_028_444.73, other_charge: 0, excise_tax: 0, bill_type: "I", post_key: "PK-I", post_module: "BILL" },
          { org_id: ORG, id: "c", delivery_date: "2026-07-12", bill_date: "2026-07-20", total_charges: 213_124.32, other_charge: 0, excise_tax: 24, bill_type: "C", post_key: "PK-C", post_module: "BILL" },
        ]),
      },
    });
    const report = await getLedgerCoverage(rec.client, ORG, "2026-07-01", "2026-08-01");
    const bill = report.modules.find((m) => m.post_module === "BILL")!;
    expect(bill.extracted).toBe(4_815_296.41);
    expect(bill.drift).toBe(0);
    expect(bill.source).not.toContain("swept before bill_type existed");
    expectOrgScoped(rec, ORG);
  });

  it("names the bills swept before bill_type existed, because a credit among them reads as an invoice", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        mcleod_gl_totals: [{ post_module: "BILL", glid: "12000000", line_count: 1, net_amount: 0, abs_amount: 6000 }],
        mcleod_settlements: [],
        mcleod_billing: [
          { total_charges: 3000, other_charge: 0, excise_tax: 0, bill_type: null, post_key: "PK-1", post_module: "BILL" },
          { total_charges: 2000, other_charge: 0, excise_tax: 0, bill_type: null, post_key: "PK-2", post_module: "BILL" },
          { total_charges: 1000, other_charge: 0, excise_tax: 0, bill_type: "I", post_key: "PK-3", post_module: "BILL" },
        ],
      },
    });
    const report = await getLedgerCoverage(rec.client, ORG, "2026-07-01", "2026-08-01");
    const bill = report.modules.find((m) => m.post_module === "BILL")!;
    expect(bill.extracted).toBe(6000);
    expect(bill.source).toContain("2 bills swept before bill_type existed, read as invoices");
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
