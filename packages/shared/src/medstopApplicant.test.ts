import { describe, expect, it } from "vitest";
import {
  MEDSTOP_APPLICANT_REQUIRED,
  fillMedstopApplicantForm,
  medstopApplicantSkip,
  medstopDate,
  medstopPhone,
  type MedstopApplicantFacts,
} from "./medstopApplicant.js";

/**
 * The Med-Stop applicant form (UX5c, MEDSTOP-PLAN §7A.13). The owner's ask: what we send must match
 * Med-Stop's form exactly. `FORM` is `GET /Employee/new` as measured 2026-10-13 — its 46 keys in its
 * order, its defaults, an empty string or null where it left a field blank (personal fields are blank
 * in a new form, so nothing here is anybody's data).
 */
const FORM: Record<string, unknown> = {
  id: "", employerid: "EMPLOYER-1", employeeid: "", eeid: "", dot: "Y", dotagency: "FMCSA", branch: "",
  branchid: "BRANCH-1", ssn: "", birthdate: null, lname: "", fname: "", mname: "", gender: "", eyes: "",
  hair: "", status: "", dotstatus: "Y", applicationdate: "2026-10-13T00:00:00Z", startdate: "2026-10-13T00:00:00Z",
  annualreview: "2027-10-13T00:00:00Z", medexpiration: null, code: "", position: "", category: "", address: "",
  address1: "", city: "", state: "", zip: "", country: "US", phone1: "", fax1: "", email: "", emergencycontact: "",
  drivingtype: "", idclass: "", license: "", licensestate: "", licenseclass: "", licenseexpiration: null,
  licenserestrictions: "", licenseendorsements: "", idnumber: "", idstate: "", idexpiration: null,
};

const facts: MedstopApplicantFacts = {
  invitationId: "inv-1", driverId: "d-1", firstName: "Ann", middleName: null, lastName: "Driver",
  birthDate: "1985-03-07", gender: "female", addressLine1: "12 Depot Rd", addressLine2: null, city: "Joliet",
  state: "il", postalCode: "60432", phone: "+13125550142", licenceNumber: "D123-4567-8901", licenceState: "IL",
  licenceExpiresOn: "2029-01-31", cdlClass: "A",
};

describe("fillMedstopApplicantForm — Med-Stop's own form, ours filled in", () => {
  it("sends back exactly the form's 46 keys, in its order — nothing dropped, nothing added", () => {
    const r = fillMedstopApplicantForm(FORM, facts);
    if (!("form" in r)) throw new Error("expected a form");
    expect(Object.keys(r.form)).toEqual(Object.keys(FORM));
    expect(Object.keys(r.form)).toHaveLength(46);
  });

  it("keeps Med-Stop's own defaults — branch, agency, DOT status, application and review dates, country", () => {
    const r = fillMedstopApplicantForm(FORM, facts) as { form: Record<string, unknown> };
    expect(r.form).toMatchObject({
      employerid: "EMPLOYER-1", branchid: "BRANCH-1", dotagency: "FMCSA", dotstatus: "Y", dot: "Y", country: "US",
      applicationdate: "2026-10-13T00:00:00Z", annualreview: "2027-10-13T00:00:00Z",
    });
  });

  it("fills ours in Med-Stop's shapes — what the office's hand-entered applicants hold", () => {
    const r = fillMedstopApplicantForm(FORM, facts) as { form: Record<string, unknown> };
    expect(r.form).toMatchObject({
      fname: "Ann", lname: "Driver", mname: "", birthdate: "1985-03-07T00:00:00Z", gender: "FEMALE",
      status: "APPLICANT", category: "DRIVER", drivingtype: "NON-EXCEPTED INTERSTATE", idclass: "CDL",
      address: "12 Depot Rd", address1: "", city: "Joliet", state: "IL", zip: "60432", phone1: "(312) 555-0142",
      license: "D123-4567-8901", licensestate: "IL", licenseclass: "A", licenseexpiration: "2029-01-31T00:00:00Z",
    });
  });

  it("sends the CDL number as the id and never an SSN (O-5)", () => {
    const r = fillMedstopApplicantForm(FORM, facts) as { form: Record<string, unknown> };
    expect(r.form.idnumber).toBe("D123-4567-8901");
    expect(r.form.ssn).toBe("");
  });

  it("leaves the start date empty, as on every hand-entered applicant — not the form's 'today'", () => {
    const r = fillMedstopApplicantForm(FORM, facts) as { form: Record<string, unknown> };
    expect(r.form.startdate).toBeNull();
  });

  it("refuses to send while any other required key is empty, and names them", () => {
    const r = fillMedstopApplicantForm(FORM, { ...facts, birthDate: null, phone: "312", city: " " });
    expect(r).toEqual({ missing: ["birthdate", "city", "phone1"] });
  });

  it("refuses when Med-Stop's form lacks a key it requires — the form changed, so nothing is guessed", () => {
    const { branchid: _gone, ...older } = FORM;
    expect(fillMedstopApplicantForm(older, facts)).toEqual({ missing: ["branchid"] });
  });

  it("requires the 24 keys the spec marks required", () => {
    expect(MEDSTOP_APPLICANT_REQUIRED).toHaveLength(24);
    for (const k of MEDSTOP_APPLICANT_REQUIRED) expect(FORM).toHaveProperty(k);
  });
});

describe("medstopApplicantSkip", () => {
  it("creates nobody who declined, was never asked, or holds a licence from outside the US", () => {
    expect(medstopApplicantSkip(facts)).toBeNull();
    expect(medstopApplicantSkip({ ...facts, gender: "declined" })).toMatch(/chose not to give a gender/);
    expect(medstopApplicantSkip({ ...facts, gender: null })).toMatch(/did not ask/);
    expect(medstopApplicantSkip({ ...facts, licenceState: "ON" })).toMatch(/not from a US state/);
  });
});

describe("shapes", () => {
  it("writes a phone and a day as Med-Stop does", () => {
    expect(medstopPhone("+13125550142")).toBe("(312) 555-0142");
    expect(medstopPhone("3125550142")).toBeNull();
    expect(medstopDate("2029-01-31")).toBe("2029-01-31T00:00:00Z");
    expect(medstopDate("01/31/2029")).toBeNull();
  });
});
