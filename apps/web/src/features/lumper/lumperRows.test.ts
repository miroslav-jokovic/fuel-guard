import { describe, expect, it } from "vitest";
import type { LumperCaseRow } from "@silvicom/shared";
import { lumperAmount, lumperDaysOpen, lumperPlace, matchesLumperSearch, mcleodDay, sweepFreshness } from "./lumperRows";
import { lumperFileMimeOf, lumperFileRefusal } from "./useLumperCases";

const row = (o: Partial<LumperCaseRow> = {}): LumperCaseRow => ({
  id: "c1", companyId: "TMS", orderId: "0291013", chargeCode: "LUM", state: "waiting_for_rc", open: true, openedAt: "2026-10-02T12:00:00Z",
  customerName: "A Broker", dispatcherUserId: "kane", dispatcherName: "Kane", consigneeName: "A Warehouse", consigneeCity: "Joliet", consigneeState: "IL",
  deliveredAt: "2026-10-01T00:00:00Z", driverCode: "DRV1", paidAmount: 310, paidAt: "2026-10-02T00:00:00Z", references: ["EFS-77"], chargeAmount: 310,
  chargeDescriptions: ["Unloading"], billedAmount: 0, shortAmount: 0, invoiced: false, lastInvoiceNo: null, lastInvoiceAt: null, rcOnFile: false, files: [],
  closedAt: null, closedByName: null, closeReason: null, closeNote: null, ...o,
});

describe("how a lumper case is shown", () => {
  it("shows a McLeod date as the calendar day it is, whatever the clock", () => {
    expect(mcleodDay("2026-10-02T00:00:00Z")).toBe("10/02/2026");
    expect(mcleodDay(null)).toBe("—");
  });

  it("says where: the delivery stop and its town", () => {
    expect(lumperPlace(row())).toBe("A Warehouse · Joliet, IL");
    expect(lumperPlace(row({ consigneeName: null }))).toBe("Joliet, IL");
    expect(lumperPlace(row({ consigneeName: null, consigneeCity: null, consigneeState: null }))).toBe("—");
  });

  it("shows what was paid, and labels a keyed charge that payroll has not paid yet", () => {
    expect(lumperAmount(row())).toEqual({ text: "$310.00", note: null });
    expect(lumperAmount(row({ paidAmount: 0, chargeAmount: 150 }))).toEqual({ text: "$150.00", note: "keyed, not paid in payroll yet" });
    expect(lumperAmount(row({ paidAmount: 0, chargeAmount: 0 }))).toEqual({ text: "—", note: null });
  });

  it("counts whole days from the payment, or from the case opening when payroll has no date", () => {
    const now = new Date("2026-10-09T18:00:00Z");
    expect(lumperDaysOpen(row(), now)).toBe(7);
    expect(lumperDaysOpen(row({ paidAt: null }), now)).toBe(7);
    expect(lumperDaysOpen(row({ paidAt: "2026-10-10T00:00:00Z" }), now)).toBe(0);
  });

  it("finds a case by order, broker, dispatcher, place or EFS reference", () => {
    for (const q of ["291013", "a broker", "KANE", "joliet", "efs-77", ""]) expect(matchesLumperSearch(row(), q), q).toBe(true);
    expect(matchesLumperSearch(row(), "nobody")).toBe(false);
  });

  it("says when McLeod was last read, and warns once that is over a day or never", () => {
    const now = new Date("2026-10-09T18:00:00Z");
    expect(sweepFreshness("2026-10-09T17:30:00Z", now)).toEqual({ text: "Read from McLeod within the last hour.", late: false });
    expect(sweepFreshness("2026-10-09T13:00:00Z", now)).toEqual({ text: "Read from McLeod 5 hours ago.", late: false });
    expect(sweepFreshness("2026-10-07T13:00:00Z", now)).toMatchObject({ late: true });
    expect(sweepFreshness("2026-10-07T13:00:00Z", now).text).toContain("2 days ago");
    expect(sweepFreshness(null, now).late).toBe(true);
  });
});

describe("what a revised RC may be filed as", () => {
  it("takes a PDF, a JPEG and a PNG by name", () => {
    expect(lumperFileMimeOf("Revised RC.PDF")).toBe("application/pdf");
    expect(lumperFileMimeOf("photo.jpeg")).toBe("image/jpeg");
    expect(lumperFileMimeOf("scan.png")).toBe("image/png");
    expect(lumperFileMimeOf("mail.msg")).toBeNull();
  });

  it("refuses an email file, an empty file and one over 25 MB, in words", () => {
    expect(lumperFileRefusal({ name: "mail.eml", size: 10 })).toContain("Save the broker's email as a PDF");
    expect(lumperFileRefusal({ name: "rc.pdf", size: 0 })).toBe("rc.pdf is empty.");
    expect(lumperFileRefusal({ name: "rc.pdf", size: 26 * 1024 * 1024 })).toContain("25 MB");
    expect(lumperFileRefusal({ name: "rc.pdf", size: 1200 })).toBeNull();
  });
});
