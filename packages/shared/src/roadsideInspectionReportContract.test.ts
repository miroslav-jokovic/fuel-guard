import { describe, expect, it } from "vitest";
import { DOCUMENT_PROFILES, PAGE_CLASSES } from "./documentReadingContract.js";
import {
  emptyRoadsideInspectionReport,
  roadsideInspectionReportSchema,
  roadsideReportFieldCriticality,
} from "./roadsideInspectionReportContract.js";

describe("roadside inspection report profile (D-IC13)", () => {
  it("parses {} to the empty document — every field null, every list empty", () => {
    expect(emptyRoadsideInspectionReport()).toEqual({
      reportNumber: null, reportState: null, inspectionDate: null, startTime: null, endTime: null, level: null,
      location: null, carrierUsdot: null,
      driver: { name: null, licenseNumber: null, licenseState: null },
      units: [], violations: [],
    });
  });

  it("⚠ transcribes no date of birth — what the comparison does not need is not read", () => {
    const keys = JSON.stringify(Object.keys(roadsideInspectionReportSchema.shape.driver.unwrap().shape));
    expect(keys).not.toMatch(/birth|dob/i);
  });

  it("holds the fields that confirm a driver to the engine's bar, and the rest to the standard one", () => {
    for (const p of ["reportNumber", "reportState", "driver.licenseNumber", "driver.licenseState", "units[3].vin"]) {
      expect(roadsideReportFieldCriticality(p)).toBe("engine");
    }
    for (const p of ["driver.name", "units[0].plate", "violations[0].code", "location"]) {
      expect(roadsideReportFieldCriticality(p)).toBe("standard");
    }
  });

  it("⚠ reads every page class — the classifier's vocabulary is the BOL's and can only call a report page `other`", () => {
    expect([...DOCUMENT_PROFILES.roadside_inspection_report.readsPageClasses]).toEqual([...PAGE_CLASSES]);
  });
});
