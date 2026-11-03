import { describe, expect, it } from "vitest";
import { DOCUMENT_PROFILES } from "./documentReadingContract.js";
import { emptyMvrReport, mvrReportFieldCriticality, mvrReportSchema, type MvrReport } from "./mvrReportContract.js";
import { mvrReportFindings, printedDay, type MvrApplicantFacts } from "./mvrReportFindings.js";

/**
 * The checking layer over a read MVR (HIRING-WORKFLOW-AUDIT §14, OF6, Q-OF5). Each case is one rule, against a
 * record that is otherwise clean — so a finding that appears is the one rule under test.
 */
const TODAY = "2026-11-03";
const ANA: MvrApplicantFacts = { fullName: "Ana Maria Driver", cdlNumber: "D123-4567", cdlState: "IL" };
const clean = (over: Partial<MvrReport> = {}): MvrReport =>
  mvrReportSchema.parse({
    reportDate: "11/01/2026",
    driverName: "DRIVER, ANA MARIA",
    licenseNumber: "D1234567",
    licenseState: "ILLINOIS",
    licenseClass: "A",
    licenseStatus: "VALID",
    commercialStatus: "VALID",
    licenseExpires: "05/14/2029",
    medicalCertificationStatus: "CERTIFIED",
    medicalExpires: "08/01/2027",
    ...over,
  });
const codes = (r: MvrReport, who: MvrApplicantFacts = ANA) => mvrReportFindings(r, who, TODAY).map((f) => f.code);

describe("a clean record", () => {
  it("raises nothing — the same licence (punctuation aside), the state by name, the name in another order", () => {
    expect(mvrReportFindings(clean(), ANA, TODAY)).toEqual([]);
  });
});

describe("is it this applicant's record", () => {
  it("stops on another licence number", () => {
    const f = mvrReportFindings(clean({ licenseNumber: "D7654321" }), ANA, TODAY);
    expect(f.map((x) => [x.code, x.weight])).toEqual([["licence_number_differs", "stop"]]);
    expect(f[0]!.message).toContain("D7654321");
  });
  it("asks about another state and another name, without stopping", () => {
    expect(codes(clean({ licenseState: "IN" }))).toEqual(["state_differs"]);
    expect(codes(clean({ driverName: "DRIVER, ANNA" }))).toEqual(["name_differs"]);
  });
  it("stops at once on no record found, and says nothing else", () => {
    expect(codes(clean({ noRecordFound: true, licenseStatus: "SUSPENDED" }))).toEqual(["no_record"]);
  });
});

describe("the licence", () => {
  it("stops on any status that is not a valid word, licence or commercial privilege", () => {
    expect(codes(clean({ licenseStatus: "SUSPENDED" }))).toEqual(["status_not_valid"]);
    expect(codes(clean({ commercialStatus: "DISQUALIFIED" }))).toEqual(["status_not_valid"]);
    expect(codes(clean({ licenseStatus: "Active" }))).toEqual([]);
  });
  it("asks when the status could not be read — never reads silence as valid", () => {
    expect(codes(clean({ licenseStatus: null }))).toEqual(["status_unread"]);
  });
  it("stops on an expired licence, and asks about an expiry it cannot read", () => {
    expect(codes(clean({ licenseExpires: "10/31/2026" }))).toEqual(["licence_expired"]);
    expect(codes(clean({ licenseExpires: "2026-11-03" }))).toEqual([]);
    expect(codes(clean({ licenseExpires: "NOV 2029" }))).toEqual(["date_unread"]);
  });
});

describe("the medical certification the state holds", () => {
  it("stops on not certified and on an expired certificate", () => {
    expect(codes(clean({ medicalCertificationStatus: "NOT CERTIFIED" }))).toEqual(["medical_not_certified"]);
    expect(codes(clean({ medicalExpires: "01/02/2026" }))).toEqual(["medical_expired"]);
  });
  it("asks when the record shows none", () => {
    expect(codes(clean({ medicalCertificationStatus: null }))).toEqual(["medical_unread"]);
  });
});

describe("withdrawals, violations and crashes", () => {
  const w = (from: string | null, to: string | null) => ({ from, to, kind: "SUSPENSION", reason: "FTA" });
  it("stops on a withdrawal with no end or one that ends after today", () => {
    expect(codes(clean({ withdrawals: [w("01/01/2026", null)] }))).toEqual(["withdrawal_in_force"]);
    expect(codes(clean({ withdrawals: [w("01/01/2026", "12/31/2026")] }))).toEqual(["withdrawal_in_force"]);
  });
  it("asks about one that ended inside three years, and ignores one older than that", () => {
    expect(codes(clean({ withdrawals: [w("01/01/2024", "06/01/2024")] }))).toEqual(["withdrawal_recent"]);
    expect(codes(clean({ withdrawals: [w("01/01/2020", "06/01/2020")] }))).toEqual([]);
  });
  it("counts violations inside three years, says how many were in a CMV, and counts an undated one", () => {
    const v = (date: string | null, cmv: string | null = null) => ({ date, description: "SPEEDING", code: null, points: null, commercialVehicle: cmv });
    const f = mvrReportFindings(clean({ violations: [v("03/04/2025", "Y"), v(null), v("01/01/2019")] }), ANA, TODAY);
    expect(f.map((x) => x.code)).toEqual(["violations_recent"]);
    expect(f[0]!.message).toBe("2 violations in the last 3 years, 1 in a commercial vehicle.");
  });
  it("counts crashes inside three years", () => {
    expect(codes(clean({ accidents: [{ date: "02/02/2026", description: "REAR END", code: null, points: null, commercialVehicle: null }] }))).toEqual(["accidents_recent"]);
  });
  it("lists every stop before every check", () => {
    const f = mvrReportFindings(clean({ driverName: "SOMEONE ELSE", licenseStatus: "REVOKED" }), ANA, TODAY);
    expect(f.map((x) => x.weight)).toEqual(["stop", "check"]);
  });
});

describe("printed dates", () => {
  it("reads the US forms a state prints, and refuses anything else", () => {
    expect(printedDay("05/14/2029")).toBe("2029-05-14");
    expect(printedDay("5-4-29")).toBe("2029-05-04");
    expect(printedDay("2029-05-14")).toBe("2029-05-14");
    expect(printedDay("02/30/2029")).toBeNull();
    expect(printedDay("14/05/2029")).toBeNull();
    expect(printedDay(null)).toBeNull();
  });
});

describe("the profile", () => {
  it("is read by one model, and the empty report parses from nothing", () => {
    expect(DOCUMENT_PROFILES.mvr_report.readers).toBe(1);
    expect(emptyMvrReport().violations).toEqual([]);
    expect(emptyMvrReport().licenseStatus).toBeNull();
  });
  it("reads the licence, its status, its expiry and the medical certification at the engine's bar", () => {
    for (const p of ["licenseNumber", "licenseStatus", "licenseExpires", "medicalCertificationStatus", "withdrawals[0].to"]) {
      expect(mvrReportFieldCriticality(p), p).toBe("engine");
    }
    expect(mvrReportFieldCriticality("violations[0].description")).toBe("standard");
  });
  it("never asks for a date of birth or an address", () => {
    const keys = JSON.stringify(Object.keys(mvrReportSchema.shape)).toLowerCase();
    expect(keys).not.toMatch(/birth|dob|address|ssn/);
  });
});
