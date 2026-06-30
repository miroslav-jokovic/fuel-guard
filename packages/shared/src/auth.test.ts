import { describe, it, expect } from "vitest";
import {
  emailDomain,
  isEmailDomainAllowed,
  canManageFleet,
  isAdmin,
  isReadOnly,
  claimsToContext,
  inviteCreateSchema,
} from "./index.js";

describe("emailDomain", () => {
  it("extracts and lowercases the domain", () => {
    expect(emailDomain("Miki@Silvicominc.com")).toBe("silvicominc.com");
  });
  it("returns null for malformed addresses", () => {
    expect(emailDomain("nope")).toBeNull();
    expect(emailDomain("@x.com")).toBeNull();
    expect(emailDomain("user@")).toBeNull();
  });
});

describe("isEmailDomainAllowed (audit M2)", () => {
  const allowed = ["silvicominc.com"];
  it("allows an exact (case-insensitive) domain match", () => {
    expect(isEmailDomainAllowed("dana@silvicominc.com", allowed)).toBe(true);
    expect(isEmailDomainAllowed("DANA@SILVICOMINC.COM", allowed)).toBe(true);
  });
  it("rejects other domains and lookalikes", () => {
    expect(isEmailDomainAllowed("dana@silvicominc.com.evil.com", allowed)).toBe(false);
    expect(isEmailDomainAllowed("dana@gmail.com", allowed)).toBe(false);
    expect(isEmailDomainAllowed("garbage", allowed)).toBe(false);
  });
});

describe("role helpers", () => {
  it("gates fleet management to admin + fleet_manager", () => {
    expect(canManageFleet("admin")).toBe(true);
    expect(canManageFleet("fleet_manager")).toBe(true);
    expect(canManageFleet("driver")).toBe(false);
    expect(canManageFleet("auditor")).toBe(false);
    expect(canManageFleet(null)).toBe(false);
  });
  it("identifies admin and read-only roles", () => {
    expect(isAdmin("admin")).toBe(true);
    expect(isReadOnly("auditor")).toBe(true);
    expect(isReadOnly("driver")).toBe(false);
  });
});

describe("claimsToContext", () => {
  it("maps a fully-claimed JWT", () => {
    expect(
      claimsToContext({ sub: "u1", email: "a@b.com", org_id: "o1", user_role: "fleet_manager" }),
    ).toEqual({ userId: "u1", email: "a@b.com", orgId: "o1", role: "fleet_manager" });
  });
  it("nulls org/role when the user has no membership (audit B3)", () => {
    expect(claimsToContext({ sub: "u1" })).toEqual({
      userId: "u1",
      email: null,
      orgId: null,
      role: null,
    });
  });
});

describe("inviteCreateSchema", () => {
  it("accepts a valid invite", () => {
    expect(inviteCreateSchema.safeParse({ email: "x@y.com", role: "driver" }).success).toBe(true);
  });
  it("rejects a bad email or role", () => {
    expect(inviteCreateSchema.safeParse({ email: "x", role: "driver" }).success).toBe(false);
    expect(inviteCreateSchema.safeParse({ email: "x@y.com", role: "boss" }).success).toBe(false);
  });
});
