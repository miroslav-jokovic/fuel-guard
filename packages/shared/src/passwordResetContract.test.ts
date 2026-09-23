import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  inviteRedeemSchema,
  passwordProblem,
  passwordResetRedeemSchema,
  renderPasswordChangedEmail,
  renderPasswordResetEmail,
} from "./index.js";

/**
 * D-PWR7: one password rule for every password an office user chooses, run on both sides.
 */
describe("passwordProblem", () => {
  const EMAIL = "pavlin@silvicominc.com";

  it("accepts a twelve-character passphrase with no composition rule", () => {
    expect(passwordProblem("correct horse", EMAIL)).toBeNull();
  });

  it("refuses eleven characters and accepts twelve — the boundary is the constant", () => {
    expect(passwordProblem("a1b2c3d4e5f", EMAIL)).toBe(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
    expect(passwordProblem("a1b2c3d4e5f6", EMAIL)).toBeNull();
  });

  it("refuses more than bcrypt reads, rather than silently truncating it", () => {
    expect(passwordProblem("x1".repeat(37), EMAIL)).toBe(`Use at most ${PASSWORD_MAX_LENGTH} characters.`);
  });

  it("refuses one character repeated", () => {
    expect(passwordProblem("aaaaaaaaaaaaaa", EMAIL)).toBe("Don't use one character repeated.");
  });

  it("refuses the address itself and anything containing its local part, whatever the case", () => {
    expect(passwordProblem(EMAIL, EMAIL)).toMatch(/email address/);
    expect(passwordProblem("My-PAVLIN-password", EMAIL)).toMatch(/email address/);
  });

  it("does not treat a short local part as a word to avoid", () => {
    expect(passwordProblem("bob is a builder!", "bob@example.test")).toBeNull();
  });

  it("checks the confirmation only when one is given", () => {
    expect(passwordProblem("correct horse", EMAIL, "correct horsy")).toBe("Passwords do not match.");
    expect(passwordProblem("correct horse", EMAIL, "correct horse")).toBeNull();
  });
});

describe("the contracts share the rule", () => {
  it("invitation and reset both refuse eleven characters and accept twelve", () => {
    for (const schema of [inviteRedeemSchema, passwordResetRedeemSchema]) {
      expect(schema.safeParse({ token: "t".repeat(43), password: "a".repeat(11) }).success).toBe(false);
      expect(schema.safeParse({ token: "t".repeat(43), password: "a".repeat(12) }).success).toBe(true);
    }
  });
});

describe("the reset emails", () => {
  it("escape the link in HTML and carry it verbatim in text", () => {
    const mail = renderPasswordResetEmail(`https://x.test/reset-password?token=a"b`, false);
    expect(mail.html).toContain("token=a&quot;b");
    expect(mail.html).not.toContain(`token=a"b`);
    expect(mail.text).toContain(`token=a"b`);
  });

  it("the notice carries no reset link, only where to sign in", () => {
    const mail = renderPasswordChangedEmail("https://x.test/login");
    expect(mail.text).not.toContain("reset-password");
    expect(mail.text).toContain("https://x.test/login");
  });
});
