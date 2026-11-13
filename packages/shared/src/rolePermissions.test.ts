import { describe, expect, it } from "vitest";
import { USER_ROLES } from "./constants.js";
import { EDITABLE_ROLES } from "./auth.js";
import {
  CLOSED_PERMISSION_GRANTS,
  EDITABLE_PERMISSIONS,
  CLOSE_APPLICATION_PERMISSION,
  FULL_SSN_PERMISSION,
  HOME_TIME_PERMISSION,
  LUMPER_CASES_PERMISSION,
  IDENTITY_NUMBER_IMAGES_PERMISSION,
  NOTES_MANAGE_ALL_PERMISSION,
  callerPermissions,
  effectivePermission,
  rolePermissionSetSchema,
  shippedPermission,
  toPermissionGrants,
} from "./rolePermissions.js";
import { IDENTITY_NUMBER_IMAGE_KINDS, canSeePaperImage } from "./identityPaperImages.js";

const KEY = IDENTITY_NUMBER_IMAGES_PERMISSION;

/** HIRING-WORKFLOW-AUDIT-2026-10-31 §15.1 — named permissions a carrier switches per role. */
describe("named permissions (§15.1, D-IDP1..4)", () => {
  it("every catalogue key has the `area.name` shape 0564's CHECK accepts", () => {
    for (const p of EDITABLE_PERMISSIONS) expect(p.key).toMatch(/^[a-z][a-z_]{1,40}\.[a-z][a-z_]{1,60}$/);
  });

  it("ships the owner's ruling: admin, safety manager and recruiter see identity pictures, nobody else", () => {
    const on = USER_ROLES.filter((r) => effectivePermission(r, KEY, {}));
    expect(on.sort()).toEqual(["admin", "recruiter", "safety_manager"]);
  });

  it("an org row overrides the shipped answer in both directions", () => {
    expect(effectivePermission("recruiter", KEY, { recruiter: { [KEY]: false } })).toBe(false);
    expect(effectivePermission("dispatcher", KEY, { dispatcher: { [KEY]: true } })).toBe(true);
    // Another role's row says nothing about this one.
    expect(effectivePermission("safety_manager", KEY, { recruiter: { [KEY]: false } })).toBe(true);
  });

  it("the admin is always on and the driver always off, whatever the rows say (D-PERM7/D-PERM8)", () => {
    const rows = { admin: { [KEY]: false }, driver: { [KEY]: true } };
    expect(effectivePermission("admin", KEY, rows)).toBe(true);
    expect(effectivePermission("driver", KEY, rows)).toBe(false);
    expect(effectivePermission(null, KEY, {})).toBe(false);
    expect(shippedPermission("driver", KEY)).toBe(false);
  });

  it("a failed read closes every editable role and keeps the admin", () => {
    for (const r of EDITABLE_ROLES) expect(effectivePermission(r, KEY, CLOSED_PERMISSION_GRANTS), r).toBe(false);
    expect(effectivePermission("admin", KEY, CLOSED_PERMISSION_GRANTS)).toBe(true);
  });

  it("rows naming an uneditable role or an unknown permission are skipped, never trusted", () => {
    const grants = toPermissionGrants([
      { role: "driver", permission: KEY, allowed: true },
      { role: "admin", permission: KEY, allowed: false },
      { role: "dispatcher", permission: "safety.anything_else", allowed: true },
      { role: "auditor", permission: KEY, allowed: true },
    ]);
    expect(grants).toEqual({ auditor: { [KEY]: true } });
  });

  it("the PUT takes an editable role, a known permission and on, off or back to default", () => {
    expect(rolePermissionSetSchema.safeParse({ role: "recruiter", permission: KEY, allowed: false }).success).toBe(true);
    expect(rolePermissionSetSchema.safeParse({ role: "recruiter", permission: KEY, allowed: null }).success).toBe(true);
    expect(rolePermissionSetSchema.safeParse({ role: "admin", permission: KEY, allowed: false }).success).toBe(false);
    expect(rolePermissionSetSchema.safeParse({ role: "recruiter", permission: "x.y", allowed: true }).success).toBe(false);
  });
});

/** Q-WF4b (§15.1): an SSN card's or a passport's picture is the number; the row is not. */
describe("identity papers whose image is the number (Q-WF4b)", () => {
  it("withholds an SSN card's and a passport's image from a role switched off, and nothing else", () => {
    for (const kind of IDENTITY_NUMBER_IMAGE_KINDS) expect(canSeePaperImage(kind, "dispatcher", {}), kind).toBe(false);
    expect(canSeePaperImage("twic", "dispatcher", {})).toBe(true);
    expect(canSeePaperImage("cdl", "dispatcher", {})).toBe(true);
  });

  it("follows the carrier's switch for the identity kinds", () => {
    const off = { recruiter: { [KEY]: false } };
    expect(canSeePaperImage("ssn_card", "recruiter", {})).toBe(true);
    expect(canSeePaperImage("ssn_card", "recruiter", off)).toBe(false);
    expect(canSeePaperImage("passport", "recruiter", off)).toBe(false);
    expect(canSeePaperImage("ssn_card", null, {})).toBe(false);
  });
});

