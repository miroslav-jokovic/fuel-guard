import { describe, expect, it } from "vitest";
import {
  INTAKE_LICENCE_NUMBER_MAX_LENGTH,
  applicantIntakeLicencesSchema,
  applicantIntakeSchema,
  usMobilePhoneSchema,
} from "./applicantScreeningContract.js";

/** Part 1's contract against 0376's CHECKs — a value this accepts and the table refuses is a 500. */
describe("Part 1 answers", () => {
  it("normalises a US mobile to the E.164 0376 stores, and refuses anything the provider cannot text", () => {
    expect(usMobilePhoneSchema.parse("(708) 236-5732")).toBe("+17082365732");
    expect(usMobilePhoneSchema.parse("1-708-236-5732")).toBe("+17082365732");
    // `^\+1[2-9]…`: a US area code never starts with 0 or 1.
    expect(usMobilePhoneSchema.safeParse("(108) 236-5732").success).toBe(false);
    expect(usMobilePhoneSchema.safeParse("+442079460958").success).toBe(false);
  });

  it("takes a US state for the address and refuses a province, which has no five-digit ZIP", () => {
    expect(applicantIntakeSchema.parse({ state: "il" }).state).toBe("IL");
    expect(applicantIntakeSchema.safeParse({ state: "ON" }).success).toBe(false);
    expect(applicantIntakeSchema.safeParse({ postal_code: "6060" }).success).toBe(false);
  });

  it("takes the roster's endorsement letters and class, and refuses an empty body", () => {
    expect(applicantIntakeSchema.safeParse({ endorsements: ["H", "X"], cdl_class: "A" }).success).toBe(true);
    expect(applicantIntakeSchema.safeParse({ endorsements: ["Q"] }).success).toBe(false);
    expect(applicantIntakeSchema.safeParse({}).success).toBe(false);
  });
});

describe("the licence list", () => {
  it("accepts a Canadian licence — a jurisdiction, not an address", () => {
    expect(applicantIntakeLicencesSchema.safeParse({
      licences: [{ state_code: "on", licence_number: "A1234-56789-01234" }],
    }).success).toBe(true);
  });

  it("holds the licence number to 0376's 40 characters", () => {
    const at = (n: number) => ({ licences: [{ state_code: "IL", licence_number: "9".repeat(n) }] });
    expect(applicantIntakeLicencesSchema.safeParse(at(INTAKE_LICENCE_NUMBER_MAX_LENGTH)).success).toBe(true);
    expect(applicantIntakeLicencesSchema.safeParse(at(INTAKE_LICENCE_NUMBER_MAX_LENGTH + 1)).success).toBe(false);
  });

  it("names the second entry when the same licence is listed twice, case-insensitively", () => {
    const r = applicantIntakeLicencesSchema.safeParse({
      licences: [{ state_code: "IL", licence_number: "abc" }, { state_code: "il", licence_number: "ABC" }],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["licences", 1]);
  });
});
