import { describe, it, expect } from "vitest";
import {
  emailDomain,
  isEmailDomainAllowed,
  canManageFleet,
  canResolveAnomalies,
  isAdmin,
  isReadOnly,
  claimsToContext,
  inviteCreateSchema,
  sectionAccess,
  canViewSection,
  canManageSection,
  rolesThatManage,
  rolesThatCanView,
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
  it("lets admin, fleet_manager AND safety_manager resolve anomalies (Safety action)", () => {
    expect(canResolveAnomalies("admin")).toBe(true);
    expect(canResolveAnomalies("fleet_manager")).toBe(true);
    expect(canResolveAnomalies("safety_manager")).toBe(true);
    expect(canResolveAnomalies("dispatcher")).toBe(false);
    expect(canResolveAnomalies("auditor")).toBe(false);
    expect(canResolveAnomalies(null)).toBe(false);
  });
});

describe("section capability matrix", () => {
  it("dispatcher: manages Dispatch, reads Fuel + Fleet, no Safety/Admin", () => {
    expect(canManageSection("dispatcher", "dispatch")).toBe(true);
    expect(canViewSection("dispatcher", "fuel")).toBe(true);
    expect(canManageSection("dispatcher", "fuel")).toBe(false);
    expect(canViewSection("dispatcher", "fleet")).toBe(true);
    expect(canManageSection("dispatcher", "fleet")).toBe(false);
    expect(canViewSection("dispatcher", "safety")).toBe(false);
    expect(canViewSection("dispatcher", "admin")).toBe(false);
  });
  it("safety_manager: manages Safety + Fleet, reads Fuel, no Dispatch/Admin", () => {
    expect(canManageSection("safety_manager", "safety")).toBe(true);
    expect(canManageSection("safety_manager", "fleet")).toBe(true);
    expect(canViewSection("safety_manager", "fuel")).toBe(true);
    expect(canManageSection("safety_manager", "fuel")).toBe(false);
    expect(canViewSection("safety_manager", "dispatch")).toBe(false);
    expect(canViewSection("safety_manager", "admin")).toBe(false);
  });
  it("admin manages everything incl. Admin; auditor views all but manages none; driver sees no section", () => {
    for (const s of ["fuel", "dispatch", "safety", "fleet", "admin"] as const) expect(canManageSection("admin", s)).toBe(true);
    expect(canViewSection("auditor", "safety")).toBe(true);
    expect(canManageSection("auditor", "safety")).toBe(false);
    expect(canViewSection("driver", "fuel")).toBe(false);
    expect(sectionAccess(null, "fuel")).toBe("none");
  });
  it("rolesThatManage/rolesThatCanView expose the matrix for guard building", () => {
    expect(rolesThatManage("dispatch").sort()).toEqual(["admin", "dispatcher", "fleet_manager"]);
    expect(rolesThatManage("safety").sort()).toEqual(["admin", "fleet_manager", "safety_manager"]);
    expect(rolesThatManage("fleet").sort()).toEqual(["admin", "fleet_manager", "safety_manager"]);
    expect(rolesThatCanView("fuel").sort()).toEqual(["admin", "auditor", "dispatcher", "fleet_manager", "safety_manager"]);
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
