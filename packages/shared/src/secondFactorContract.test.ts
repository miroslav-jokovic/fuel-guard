import { describe, expect, it } from "vitest";
import { USER_ROLES } from "./constants.js";
import { secondFactorDue, secondFactorRequired, secondFactorStatus, secondFactorStatusSchema } from "./secondFactorContract.js";

/**
 * Two-step sign-in, the rule (INSTALLED-APP-PLAN IA-S1; Q-IA1 (b), Q-IA12 (b), Q-IA13): required of whoever
 * HAS a factor, and of an admin once their company's date has passed — of the admin role and no other.
 */
const NOW = new Date("2026-12-01T12:00:00Z");
const PAST = "2026-11-30T00:00:00Z";
const AHEAD = "2026-12-10T00:00:00Z";

describe("who must take the second step", () => {
  it("an admin, from the company's date — to the instant", () => {
    expect(secondFactorRequired({ role: "admin", hasFactor: false, requiredFrom: PAST }, NOW)).toBe(true);
    expect(secondFactorRequired({ role: "admin", hasFactor: false, requiredFrom: AHEAD }, NOW)).toBe(false);
    expect(secondFactorRequired({ role: "admin", hasFactor: false, requiredFrom: NOW.toISOString() }, NOW)).toBe(true);
  });

  it("no other role by the date, whatever the date — the list is the admin role alone", () => {
    for (const role of USER_ROLES.filter((r) => r !== "admin")) {
      expect(secondFactorRequired({ role, hasFactor: false, requiredFrom: PAST }, NOW), role).toBe(false);
    }
  });

  it("anybody who has a factor, whatever their role and whatever the date", () => {
    for (const role of USER_ROLES) expect(secondFactorRequired({ role, hasFactor: true, requiredFrom: AHEAD }, NOW), role).toBe(true);
  });

  it("a date that cannot be read requires nothing by itself — and a factor still does", () => {
    expect(secondFactorRequired({ role: "admin", hasFactor: false, requiredFrom: null }, NOW)).toBe(false);
    expect(secondFactorRequired({ role: "admin", hasFactor: false, requiredFrom: "soon" }, NOW)).toBe(false);
    expect(secondFactorRequired({ role: "admin", hasFactor: true, requiredFrom: null }, NOW)).toBe(true);
    expect(secondFactorDue({ role: null, requiredFrom: PAST }, NOW)).toBe(false);
  });
});

describe("what the app is told", () => {
  it("an admin in their notice period: not required, the date shown, free to turn it off again", () => {
    expect(secondFactorStatus({ role: "admin", hasFactor: false, requiredFrom: AHEAD }, "aal1", NOW))
      .toEqual({ required: false, satisfied: false, has_factor: false, due_from: AHEAD, must_keep: false });
  });

  it("an admin who set it up early is required at once, shown no date, and may still turn it off before the date", () => {
    expect(secondFactorStatus({ role: "admin", hasFactor: true, requiredFrom: AHEAD }, "aal2", NOW))
      .toEqual({ required: true, satisfied: true, has_factor: true, due_from: null, must_keep: false });
  });

  it("an admin past the date must keep it", () => {
    expect(secondFactorStatus({ role: "admin", hasFactor: true, requiredFrom: PAST }, "aal2", NOW).must_keep).toBe(true);
  });

  it("only aal2 is the second step taken", () => {
    for (const aal of ["aal1", "", null, undefined, "AAL2"]) expect(secondFactorStatus({ role: "admin", hasFactor: true, requiredFrom: PAST }, aal, NOW).satisfied, String(aal)).toBe(false);
  });

  it("the date is shown to no other role", () => {
    expect(secondFactorStatus({ role: "dispatcher", hasFactor: false, requiredFrom: AHEAD }, "aal1", NOW).due_from).toBeNull();
  });

  it("the answer is the contract's shape", () => {
    expect(secondFactorStatusSchema.safeParse(secondFactorStatus({ role: "admin", hasFactor: false, requiredFrom: AHEAD }, "aal1", NOW)).success).toBe(true);
  });
});
