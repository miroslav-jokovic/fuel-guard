import { describe, it, expect } from "vitest";
import { ROAD_TEST_ITEMS, ROAD_TEST_ITEM_KEYS, type RoadTestRecord } from "@silvicom/shared";
import { pdfPageTexts, pdfText } from "../../../testing/pdfText.js";
import { roadTestCertificatePdf, roadTestFormPdf, type RoadTestDocumentInput } from "./roadTest.js";

/**
 * The carrier's road-test paper, filled in (RT2). Rasterised and looked at on 2026-09-25 with a long
 * Serbian-Polish name; these pin what text reaches the page and on which document.
 */
const record = (over: Partial<RoadTestRecord> = {}): RoadTestRecord => ({
  examiner_id: "e", vehicle_id: "v", trailer_type: "reefer", tested_on: "2026-09-20", miles: 15,
  items: Object.fromEntries(ROAD_TEST_ITEM_KEYS.map((k) => [k, "satisfactory"])) as RoadTestRecord["items"],
  general_performance: "satisfactory", remarks: "Clean run.", qualified_for: "Tractor-trailer", ...over,
});
const input = (over: Partial<RoadTestDocumentInput> = {}): RoadTestDocumentInput => ({
  carrier: { name: "Silvicom Inc", address: "1301 Armitage Ave, Melrose Park, IL 60160" },
  driver: {
    fullName: "Marko Petrović", phone: "(773) 555-0142", licenceNumber: "P123-4567", licenceState: "IL",
    address: { line1: "4521 W Fullerton Ave", city: "Chicago", state: "IL", zip: "60639" },
  },
  powerUnit: "2024 FRHT #1432",
  record: record(),
  examiner: { fullName: "Arvidera Gakhal", title: "Maintenance manager", signature: null },
  recordedBy: "Rita Recruiter",
  ...over,
});

describe("the form (examination + evaluation)", () => {
  it("prints all nine items, the driver as typed, and the equipment from the roster", async () => {
    const text = await pdfText(await roadTestFormPdf(input()));
    for (const item of ROAD_TEST_ITEMS) expect(text, item.key).toContain(item.text);
    expect(text).toContain("Marko Petrović");
    expect(text).toContain("2024 FRHT #1432 with reefer trailer");
    // The carrier's pre-printed values are fields now — none of them survives onto the page.
    expect(text).not.toContain("2021");
  });

  it("puts the evaluation on its own sheet under the carrier's letterhead", async () => {
    const pages = await pdfPageTexts(await roadTestFormPdf(input()));
    expect(pages).toHaveLength(2);
    expect(pages[1]).toContain("EVALUATION OF ROAD TEST");
    expect(pages[1]).toContain("1301 Armitage Ave");
  });

  it("says who applied the examiner's signature (Q-RT2)", async () => {
    expect(await pdfText(await roadTestFormPdf(input()))).toContain("applied from the carrier's file by Rita Recruiter");
  });
});

describe("the certificate", () => {
  it("carries every §391.31(f) field: name, power unit, trailer, date, miles, examiner, title, organization, address", async () => {
    const text = await pdfText(await roadTestCertificatePdf(input()));
    for (const s of ["CERTIFICATE OF ROAD TEST", "Marko Petrović", "P123-4567", "2024 FRHT #1432", "REEFER",
      "09/20/2026", "approximately 15 miles", "Arvidera Gakhal", "Maintenance manager", "SILVICOM INC",
      "1301 Armitage Ave, Melrose Park, IL 60160", "It is my considered opinion"]) {
      expect(text, s).toContain(s);
    }
  });

  it("does not print the ratings — the driver's copy is the certificate alone (§391.31(g))", async () => {
    const text = await pdfText(await roadTestCertificatePdf(input({ record: record({ remarks: "Rode the curb twice." }) })));
    expect(text).not.toContain("Rode the curb");
    expect(text).not.toContain("Needs Training");
  });
});
