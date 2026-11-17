import { describe, expect, it } from "vitest";
import { lumperOrderlessMatches, lumperPossibleMisposts, type LumperMispostSide, type LumperSettlementLine } from "./lumperMatch.js";

/**
 * The two hints, on the shapes the first production read held (2026-11-17, 94 cases). Order numbers,
 * amounts, dates and dispatcher logins are the real ones; nothing else about the loads is here.
 */
const side = (orderId: string, o: Partial<LumperMispostSide>): LumperMispostSide => ({
  key: orderId, companyId: "TMS", orderId, dispatcherUserId: "aneta", paidAmount: 0, paidAt: null, chargeAmount: 0, billedAmount: 0, deliveredAt: null, ...o,
});

// 0135863: payroll paid $703.64 on 10/01, four days before this order delivered; invoiced with no lumper.
const PAID_HERE = side("0135863", { paidAmount: 703.64, paidAt: "2026-10-01T00:00:00Z", deliveredAt: "2026-10-05T07:00:00Z" });
// 0135778: same dispatcher, $403.64 + $300 charged and invoiced, nothing paid; delivered 09/29.
const CHARGED_HERE = side("0135778", { chargeAmount: 703.64, billedAmount: 703.64, deliveredAt: "2026-09-29T19:00:00Z" });

describe("lumperPossibleMisposts (D-LRC13)", () => {
  it("pairs the payment on one order with the same dispatcher's charge on another, both ways", () => {
    const out = lumperPossibleMisposts([PAID_HERE, CHARGED_HERE, side("0137609", { paidAmount: 386.62, paidAt: "2026-11-03T00:00:00Z", chargeAmount: 286.62, billedAmount: 286.62 })]);
    expect(out.get("0135863")).toEqual([{ orderId: "0135778", amount: 703.64, direction: "paid_here" }]);
    expect(out.get("0135778")).toEqual([{ orderId: "0135863", amount: 703.64, direction: "charged_here" }]);
    // Billed short is not a misplaced payment: it carries both a payment and a charge.
    expect(out.has("0137609")).toBe(false);
  });

  it("takes the charged side's amount from its invoice when billing re-keyed the charge away", () => {
    const out = lumperPossibleMisposts([PAID_HERE, { ...CHARGED_HERE, chargeAmount: 0 }]);
    expect(out.get("0135863")?.[0]?.orderId).toBe("0135778");
  });

  it("says nothing across dispatchers, companies, a cent of difference, or more than two weeks", () => {
    expect(lumperPossibleMisposts([PAID_HERE, { ...CHARGED_HERE, dispatcherUserId: "chris" }]).size).toBe(0);
    expect(lumperPossibleMisposts([PAID_HERE, { ...CHARGED_HERE, companyId: "OTHER" }]).size).toBe(0);
    expect(lumperPossibleMisposts([PAID_HERE, { ...CHARGED_HERE, chargeAmount: 703.63, billedAmount: 703.63 }]).size).toBe(0);
    expect(lumperPossibleMisposts([PAID_HERE, { ...CHARGED_HERE, deliveredAt: "2026-09-16T00:00:00Z" }]).size).toBe(0);
    expect(lumperPossibleMisposts([PAID_HERE, { ...CHARGED_HERE, deliveredAt: "2026-09-17T00:00:00Z" }]).size).toBe(2);
  });

  it("says nothing without a dispatcher on both sides", () => {
    expect(lumperPossibleMisposts([{ ...PAID_HERE, dispatcherUserId: null }, { ...CHARGED_HERE, dispatcherUserId: null }]).size).toBe(0);
  });

  it("names no order when two could be the answer, from either side", () => {
    const twin = { ...CHARGED_HERE, key: "0135779", orderId: "0135779" };
    expect(lumperPossibleMisposts([PAID_HERE, CHARGED_HERE, twin]).size).toBe(0);
    const otherPaid = { ...PAID_HERE, key: "0135864", orderId: "0135864" };
    expect(lumperPossibleMisposts([PAID_HERE, otherPaid, CHARGED_HERE]).size).toBe(0);
  });

  it("leaves a payment with its own charge, or a charge with its own payment, alone", () => {
    expect(lumperPossibleMisposts([{ ...PAID_HERE, chargeAmount: 703.64 }, CHARGED_HERE]).size).toBe(0);
    expect(lumperPossibleMisposts([PAID_HERE, { ...CHARGED_HERE, paidAmount: 703.64, paidAt: "2026-09-30T00:00:00Z" }]).size).toBe(0);
  });
});

