import { describe, expect, it } from "vitest";
import { VEHICLE_CHECK_LABELS } from "@silvicom/shared";
import { PAPERS, PAPER_STATES, paperCheck, paperStateLabel } from "./truckPapersGrid";

describe("the Truck paperwork grid", () => {
  it("names each row from the shared check label, the same for both papers", () => {
    for (const state of PAPER_STATES) {
      const [inspection, registration] = PAPERS.map((paper) => paperStateLabel(paper, state));
      // One row serves both columns, so both papers must leave the same words behind.
      expect(registration).toBe(inspection);
      expect(inspection).not.toBe("");
      // …and those words are the shared label's own, less the paper's name.
      expect(VEHICLE_CHECK_LABELS[paperCheck(PAPERS[0], state)].toLowerCase()).toContain(inspection!.toLowerCase());
    }
  });

  it("covers every paperwork check the shared catalogue has, and no other", () => {
    const inGrid = PAPER_STATES.flatMap((state) => PAPERS.map((paper) => paperCheck(paper, state))).sort();
    const inCatalogue = Object.keys(VEHICLE_CHECK_LABELS).filter((k) => /^(inspection|registration)_/.test(k)).sort();
    expect(inGrid).toEqual(inCatalogue);
  });
});
