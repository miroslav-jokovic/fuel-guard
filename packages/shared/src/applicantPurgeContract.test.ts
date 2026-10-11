import { describe, expect, it } from "vitest";
import { USER_ROLES } from "./constants.js";
import { applicantPurgeSchema, canPurgeApplicant, purgeNameMatches } from "./applicantPurgeContract.js";

describe("canPurgeApplicant", () => {
  it("is the admin and nobody else (Q-AW40: admin only)", () => {
    expect(USER_ROLES.filter(canPurgeApplicant)).toEqual(["admin"]);
    expect(canPurgeApplicant(null)).toBe(false);
  });
});

describe("purgeNameMatches", () => {
  it("accepts the name with any case and spacing", () => {
    expect(purgeNameMatches("Ana Plicant", "Ana Plicant")).toBe(true);
    expect(purgeNameMatches("  ana   PLICANT ", "Ana  Plicant")).toBe(true);
  });

  it("refuses a partial name, another name, or one with a letter too many", () => {
    expect(purgeNameMatches("Ana", "Ana Plicant")).toBe(false);
    expect(purgeNameMatches("Bo Standing", "Ana Plicant")).toBe(false);
    expect(purgeNameMatches("Ana Plicantt", "Ana Plicant")).toBe(false);
  });

  it("refuses everything when the applicant has no name — an empty match is not a confirmation", () => {
    expect(purgeNameMatches("", "")).toBe(false);
    expect(purgeNameMatches("", null)).toBe(false);
    expect(purgeNameMatches("   ", "  ")).toBe(false);
  });
});

describe("applicantPurgeSchema", () => {
  it("requires a non-blank name", () => {
    expect(applicantPurgeSchema.safeParse({ confirm_name: "  " }).success).toBe(false);
    expect(applicantPurgeSchema.safeParse({}).success).toBe(false);
    expect(applicantPurgeSchema.safeParse({ confirm_name: "Ana" }).success).toBe(true);
  });
});
