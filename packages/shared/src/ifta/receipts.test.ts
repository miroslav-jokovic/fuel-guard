import { describe, expect, it } from "vitest";
import { dropCardDuplicateReceipts, summarizePeriodReceipts, type IftaReceiptRaw } from "./receipts.js";

/**
 * The rule that keeps a hand-keyed McLeod receipt from crediting a fill the card already carries
 * (IP6; 2 of 2026's 116 receipts are such a fill, keyed again): same truck, same state, same day,
 * gallons within half a gallon — and one card fill answers for one receipt at most.
 */
const receipt = (externalId: string, over: Partial<IftaReceiptRaw> = {}): IftaReceiptRaw => ({
  externalId, vehicleId: "v512", mcleodUnit: "512", jurisdiction: "TX", receiptDate: "2026-08-02", gallons: 80, ...over,
});
const card = (id: string, over: Partial<{ vehicleId: string | null; state: string | null; businessDate: string | null; gallons: number }> = {}) => ({
  id, vehicleId: "v512", state: "TX", businessDate: "2026-08-02", gallons: 80, ...over,
});
const ids = (rs: IftaReceiptRaw[]) => rs.map((r) => r.externalId);

describe("dropCardDuplicateReceipts", () => {
  it("drops a receipt the card already carries — same truck, state, day, gallons within 0.5", () => {
    const s = dropCardDuplicateReceipts([receipt("r1", { gallons: 80.5 })], [card("f1")]);
    expect(ids(s.duplicates)).toEqual(["r1"]);
    expect(s.kept).toEqual([]);
  });

  it("keeps a receipt more than half a gallon away", () => {
    expect(ids(dropCardDuplicateReceipts([receipt("r1", { gallons: 80.6 })], [card("f1")]).kept)).toEqual(["r1"]);
  });

  it("keeps a receipt that differs from the card fill in truck, state or day", () => {
    const fills = [card("f1", { vehicleId: "v101" }), card("f2", { state: "OK" }), card("f3", { businessDate: "2026-08-03" })];
    expect(ids(dropCardDuplicateReceipts([receipt("r1")], fills).kept)).toEqual(["r1"]);
  });

  it("compares the state without regard to case or padding", () => {
    expect(ids(dropCardDuplicateReceipts([receipt("r1")], [card("f1", { state: " tx " })]).duplicates)).toEqual(["r1"]);
    expect(ids(dropCardDuplicateReceipts([receipt("r1", { jurisdiction: "tx" })], [card("f1")]).duplicates)).toEqual(["r1"]);
  });

  it("lets one card fill answer for one receipt only — two receipts that day are two fills", () => {
    const s = dropCardDuplicateReceipts([receipt("r1"), receipt("r2")], [card("f1")]);
    expect(ids(s.duplicates)).toEqual(["r1"]);
    expect(ids(s.kept)).toEqual(["r2"]);
  });

  it("matches each receipt to its closest card fill, whatever order either list arrives in", () => {
    const receipts = [receipt("r2", { gallons: 80.4 }), receipt("r1", { gallons: 80 })];
    const fills = [card("f2", { gallons: 80.4 }), card("f1", { gallons: 80.0 })];
    const a = dropCardDuplicateReceipts(receipts, fills);
    const b = dropCardDuplicateReceipts([...receipts].reverse(), [...fills].reverse());
    expect(ids(a.duplicates).sort()).toEqual(["r1", "r2"]);
    expect(ids(b.duplicates).sort()).toEqual(["r1", "r2"]);
  });

  it("takes the closest card fill, so a near-miss does not steal another receipt's match", () => {
    // r1 is 0.2 from fB and 0.4 from fA; r2 is 0.2 from fA and 0.8 from fB. Taking the closest pairs
    // both; taking any in-tolerance fill would pair r1 with fA and leave r2 credited twice.
    const s = dropCardDuplicateReceipts(
      [receipt("r1", { gallons: 80.4 }), receipt("r2", { gallons: 79.8 })],
      [card("fA", { gallons: 80.0 }), card("fB", { gallons: 80.6 })],
    );
    expect(ids(s.duplicates)).toEqual(["r1", "r2"]);
  });

  it("keeps a receipt whose McLeod unit matched no truck — there is no 'same truck' to compare", () => {
    expect(ids(dropCardDuplicateReceipts([receipt("r1", { vehicleId: null })], [card("f1", { vehicleId: null })]).kept)).toEqual(["r1"]);
  });
});

describe("summarizePeriodReceipts", () => {
  it("sums kept receipts per state and names the McLeod units that matched no truck", () => {
    const s = summarizePeriodReceipts({
      kept: [
        receipt("r1", { gallons: 100 }),
        receipt("r2", { jurisdiction: "OK", gallons: 50 }),
        receipt("r3", { vehicleId: null, mcleodUnit: "999", gallons: 40 }),
        receipt("r4", { vehicleId: null, mcleodUnit: "77", gallons: 10 }),
      ],
      duplicates: [receipt("r5", { gallons: 80.3 })],
    });
    expect(s.jurisdictions).toEqual([
      { jurisdiction: "OK", gallons: 50, receipts: 1 },
      { jurisdiction: "TX", gallons: 150, receipts: 3 },
    ]);
    expect(s).toMatchObject({ duplicatesDropped: 1, duplicateGallons: 80.3, unmatched: 2, unmatchedUnits: ["77", "999"] });
  });
});
