import { describe, it, expect } from "vitest";
import {
  APPLICATION_RELEASE_ORDER,
  INVITE_TTL_DAYS_MAX,
  applicationInviteCreateSchema,
  applicationReleaseSchema,
  isDraftDisclosure,
  planApplicationIntake,
  ssnLast4,
  ssnSchema,
} from "./applicationIntake.js";
import { DISCLOSURES } from "./authorizationContract.js";
import type { DriverApplication } from "./applicationContract.js";

const DRIVER_ID = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

const employer = (over: Record<string, unknown> = {}) => ({
  employer_name: "Old Carrier",
  usdot_number: "123456",
  city: "Joliet",
  state: "IL",
  phone: "555-0100",
  position_held: "Driver",
  started_on: "2023-01-01",
  ended_on: "2025-06-30",
  operated_cmv: true,
  dot_regulated: true,
  reason_for_leaving: "Better route",
  subject_to_fmcsr: true,
  safety_sensitive: true,
  ...over,
});

const application = (over: Record<string, unknown> = {}) =>
  ({
    first_name: "Susan",
    last_name: "Godfrey",
    date_of_birth: "1980-04-01",
    email: "s@example.test",
    phone: "555-0111",
    addresses: [],
    cdl_number: "PA334554",
    cdl_state: "PA",
    cdl_expires_at: "2029-01-01",
    accidents: [],
    declares_no_accidents: true,
    violations: [],
    declares_no_violations: true,
    licence_ever_denied: false,
    employers: [employer()],
    declares_no_employment: false,
    certified: true,
    signed_name: "Susan Godfrey",
    ...over,
  }) as unknown as DriverApplication;

describe("what a submitted application becomes", () => {
  it("fills the driver's identity from what they declared", () => {
    const { driverPatch } = planApplicationIntake(application());
    expect(driverPatch).toEqual({
      first_name: "Susan",
      last_name: "Godfrey",
      date_of_birth: "1980-04-01",
      cdl_number: "PA334554",
      cdl_state: "PA",
      // §391.23(a)(2) — projected so the previous-employer inquiry can name both (0231).
      other_names: [],
    });
  });

  it("maps the form's field names onto the employment table's", () => {
    const { employment } = planApplicationIntake(application());
    expect(employment[0]).toMatchObject({
      employer_city: "Joliet",
      employer_state: "IL",
      employer_phone: "555-0100",
    });
  });

  /** §40.25(j)'s answers decide what an inquiry must ASK, so they ride on the row it is chased from. */
  it("carries the §40.25(j) answers onto the row", () => {
    const { employment } = planApplicationIntake(application());
    expect(employment[0]).toMatchObject({ subject_to_fmcsr: true, safety_sensitive: true });
  });

  /**
   * Every declared employer becomes a row, including ones outside both §391.21 windows: dropping one
   * would delete part of a document somebody certified as true and complete, and would throw away
   * corroboration the PSP cross-match can still use.
   */
  it("keeps an employer from outside both windows", () => {
    const { employment } = planApplicationIntake(
      application({ employers: [employer({ started_on: "2009-01-01", ended_on: "2010-01-01" })] }),
    );
    expect(employment).toHaveLength(1);
  });

  it("survives an applicant who declares no employment at all", () => {
    const { employment } = planApplicationIntake(application({ employers: [], declares_no_employment: true }));
    expect(employment).toEqual([]);
  });
});

describe("the Social Security number (D-HIRE6)", () => {
  it("accepts nine digits and nothing else", () => {
    expect(ssnSchema.safeParse("123456789").success).toBe(true);
    for (const bad of ["123-45-6789", "12345678", "1234567890", "12345678a", ""]) {
      expect(ssnSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("keeps only the last four", () => {
    expect(ssnLast4("123456789")).toBe("6789");
  });
});

describe("the invitation", () => {
  it("bounds the lifetime of a live credential", () => {
    expect(applicationInviteCreateSchema.safeParse({ driver_id: DRIVER_ID, expires_in_days: 90 }).success).toBe(false);
    expect(applicationInviteCreateSchema.safeParse({ driver_id: DRIVER_ID, expires_in_days: INVITE_TTL_DAYS_MAX }).success).toBe(true);
  });

  it("defaults to a fortnight rather than forever", () => {
    const parsed = applicationInviteCreateSchema.parse({ driver_id: DRIVER_ID });
    expect(parsed.expires_in_days).toBe(14);
  });
});

describe("signing", () => {
  /** ESIGN intent is affirmed on the instrument, never inherited from the application. */
  it("refuses a release that does not affirm intent", () => {
    const base = { purpose: "psp", signed_name: "Susan Godfrey" };
    expect(applicationReleaseSchema.safeParse({ ...base, esign_consent: true }).success).toBe(true);
    expect(applicationReleaseSchema.safeParse({ ...base, esign_consent: false }).success).toBe(false);
    expect(applicationReleaseSchema.safeParse(base).success).toBe(false);
  });

  /**
   * The gate that keeps a real signature off placeholder text (Q-H3). This test is expected to flip
   * the day counsel's wording lands and the versions become v1 — which is the point: the refusal is
   * tied to the hazard, not to a flag somebody has to remember to clear.
   */
  it("treats every shipped disclosure as draft while the wording is v0", () => {
    for (const purpose of APPLICATION_RELEASE_ORDER) {
      expect(isDraftDisclosure(DISCLOSURES[purpose].version), purpose).toBe(true);
    }
    expect(isDraftDisclosure("v1")).toBe(false);
    expect(isDraftDisclosure("v2-2027-revision")).toBe(false);
  });
});
