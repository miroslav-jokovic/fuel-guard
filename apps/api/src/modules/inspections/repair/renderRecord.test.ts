import { describe, expect, it } from "vitest";
import { pdfPageTexts } from "../../../testing/pdfText.js";
import { renderRepairRecord, type RepairRecordInput, type RepairRecordUnit } from "./renderRecord.js";

/**
 * The rendered repair record (IC11 B2, Q-IC12 (a)). Text assertions cannot see layout, so the one layout
 * promise is asserted per PAGE: the certification's heading and its signature are on the same sheet, however
 * many units push it towards a page's foot. Checked by eye at 80 dpi on 2026-10-16 (short and long fixtures).
 */

const unit = (n: number): RepairRecordUnit => ({
  name: `Trailer ${n}`, violations: [{ code: "393.75A3", description: "Tire-flat and/or audible air leak" }], settlement: "outside",
  decidedBy: "Sam Shop", decidedAt: "2026-10-09T15:00:00Z", note: "TA Joliet, invoice 8812", workOrderRef: null, workOrder: null, bills: [],
});
const input = (units: RepairRecordUnit[]): RepairRecordInput => ({
  carrier: { name: "Silvi Transport Inc.", dotNumber: "1864495" },
  inspection: { reportNumber: "IL1234567890", reportState: "IL", inspectionDate: "2026-10-06", level: 2, location: "I-80 Minooka" },
  units, fleetpalAsOf: null,
  certification: { id: "c-1", signerName: "Dana Reyes", signerTitle: "Safety Director", signedOn: "2026-10-16", certifiedAt: "2026-10-16T17:30:00Z" },
  timeZone: "America/Chicago",
});

describe("renderRepairRecord", () => {
  it("says what it is rendered from, and when FleetPal's time is unknown says so", async () => {
    const text = (await pdfPageTexts(await renderRepairRecord(input([unit(1)])))).join("");
    expect(text).toContain("from FleetPal's maintenance record as of an unknown time");
    expect(text).toContain("Repaired outside FleetPal");
  });

  it("⚠ never leaves the certification's heading on one page and its signature on the next", async () => {
    // Walk the block down a page in single violation lines (~12pt): a whole unit (~90pt) steps right over the
    // ~40pt window where the heading fits and the signature does not.
    for (let n = 0; n <= 40; n++) {
      const last = { ...unit(2), violations: Array.from({ length: n + 1 }, (_, i) => ({ code: `393.${i}`, description: "Inoperable required lamp" })) };
      const pages = await pdfPageTexts(await renderRepairRecord(input([unit(1), last])));
      const heading = pages.findIndex((p) => p.replace("Certification c-1", "").includes("Certification"));
      const signed = pages.findIndex((p) => p.includes("Signature of carrier official"));
      expect([n, heading]).toEqual([n, signed]);
    }
  });

  it("names each vendor bill filed with it by its fingerprint, and says which one it could not keep (F16c)", async () => {
    const wo = {
      fleetpalId: "fpwo1", reference: "WO-5436", status: "CLOSED", openedAt: null, completedAt: null, description: null, jobs: [],
      invoices: [{ invoiceId: "inv1", purchaseOrder: "PO-1", invoiceNumber: "8812", invoiceDate: null, invoiceType: "STANDARD", amount: 120.5 }],
    };
    const accepted: RepairRecordUnit = {
      ...unit(1), settlement: "accepted", note: null, workOrderRef: "WO-5436", workOrder: wo,
      bills: [
        { invoiceId: "inv1", filename: "WO_Priced_4011391635.PDF", documentId: "d-1", sha256: "ab".repeat(32) },
        { invoiceId: "inv1", filename: "scan.tif", documentId: null, sha256: null },
      ],
    };
    const text = (await pdfPageTexts(await renderRepairRecord(input([accepted])))).join(" ");
    expect(text).toContain("Vendor bills filed with this record");
    expect(text).toContain("Invoice 8812 — WO_Priced_4011391635.PDF");
    expect(text).toContain(`SHA-256 ${"ab".repeat(32)}`);
    expect(text).toContain("Not kept");
    const none = (await pdfPageTexts(await renderRepairRecord(input([{ ...accepted, bills: [] }])))).join(" ");
    expect(none).toContain("No scanned vendor bill is attached to these invoices in FleetPal.");
  });
});
