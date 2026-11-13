import { describe, expect, it } from "vitest";
import { isLumperCaseOpen, lumperCaseState, type LumperCaseFacts } from "./lumperCase.js";
import { lumperSweepPayloadSchema } from "./lumperContract.js";

/**
 * The measured shapes of LUMPER-REVISED-RC-PLAN.md §1, each as one case: a charge the dispatcher keyed,
 * a lumper payroll paid that nobody keyed, an invoice that left the lumper out, a short bill, a re-bill.
 */
const moneyCode = (amount: number) => ({ deduct_code: "UNL", amount, is_void: false, transacted_at: "2026-10-02T00:00:00Z", reference_no: "EFS-1" });
const reimbursement = (amount: number) => ({ deduct_code: "LUM", amount, is_void: false, transacted_at: "2026-10-02T00:00:00Z", reference_no: null });
const invoice = (lumper: number, day = "2026-10-05") => ({ bill_type: "I", bill_date: `${day}T00:00:00Z`, invoice_no: "5512", lumper_amount: lumper });
const credit = (lumper: number) => ({ bill_type: "C", bill_date: "2026-10-08T00:00:00Z", invoice_no: "5512", lumper_amount: lumper });
const facts = (f: Partial<LumperCaseFacts>): LumperCaseFacts => ({ charges: [], payments: [], bills: [], rcOnFile: false, closed: false, ...f });

describe("the state of a lumper case", () => {
  it("waits for the revised RC from the moment the dispatcher keys the charge, before payroll pays anything", () => {
    const r = lumperCaseState(facts({ charges: [{ amount: 310 }] }));
    expect(r).toMatchObject({ state: "waiting_for_rc", open: true, paidAmount: 0, chargeAmount: 310, invoiced: false });
  });

  it("opens on payroll's lines alone when the dispatcher keyed no charge", () => {
    const r = lumperCaseState(facts({ payments: [moneyCode(250), reimbursement(250)] }));
    expect(r).toMatchObject({ state: "waiting_for_rc", paidAmount: 250, paidAt: "2026-10-02T00:00:00Z", references: ["EFS-1"] });
  });

  it("counts the money code and its reimbursement as one payment, and a voided line as none", () => {
    expect(lumperCaseState(facts({ payments: [moneyCode(250), reimbursement(250)] })).paidAmount).toBe(250);
    expect(lumperCaseState(facts({ payments: [reimbursement(180)] })).paidAmount).toBe(180);
    expect(lumperCaseState(facts({ charges: [{ amount: 1 }], payments: [{ ...moneyCode(250), is_void: true }] })).paidAmount).toBe(0);
  });

  it("says the RC is received once the file is on the case and the order is not invoiced yet", () => {
    expect(lumperCaseState(facts({ charges: [{ amount: 310 }], rcOnFile: true })).state).toBe("rc_received");
  });

  it("keeps an invoiced lumper open while no revised RC is on file", () => {
    const r = lumperCaseState(facts({ payments: [moneyCode(310)], bills: [invoice(310)] }));
    expect(r).toMatchObject({ state: "billed_no_rc", open: true, billedAmount: 310, shortAmount: 0, lastInvoiceNo: "5512" });
  });

  it("is done only when the lumper is invoiced in full and the revised RC is on file", () => {
    const r = lumperCaseState(facts({ payments: [moneyCode(310)], bills: [invoice(310)], rcOnFile: true }));
    expect(r).toMatchObject({ state: "billed_rc_on_file", open: false });
  });

  it("names an invoice that went out with no lumper on it, with or without the RC", () => {
    expect(lumperCaseState(facts({ payments: [moneyCode(310)], bills: [invoice(0)] })).state).toBe("billed_without_lumper");
    expect(lumperCaseState(facts({ payments: [moneyCode(310)], bills: [invoice(0)], rcOnFile: true })).state).toBe("billed_without_lumper");
    expect(lumperCaseState(facts({ charges: [{ amount: 310 }], bills: [invoice(0)] })).state).toBe("billed_without_lumper");
  });

  it("names a lumper billed for less than was paid, and by how much", () => {
    const r = lumperCaseState(facts({ payments: [moneyCode(310)], bills: [invoice(150)], rcOnFile: true }));
    expect(r).toMatchObject({ state: "billed_short", shortAmount: 160, open: true });
  });

  it("nets a re-bill: the credit memo takes the first invoice back and the second invoice carries the lumper", () => {
    const r = lumperCaseState(facts({ payments: [moneyCode(310)], bills: [invoice(0), credit(0), invoice(310, "2026-10-09")], rcOnFile: true }));
    expect(r).toMatchObject({ state: "billed_rc_on_file", billedAmount: 310, lastInvoiceAt: "2026-10-09T00:00:00Z" });
  });

  it("does not call an order invoiced when its only invoice was credited back", () => {
    const r = lumperCaseState(facts({ payments: [moneyCode(310)], bills: [invoice(310), credit(310)] }));
    expect(r).toMatchObject({ state: "waiting_for_rc", invoiced: false, billedAmount: 0 });
  });

  it("closes itself when the charge was deleted and nothing was paid or billed", () => {
    const r = lumperCaseState(facts({}));
    expect(r).toMatchObject({ state: "charge_removed", open: false });
  });

  it("stays closed once a person closed it, whatever McLeod says", () => {
    const r = lumperCaseState(facts({ payments: [moneyCode(310)], bills: [invoice(0)], closed: true }));
    expect(r.state).toBe("closed_not_billable");
    expect(isLumperCaseOpen(r.state)).toBe(false);
  });

  it("does not lose a cent to floating point", () => {
    const r = lumperCaseState(facts({ payments: [moneyCode(100.1), moneyCode(200.2)], bills: [invoice(300.3)], rcOnFile: true }));
    expect(r).toMatchObject({ paidAmount: 300.3, state: "billed_rc_on_file" });
  });
});

