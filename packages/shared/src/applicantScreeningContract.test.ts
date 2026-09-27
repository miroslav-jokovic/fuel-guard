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
  const EXP = "2029-01-01";

  it("accepts a Canadian licence — a jurisdiction, not an address", () => {
    expect(applicantIntakeLicencesSchema.safeParse({
      licences: [{ state_code: "on", licence_number: "A1234-56789-01234", expires_on: EXP }],
    }).success).toBe(true);
  });

  it("holds the licence number to 0376's 40 characters", () => {
    const at = (n: number) => ({ licences: [{ state_code: "IL", licence_number: "9".repeat(n), expires_on: EXP }] });
    expect(applicantIntakeLicencesSchema.safeParse(at(INTAKE_LICENCE_NUMBER_MAX_LENGTH)).success).toBe(true);
    expect(applicantIntakeLicencesSchema.safeParse(at(INTAKE_LICENCE_NUMBER_MAX_LENGTH + 1)).success).toBe(false);
  });

  /** Q-AW35 (a): filing refuses a licence with no date, and after Part 1 nothing can supply one. */
  it("refuses a licence with no expiry date — absent, null or blank — and takes a date already past", () => {
    const one = (expiry: Record<string, unknown>) =>
      applicantIntakeLicencesSchema.safeParse({ licences: [{ state_code: "OH", licence_number: "1", ...expiry }] });
    for (const blank of [{}, { expires_on: null }, { expires_on: "" }, { expires_on: "  " }]) {
      const r = one(blank);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]).toMatchObject({
        path: ["licences", 0, "expires_on"], message: "Give the expiry date printed on the licence",
      });
    }
    expect(one({ expires_on: "31/12/2020" }).success).toBe(false);
    // A licence given up on moving is still one the MVR is ordered for; its past date is the answer.
    expect(one({ expires_on: "2020-12-31" }).data?.licences[0]?.expires_on).toBe("2020-12-31");
  });

  it("names the second entry when the same licence is listed twice, case-insensitively", () => {
    const r = applicantIntakeLicencesSchema.safeParse({
      licences: [{ state_code: "IL", licence_number: "abc", expires_on: EXP }, { state_code: "il", licence_number: "ABC", expires_on: EXP }],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["licences", 1]);
  });
});
