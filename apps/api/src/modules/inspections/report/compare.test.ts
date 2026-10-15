import { describe, expect, it } from "vitest";
import { roadsideInspectionReportSchema, type FieldEvidence } from "@silvicom/shared";
import { compareReport, sameName, type CompareInput, type RosterLicence } from "./compare.js";

/**
 * The comparison that may confirm a driver with no person in between (Q-IC11 (a), owner 2026-10-15). Each
 * check that guards it is pinned by a case that would otherwise confirm the wrong driver.
 */

const ANN: RosterLicence = { id: "d-ann", fullName: "Ann Marie Roster", cdlNumber: "P12345678901", cdlState: "IL", samsaraDriverId: "s-ann" };
const BOB: RosterLicence = { id: "d-bob", fullName: "Bob Other", cdlNumber: "Q99999999999", cdlState: "IL", samsaraDriverId: "s-bob" };

const licenceEvidence = (a: string | null, b: string | null, ocr?: string[]): FieldEvidence => ({
  path: "driver.licenseNumber",
  value: a,
  status: "check",
  ruleVersion: "r",
  sources: [
    { reader: "passA", page: null, bbox: null, value: a },
    { reader: "passB", page: null, bbox: null, value: b },
    ...(ocr ? [{ reader: "ocr" as const, page: null, bbox: null, value: ocr }] : []),
  ],
});

const input = (o: Partial<CompareInput> & { licence?: [string | null, string | null, string[]?] } = {}): CompareInput => {
  const [a, b, ocr] = o.licence ?? ["P123-4567-8901", "P1234567 8901", ["passA", "passB"]];
  return {
    report: roadsideInspectionReportSchema.parse({
      reportNumber: "WY PNCK000234",
      driver: { name: "ROSTER, ANN M", licenseNumber: a, licenseState: "IL" },
      units: [{ unitNumber: "1", vin: "3AKJHHDR5NSNA1234" }],
    }),
    evidence: [licenceEvidence(a, b, ocr)],
    inspection: { reportNumber: "PNCK000234", reportState: "WY" },
    unitVins: ["3AKJHHDR5NSNA1234", "1JJV532D8KL123456"],
    roster: [ANN, BOB],
    samsaraDriverId: "s-ann",
    ...o,
  };
};

describe("compareReport", () => {
  it("agrees when the paper is this inspection, the licence is one roster driver's, and Samsara put them on the truck", () => {
    expect(compareReport(input())).toEqual({ agrees: true, reasons: [], driverId: "d-ann", nameOnReport: "ROSTER, ANN M", licenceLast4: "8901" });
  });

  it("⚠ never agrees when Samsara put a different driver on the truck", () => {
    const r = compareReport(input({ samsaraDriverId: "s-bob" }));
    expect(r.agrees).toBe(false);
    expect(r.reasons).toContain("samsara_other_driver");
  });

  it("⚠ never agrees when the two readers read different licences", () => {
    const r = compareReport(input({ licence: ["P123-4567-8901", "P123-4567-8907", ["passA"]] }));
    expect(r.agrees).toBe(false);
    expect(r.reasons).toContain("licence_readers_disagree");
  });

  it("⚠ never agrees when the page's own text does not print the licence both readers read", () => {
    const r = compareReport(input({ licence: ["P123-4567-8901", "P123-4567-8901", []] }));
    expect(r.reasons).toEqual(["licence_not_printed"]);
    expect(r.agrees).toBe(false);
  });

  it("⚠ never agrees on a paper whose report number is another inspection's", () => {
    const r = compareReport(input({ inspection: { reportNumber: "PNCK000999", reportState: "WY" } }));
    expect(r.reasons).toContain("report_number_mismatch");
    expect(r.agrees).toBe(false);
  });

  it("⚠ never agrees when a VIN on the paper is not one of the inspected units", () => {
    const r = compareReport({ ...input(), unitVins: ["1XKYDP9X0LJ999999"] });
    expect(r.reasons).toContain("vin_mismatch");
  });

  it("does not read FMCSA's not-yet-published units as a mismatch", () => {
    expect(compareReport({ ...input(), unitVins: [] }).agrees).toBe(true);
  });

  it("⚠ never agrees when two roster drivers hold the licence", () => {
    const twin = { ...BOB, cdlNumber: ANN.cdlNumber, samsaraDriverId: "s-ann" };
    const r = compareReport(input({ roster: [ANN, twin] }));
    expect(r.reasons).toContain("licence_several_drivers");
    expect(r.driverId).toBeNull();
  });

  it("does not confirm against a roster driver whose licence is from another state", () => {
    const r = compareReport(input({ roster: [{ ...ANN, cdlState: "IN" }] }));
    expect(r.reasons).toContain("licence_not_on_roster");
  });

  it("says when the roster's driver has no Samsara account to agree with", () => {
    const r = compareReport(input({ roster: [{ ...ANN, samsaraDriverId: null }] }));
    expect(r.reasons).toContain("driver_not_in_samsara");
    expect(r.agrees).toBe(false);
  });

  it("⚠ a differing name is shown but does not refuse — a name never confirms, and never vetoes a licence", () => {
    const report = roadsideInspectionReportSchema.parse({ ...input().report, driver: { name: "JOHN SMITH", licenseNumber: "P123-4567-8901", licenseState: "IL" } });
    const r = compareReport({ ...input(), report });
    expect(r.reasons).toEqual(["name_differs"]);
    expect(r.agrees).toBe(true);
  });
});

describe("sameName", () => {
  it("ignores order, commas, initials and accents", () => {
    expect(sameName("ROSTER, ANN M", "Ann Marie Roster")).toBe(true);
    expect(sameName("PETROVIĆ MARKO", "Marko Petrovic")).toBe(true);
  });
  it("tells two people apart", () => {
    expect(sameName("ANN ROSTER", "Ann Rooster")).toBe(false);
  });
});