describe("the lumper sweep payload", () => {
  const order = {
    order_external_id: "0291013", company_id: "TMS", order_status: "D", ordered_at: "2026-10-01T00:00:00Z", bill_date: null,
    customer_id: "C1", customer_name: "A Broker", dispatcher_user_id: "kane", dispatcher_name: "Kane", movement_external_id: "M1",
    consignee_name: "A Warehouse", consignee_city: "Joliet", consignee_state: "IL", consignee_arrived_at: null, consignee_departed_at: null,
  };
  const charge = { external_id: "OC1", company_id: "TMS", order_external_id: "0291013", charge_code: "LUM", descr: "Unloading", amount: 310, sequence: 1 };
  const payload = (over: Record<string, unknown> = {}) => ({ company_id: "TMS", since: "2026-08-15", orders: [order], charges: [charge], payments: [], bills: [], ...over });

  it("accepts a whole sweep", () => {
    expect(lumperSweepPayloadSchema.safeParse(payload()).success).toBe(true);
  });

  it("refuses a charge whose order is not in the sweep, naming the row", () => {
    const res = lumperSweepPayloadSchema.safeParse(payload({ charges: [{ ...charge, order_external_id: "0299999" }] }));
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(["charges", 0, "order_external_id"]);
  });

  it("refuses a row of another company", () => {
    const res = lumperSweepPayloadSchema.safeParse(payload({ orders: [{ ...order, company_id: "TMS2" }] }));
    expect(res.error?.issues[0]?.path).toEqual(["orders", 0, "company_id"]);
  });

  it("refuses a zoneless McLeod time and a missing key", () => {
    expect(lumperSweepPayloadSchema.safeParse(payload({ orders: [{ ...order, ordered_at: "2026-10-01T00:00:00" }] })).success).toBe(false);
    const { descr: _descr, ...noDescr } = charge;
    expect(lumperSweepPayloadSchema.safeParse(payload({ charges: [noDescr] })).success).toBe(false);
  });
});
