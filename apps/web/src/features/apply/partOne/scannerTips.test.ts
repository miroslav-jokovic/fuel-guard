import { afterEach, describe, expect, it } from "vitest";
import { markScannerTipsSeen, resetScannerTips, scannerTipsSeen } from "./scannerTips";

/** The scanner's tips, once a visit for EACH kind (2026-09-30): the selfie's are not the licence's. */
describe("the scanner tips seen this visit", () => {
  afterEach(resetScannerTips);

  it("start unseen for both kinds", () => {
    expect({ ...scannerTipsSeen }).toEqual({ document: false, face: false });
  });

  it("pressing past a document's leaves a face's still to be shown, and the other way round", () => {
    markScannerTipsSeen("document");
    expect({ ...scannerTipsSeen }).toEqual({ document: true, face: false });
    resetScannerTips();
    markScannerTipsSeen("face");
    expect({ ...scannerTipsSeen }).toEqual({ document: false, face: true });
  });
});
