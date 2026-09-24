import { describe, expect, it } from "vitest";
import { applicantIdentitySchema, draftIdentityComplete } from "./applicantIdentity.js";
import { driverApplicationObject } from "./applicationContract.js";

describe("applicantIdentitySchema", () => {
  it("accepts a real identity and trims the licence", () => {
    const r = applicantIdentitySchema.parse({ date_of_birth: "1980-04-02", cdl_number: " D123 ", cdl_state: "IL" });
    expect(r.cdl_number).toBe("D123");
  });

  it("refuses a blank licence number, a one-letter state and a missing date of birth", () => {
    expect(applicantIdentitySchema.safeParse({ date_of_birth: "1980-04-02", cdl_number: "  ", cdl_state: "IL" }).success).toBe(false);
    expect(applicantIdentitySchema.safeParse({ date_of_birth: "1980-04-02", cdl_number: "D1", cdl_state: "I" }).success).toBe(false);
    expect(applicantIdentitySchema.safeParse({ cdl_number: "D1", cdl_state: "IL" }).success).toBe(false);
  });

  /**
   * ⚠ The bounds must be the application's own. A licence number this step accepts and the filed
   * application then refuses would leave the applicant unable to certify an answer they may not edit.
   */
  it("accepts nothing the application's own schema would refuse for the same three fields", () => {
    const app = driverApplicationObject.pick({ date_of_birth: true, cdl_number: true, cdl_state: true });
    const long = "X".repeat(61);
    for (const value of [
      { date_of_birth: "1980-04-02", cdl_number: long, cdl_state: "IL" },
      { date_of_birth: "1980-04-02", cdl_number: "D1", cdl_state: "X".repeat(11) },
    ]) {
      expect(app.safeParse(value).success).toBe(false);
      expect(applicantIdentitySchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("draftIdentityComplete", () => {
  it("needs all three keys, each a non-blank string", () => {
    const full = { date_of_birth: "1980-04-02", cdl_number: "D1", cdl_state: "IL", first_name: "Susan" };
    expect(draftIdentityComplete(full)).toBe(true);
    expect(draftIdentityComplete({ ...full, cdl_state: "" })).toBe(false);
    expect(draftIdentityComplete({ ...full, cdl_number: "   " })).toBe(false);
    const { date_of_birth: _dob, ...noDob } = full;
    expect(draftIdentityComplete(noDob)).toBe(false);
    expect(draftIdentityComplete({ ...full, date_of_birth: 19800402 })).toBe(false);
  });

  it("is false for no draft at all", () => {
    expect(draftIdentityComplete(null)).toBe(false);
    expect(draftIdentityComplete("nope")).toBe(false);
  });
});