/** Owner, 2026-11-09: "Safety and admin can close application, and this needs to be in Settings". */
describe("closing an application is a named switch", () => {
  it("ships on for the admin and the safety manager only", () => {
    for (const role of USER_ROLES) {
      expect(effectivePermission(role, CLOSE_APPLICATION_PERMISSION, {}), role).toBe(
        role === "admin" || role === "safety_manager",
      );
    }
  });

  it("follows the carrier's switch both ways, and never for the driver", () => {
    const grants = {
      recruiter: { [CLOSE_APPLICATION_PERMISSION]: true },
      safety_manager: { [CLOSE_APPLICATION_PERMISSION]: false },
    };
    expect(effectivePermission("recruiter", CLOSE_APPLICATION_PERMISSION, grants)).toBe(true);
    expect(effectivePermission("safety_manager", CLOSE_APPLICATION_PERMISSION, grants)).toBe(false);
    expect(effectivePermission("driver", CLOSE_APPLICATION_PERMISSION, { driver: { [CLOSE_APPLICATION_PERMISSION]: true } } as never)).toBe(false);
  });

  it("ships 'Edit and remove anyone's note' to the admin alone — every other role starts off (UNIT-NOTES-PLAN D-UN19)", () => {
    for (const role of EDITABLE_ROLES) expect(shippedPermission(role, NOTES_MANAGE_ALL_PERMISSION), role).toBe(false);
    expect(shippedPermission("admin", NOTES_MANAGE_ALL_PERMISSION)).toBe(true);
    expect(shippedPermission("driver", NOTES_MANAGE_ALL_PERMISSION)).toBe(false);
    expect(effectivePermission("dispatcher", NOTES_MANAGE_ALL_PERMISSION, { dispatcher: { [NOTES_MANAGE_ALL_PERMISSION]: true } })).toBe(true);
  });

  it("callerPermissions answers every catalogue key from the one resolver", () => {
    const grants = { recruiter: { [IDENTITY_NUMBER_IMAGES_PERMISSION]: false } };
    expect(callerPermissions("recruiter", grants)).toEqual({
      [IDENTITY_NUMBER_IMAGES_PERMISSION]: false,
      [CLOSE_APPLICATION_PERMISSION]: false,
      [FULL_SSN_PERMISSION]: false,
      [NOTES_MANAGE_ALL_PERMISSION]: false,
      [HOME_TIME_PERMISSION]: false,
      [LUMPER_CASES_PERMISSION]: false,
    });
    expect(callerPermissions("admin", {})).toEqual({
      [IDENTITY_NUMBER_IMAGES_PERMISSION]: true,
      [CLOSE_APPLICATION_PERMISSION]: true,
      [FULL_SSN_PERMISSION]: true,
      [NOTES_MANAGE_ALL_PERMISSION]: true,
      [HOME_TIME_PERMISSION]: true,
      [LUMPER_CASES_PERMISSION]: true,
    });
    expect(callerPermissions(null, {})).toEqual({
      [IDENTITY_NUMBER_IMAGES_PERMISSION]: false,
      [CLOSE_APPLICATION_PERMISSION]: false,
      [FULL_SSN_PERMISSION]: false,
      [NOTES_MANAGE_ALL_PERMISSION]: false,
      [HOME_TIME_PERMISSION]: false,
      [LUMPER_CASES_PERMISSION]: false,
    });
  });
});

/** Q-AM17 (owner 2026-11-11): "admin and safety" read all nine digits; the recruiter does not, by default. */
describe("reading the full SSN is a named switch", () => {
  it("ships to the safety manager and the admin only, and the carrier may switch it either way", () => {
    for (const role of EDITABLE_ROLES) {
      expect(effectivePermission(role, FULL_SSN_PERMISSION, {}), role).toBe(role === "safety_manager");
    }
    expect(effectivePermission("admin", FULL_SSN_PERMISSION, { admin: { [FULL_SSN_PERMISSION]: false } } as never)).toBe(true);
    expect(effectivePermission("recruiter", FULL_SSN_PERMISSION, { recruiter: { [FULL_SSN_PERMISSION]: true } })).toBe(true);
    expect(effectivePermission("safety_manager", FULL_SSN_PERMISSION, { safety_manager: { [FULL_SSN_PERMISSION]: false } })).toBe(false);
  });
});

/** D-LRC11 (owner 2026-11-13): "dispatchers and billing and other users we select" work the lumper cases. */
describe("working the lumper cases is a named switch", () => {
  it("ships to the roles that manage Dispatch or Billing, and to nobody else but the admin", () => {
    expect(shippedPermission("dispatcher", LUMPER_CASES_PERMISSION)).toBe(true);
    expect(shippedPermission("accountant", LUMPER_CASES_PERMISSION)).toBe(true);
    expect(shippedPermission("fleet_manager", LUMPER_CASES_PERMISSION)).toBe(true);
    expect(shippedPermission("admin", LUMPER_CASES_PERMISSION)).toBe(true);
    for (const role of ["recruiter", "safety_manager", "auditor", "technician", "driver"] as const) {
      expect(shippedPermission(role, LUMPER_CASES_PERMISSION)).toBe(false);
    }
  });
});
