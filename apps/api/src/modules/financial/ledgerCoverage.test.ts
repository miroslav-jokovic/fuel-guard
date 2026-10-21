import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import { getLedgerCoverage } from "./ledgerCoverage.js";
import type { RecordedQuery } from "../../testing/supabaseRecorder.js";

const ORG = "11111111-1111-1111-1111-111111111111";

const between = (q: RecordedQuery, col: string, v: string | undefined) => {
  const gte = q.ops.find((o) => o.method === "gte" && o.args[0] === col)?.args[1] as string | undefined;
  const lt = q.ops.find((o) => o.method === "lt" && o.args[0] === col)?.args[1] as string | undefined;
  if ((gte || lt) && !v) return false;
  return (!gte || v! >= gte) && (!lt || v! < lt);
};

type Settlement = {
  posted_pay: number;
  is_void: boolean;
  accrual_key: string;
  accrued_at: string;
  post_key?: string;
  transferred_at?: string;
  void_date?: string;
};

/** Answers the accrual-window read and the void-date read on the columns each actually filters. */
const settlementsTable = (rows: Settlement[]) => (q: RecordedQuery) =>
  q.filters().some((f) => f.col === "is_void" && f.val === true)
    ? rows.filter((s) => s.is_void && between(q, "void_date", s.void_date))
    : rows.filter((s) => between(q, "accrued_at", s.accrued_at));

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
        // count: it was re-issued on the same accrual key, and SET books a key once, for the live row.
        mcleod_settlements: settlementsTable([
          { posted_pay: 1262893.0, is_void: false, accrual_key: "K1", accrued_at: "2026-06-10T00:00:00Z" },
          { posted_pay: 0.74, is_void: false, accrual_key: "K2", accrued_at: "2026-06-11T00:00:00Z" },
          { posted_pay: 999.99, is_void: true, accrual_key: "K1", accrued_at: "2026-06-10T00:00:00Z", void_date: "2026-06-12T00:00:00Z" },
        ]),
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

  /**
   * The settlement rule, measured on the sandbox 2026-10-19 (TRUCK-DRIVER-PNL-PLAN §1.3 D3): SET books a
   * lone voided row on its accrual date, and SETV reverses a voided, TRANSFERRED row on its void date —
   * here a June accrual voided in July, which only the void-date read can find.
   */
  it("claims SETV from voided, transferred settlements on their void date, and SET from every row the ledger books", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        mcleod_gl_totals: [
          { post_module: "SET", glid: "20500010", line_count: 3, net_amount: 0, abs_amount: 3400 },
          { post_module: "SETV", glid: "20500010", line_count: 4, net_amount: 0, abs_amount: 1600 },
        ],
        mcleod_settlements: settlementsTable([
          { posted_pay: 1000, is_void: false, accrual_key: "K1", accrued_at: "2026-07-03T00:00:00Z" },
          // Alone on its key: SET still books it in July; voided before transfer, so no SETV.
          { posted_pay: 500, is_void: true, accrual_key: "K2", accrued_at: "2026-07-04T00:00:00Z", void_date: "2026-07-05T00:00:00Z" },
          // Accrued in June, voided in July after its transfer: July's SETV, not July's SET.
          { posted_pay: 600, is_void: true, accrual_key: "K3", accrued_at: "2026-06-20T00:00:00Z", post_key: "P3", transferred_at: "2026-06-25T00:00:00Z", void_date: "2026-07-15T00:00:00Z" },
          // Accrued, transferred and voided inside July, and dated: on both sides, and not "undated".
          { posted_pay: 200, is_void: true, accrual_key: "K4", accrued_at: "2026-07-06T00:00:00Z", post_key: "P4", transferred_at: "2026-07-08T00:00:00Z", void_date: "2026-07-09T00:00:00Z" },
        ]),
        mcleod_billing: [],
      },
    });
    const report = await getLedgerCoverage(rec.client, ORG, "2026-07-01", "2026-08-01");
    const set = report.modules.find((m) => m.post_module === "SET")!;
    // 1,000 + 500 + 200 against a 1,700 one-sided module; the residual the source names would show here.
    expect(set.extracted).toBe(1700);
    expect(set.drift).toBe(0);
    expect(set.source).toContain("Payable from Settlement");
    const setv = report.modules.find((m) => m.post_module === "SETV")!;
    expect(setv.extracted).toBe(800);
    expect(setv.drift).toBe(0);
    expect(setv.source).not.toContain("not yet dated");
    expectOrgScoped(rec, ORG);
  });

  it("counts the voided, transferred settlements swept before void_date existed, because no window can date them", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        mcleod_gl_totals: [{ post_module: "SETV", glid: "20500010", line_count: 2, net_amount: 0, abs_amount: 800 }],
        mcleod_settlements: settlementsTable([
          { posted_pay: 400, is_void: true, accrual_key: "K1", accrued_at: "2026-07-03T00:00:00Z", post_key: "P1", transferred_at: "2026-07-04T00:00:00Z" },
        ]),
        mcleod_billing: [],
      },
    });
    const report = await getLedgerCoverage(rec.client, ORG, "2026-07-01", "2026-08-01");
    const setv = report.modules.find((m) => m.post_module === "SETV")!;
    expect(setv.extracted).toBe(0);
    expect(setv.source).toContain("1 voided settlement swept before void_date existed, not yet dated");
  });

  /**
   * The same modules tied one posting at a time (TRUCK-DRIVER-PNL-PLAN P0c). Bill B3 is staged at 1,000
   * but posted 900, and the ledger holds a posting (B4) nobody staged: the BILL total would hide
   * neither if they happened to cancel, and the key tie names both. SET and SETV tie to the cent on
   * the settlement rule's own rows.
   */
  it("ties BILL, SET and SETV per posting key and names the keys that do not tie", async () => {
    const key = (post_module: string, post_key: string, glid: string, net_amount: number, txn_date = "2026-07-10") =>
      ({ org_id: ORG, txn_date, post_module, post_key, glid, line_count: 1, net_amount });
    const bill = (id: string, post_key: string, total_charges: number, bill_type = "I", excise_tax = 0) =>
      ({ org_id: ORG, id, external_id: id, post_key, post_module: "BILL", delivery_date: "2026-07-10", total_charges, other_charge: 0, excise_tax, bill_type });
    const rec = createSupabaseRecorder({
      tables: {
        mcleod_gl_totals: [],
        mcleod_settlements: settlementsTable([
          { posted_pay: 1000, is_void: false, accrual_key: "K1", accrued_at: "2026-07-03T00:00:00Z" },
          { posted_pay: 500, is_void: true, accrual_key: "K2", accrued_at: "2026-07-04T00:00:00Z", void_date: "2026-07-05T00:00:00Z" },
          { posted_pay: 600, is_void: true, accrual_key: "K3", accrued_at: "2026-06-20T00:00:00Z", post_key: "P3", transferred_at: "2026-06-25T00:00:00Z", void_date: "2026-07-15T00:00:00Z" },
          // A voided original and its re-issue on one key: SET books the re-issue only.
          { posted_pay: 700, is_void: true, accrual_key: "K5", accrued_at: "2026-07-07T00:00:00Z", void_date: "2026-07-07T00:00:00Z" },
          { posted_pay: 650, is_void: false, accrual_key: "K5", accrued_at: "2026-07-07T00:00:00Z" },
        ]),
        // B1 carries excise: the receivable is the bill plus its excise.
        mcleod_billing: postgrestFixture([bill("b1", "B1", 4864.64, "I", 35), bill("b2", "B2", 213.5, "C"), bill("b3", "B3", 1000)]),
        mcleod_gl_key_lines: postgrestFixture([
          key("BILL", "B1", "12000000", 4899.64),
          key("BILL", "B1", "30000001", -4864.64),
          key("BILL", "B2", "12000000", -213.5),
          key("BILL", "B3", "12000000", 900),
          key("BILL", "B4", "12000000", 50),
          key("SET", "K1", "20500010", -1000),
          key("SET", "K1", "40000001", 1000),
          key("SET", "K2", "20500020", -500),
          key("SET", "K5", "20500010", -650),
          key("SETV", "P3", "20500010", 600),
          // August: outside the window, so a reader that dropped its bounds would mis-tie B1.
          key("BILL", "B1", "12000000", 1, "2026-08-02"),
        ]),
      },
    });
    const report = await getLedgerCoverage(rec.client, ORG, "2026-07-01", "2026-08-01");
    const tie = (m: string) => report.keyTies.find((t) => t.post_module === m)!;
    expect(tie("BILL")).toMatchObject({ keys: 4, matched: 2, tied: false, mismatched: { count: 1, difference: 100 }, ledgerOnly: { count: 1, amount: 50 } });
    expect(tie("BILL").exceptions.map((e) => e.post_key)).toEqual(["B3", "B4"]);
    expect(tie("SET")).toMatchObject({ keys: 3, matched: 3, tied: true });
    expect(tie("SETV")).toMatchObject({ keys: 1, matched: 1, tied: true });
    expectOrgScoped(rec, ORG);
  });

  it("has no key ties for a month not yet swept at that grain, rather than ties that all fail", async () => {
    const rec = createSupabaseRecorder({ tables: { mcleod_gl_totals: [], mcleod_settlements: [], mcleod_billing: [], mcleod_gl_key_lines: [] } });
    expect((await getLedgerCoverage(rec.client, ORG, "2026-07-01", "2026-08-01")).keyTies).toEqual([]);
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
