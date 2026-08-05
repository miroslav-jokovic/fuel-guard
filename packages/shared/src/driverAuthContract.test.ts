import { describe, it, expect } from "vitest";
import {
  normalizeDriverUsername,
  isValidDriverUsername,
  toSyntheticDriverEmail,
  usernameFromName,
  driverAppAccess,
} from "./driverAuthContract.js";

describe("driver username rules", () => {
  it("normalizes case/whitespace and validates the charset", () => {
    expect(normalizeDriverUsername("  Aaron.C ")).toBe("aaron.c");
    expect(isValidDriverUsername("aaron.c")).toBe(true);
    expect(isValidDriverUsername("a1-b_c.d")).toBe(true);
    expect(isValidDriverUsername("ab")).toBe(false); // too short
    expect(isValidDriverUsername(".aaron")).toBe(false); // must start alphanumeric
    expect(isValidDriverUsername("aaron cole")).toBe(false); // no spaces
    expect(isValidDriverUsername("AARON")).toBe(false); // stored form is lowercase
    expect(isValidDriverUsername("a".repeat(33))).toBe(false); // too long
  });

  it("builds a deterministic synthetic email", () => {
    expect(toSyntheticDriverEmail("Aaron")).toBe("aaron@drivers.fuelguard.app");
  });

  it("derives a username candidate from a full name", () => {
    expect(usernameFromName("Aaron B. Cole")).toBe("aaron.cole");
    expect(usernameFromName("MICHAEL KENT")).toBe("michael.kent");
    expect(usernameFromName("Cher")).toBe("cher");
    expect(usernameFromName("")).toBe("");
  });
});

describe("driverAppAccess", () => {
  it("derives none/active/disabled from the stored facts", () => {
    expect(driverAppAccess(null, null)).toBe("none");
    expect(driverAppAccess(null, true)).toBe("none");
    expect(driverAppAccess("u1", true)).toBe("active");
    expect(driverAppAccess("u1", false)).toBe("disabled");
    expect(driverAppAccess("u1", null)).toBe("disabled");
  });
});
