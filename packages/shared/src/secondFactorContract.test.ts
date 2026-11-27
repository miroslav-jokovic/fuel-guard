import { describe, expect, it } from "vitest";
import { OFFICE_ROLES, ROSTER_ISSUED_ROLES } from "./constants.js";
import {
  TWO_STEP_DAYS,
  secondFactorStatus,
  secondFactorStatusSchema,
  twoStepRequired,
  twoStepSatisfied,
  twoStepTrustedUntil,
  twoStepVerifyBodySchema,
} from "./secondFactorContract.js";
import { renderTwoStepCodeEmail } from "./twoStepEmail.js";

/**
 * Two-step sign-in, revision 2 (INSTALLED-APP-PLAN IA-S1, Q-IA20): every office role is asked for an emailed code,
 * and a device that gave one is trusted for a week.
 */
const NOW = new Date("2026-12-01T12:00:00Z");
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("who is asked", () => {
  it("every office role, and no roster-issued one", () => {
    for (const role of OFFICE_ROLES) expect(twoStepRequired(role), role).toBe(true);
    for (const role of ROSTER_ISSUED_ROLES) expect(twoStepRequired(role), role).toBe(false);
  });
  it("no role is not asked — requireOrg refuses such a token on its own", () => {
    expect(twoStepRequired(null)).toBe(false);
    expect(twoStepRequired("")).toBe(false);
  });
});

describe("the week", () => {
  it("a device is trusted for exactly TWO_STEP_DAYS after its code", () => {
    expect(TWO_STEP_DAYS).toBe(7);
    expect(twoStepSatisfied(ago(6 * DAY), NOW)).toBe(true);
    expect(twoStepSatisfied(ago(7 * DAY - 1), NOW)).toBe(true);
    expect(twoStepSatisfied(ago(7 * DAY), NOW)).toBe(false);
    expect(twoStepTrustedUntil(ago(DAY))?.toISOString()).toBe(new Date(NOW.getTime() + 6 * DAY).toISOString());
  });
  it("never, or an unreadable date, trusts nothing", () => {
    for (const v of [null, undefined, "", "soon"]) expect(twoStepSatisfied(v, NOW), String(v)).toBe(false);
  });
});

describe("the status answer", () => {
  it("an office member who never gave a code: required, not satisfied", () => {
    expect(secondFactorStatus({ role: "dispatcher", twoStepAt: null }, "ana@silvicom.com", NOW)).toEqual({
      required: true,
      satisfied: false,
      email_hint: "a•••@silvicom.com",
      trusted_until: null,
    });
  });
  it("within the week: satisfied, and says when it ends; past it: not", () => {
    const s = secondFactorStatus({ role: "admin", twoStepAt: ago(DAY) }, "b@x.com", NOW);
    expect(s.satisfied).toBe(true);
    expect(s.trusted_until).toBe(new Date(NOW.getTime() + 6 * DAY).toISOString());
    expect(secondFactorStatus({ role: "admin", twoStepAt: ago(8 * DAY) }, "b@x.com", NOW).satisfied).toBe(false);
  });
  it("a role that is not asked is satisfied without a code", () => {
    expect(secondFactorStatus({ role: "driver", twoStepAt: null }, null, NOW)).toMatchObject({ required: false, satisfied: true });
  });
  it("matches its schema", () => {
    expect(secondFactorStatusSchema.safeParse(secondFactorStatus({ role: "admin", twoStepAt: null }, null, NOW)).success).toBe(true);
  });
});

describe("small pieces", () => {
  it("masks the address to its first letter and domain, and says nothing without one", () => {
    expect(secondFactorStatus({ role: "admin", twoStepAt: null }, "miki@silvicominc.com", NOW).email_hint).toBe("m•••@silvicominc.com");
    expect(secondFactorStatus({ role: "admin", twoStepAt: null }, null, NOW).email_hint).toBeNull();
  });
  it("a code is six digits, spaces forgiven", () => {
    expect(twoStepVerifyBodySchema.parse({ code: " 123 456 " }).code).toBe("123456");
    for (const code of ["12345", "1234567", "12a456", ""]) expect(twoStepVerifyBodySchema.safeParse({ code }).success, code).toBe(false);
  });
  it("the email carries the code, no link, and the not-me advice", () => {
    const m = renderTwoStepCodeEmail("042917");
    expect(m.subject).toContain("042917");
    expect(m.html).toContain("042917");
    expect(m.html).not.toMatch(/href=/);
    expect(m.text).toContain("0 4 2 9 1 7");
    expect(m.text).toMatch(/didn't just sign in/);
  });
});
