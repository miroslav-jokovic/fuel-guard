import { describe, it, expect } from "vitest";
import {
  normalizeDriverUsername,
  isValidDriverUsername,
  toSyntheticDriverEmail,
  usernameFromName,
  driverAppAccess,
  customPasswordSchema,
  driverLoginRequestSchema,
  DRIVER_PASSWORD_MIN_LENGTH,
  driverPasswordProblem,
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

describe("driver password length", () => {
  it("accepts an 8-character driver password, the Samsara length, and refuses 7", () => {
    expect(DRIVER_PASSWORD_MIN_LENGTH).toBe(8);
    expect(customPasswordSchema.safeParse("abcd2345").success).toBe(true);
    expect(customPasswordSchema.safeParse("abcd234").success).toBe(false);
    const login = (password: string) =>
      driverLoginRequestSchema.safeParse({ username: "aaron", password });
    expect(login("abcd2345").success).toBe(true);
    expect(login("abcd234").success).toBe(false);
    expect(driverPasswordProblem("abcd2345")).toBeNull();
    expect(driverPasswordProblem("abcd234")).toBe("Password must be at least 8 characters.");
    expect(driverPasswordProblem("a".repeat(129))).toBe(
      "Password must be 128 characters or fewer.",
    );
  });
});