const line = (id: string, o: Partial<LumperSettlementLine>): LumperSettlementLine => ({
  id, companyId: "TMS", orderId: null, deductCode: "LUM", amount: 0, transactedAt: null, payeeId: null, isVoid: false, ...o,
});
// CRTUCKER: the money code on 0134538 on 09/04, the $410 reimbursement keyed 09/09 with no order.
const MONEY_CODE = line("U1", { orderId: "0134538", deductCode: "UNL", amount: 410, transactedAt: "2026-09-04T00:00:00Z", payeeId: "CRTUCKER" });
const ORDERLESS = line("L1", { amount: 410, transactedAt: "2026-09-09T00:00:00Z", payeeId: "CRTUCKER" });

describe("lumperOrderlessMatches (D-LRC14)", () => {
  it("names the order whose money code an order-less reimbursement is the other half of", () => {
    // DRUTHERF's $100 on 09/22 has no other half anywhere: it stays unknown.
    const lost = line("L2", { amount: 100, transactedAt: "2026-09-22T00:00:00Z", payeeId: "DRUTHERF" });
    expect(lumperOrderlessMatches([MONEY_CODE, ORDERLESS, lost])).toEqual(new Map([["L1", "0134538"]]));
  });

  it("works the other way: an order-less money code beside its order's reimbursement", () => {
    const reimb = line("R1", { orderId: "0134538", amount: 410, transactedAt: "2026-09-09T00:00:00Z", payeeId: "CRTUCKER" });
    const code = line("U2", { deductCode: "UNL", amount: 410, transactedAt: "2026-09-04T00:00:00Z", payeeId: "CRTUCKER" });
    expect(lumperOrderlessMatches([reimb, code]).get("U2")).toBe("0134538");
  });

  it("does not match another payee, another amount, more than a week apart, or a void line", () => {
    expect(lumperOrderlessMatches([MONEY_CODE, { ...ORDERLESS, payeeId: "TLAMAR" }]).size).toBe(0);
    expect(lumperOrderlessMatches([MONEY_CODE, { ...ORDERLESS, amount: 410.01 }]).size).toBe(0);
    expect(lumperOrderlessMatches([MONEY_CODE, { ...ORDERLESS, transactedAt: "2026-09-12T00:00:00Z" }]).size).toBe(0);
    expect(lumperOrderlessMatches([MONEY_CODE, { ...ORDERLESS, transactedAt: "2026-09-11T00:00:00Z" }]).size).toBe(1);
    expect(lumperOrderlessMatches([{ ...MONEY_CODE, isVoid: true }, ORDERLESS]).size).toBe(0);
    expect(lumperOrderlessMatches([MONEY_CODE, { ...ORDERLESS, isVoid: true }]).size).toBe(0);
    expect(lumperOrderlessMatches([MONEY_CODE, { ...ORDERLESS, payeeId: null }]).size).toBe(0);
  });

  it("does not match an order that already holds its own reimbursement: that would be a second lumper", () => {
    const own = line("R1", { orderId: "0134538", amount: 410, transactedAt: "2026-09-05T00:00:00Z", payeeId: "CRTUCKER" });
    expect(lumperOrderlessMatches([MONEY_CODE, own, ORDERLESS]).size).toBe(0);
  });

  it("matches nothing when two orders, or two order-less lines, could be the answer", () => {
    const secondCode = line("U9", { orderId: "0134600", deductCode: "UNL", amount: 410, transactedAt: "2026-09-06T00:00:00Z", payeeId: "CRTUCKER" });
    expect(lumperOrderlessMatches([MONEY_CODE, secondCode, ORDERLESS]).size).toBe(0);
    const secondOrderless = line("L9", { amount: 410, transactedAt: "2026-09-08T00:00:00Z", payeeId: "CRTUCKER" });
    expect(lumperOrderlessMatches([MONEY_CODE, ORDERLESS, secondOrderless]).size).toBe(0);
  });
});
