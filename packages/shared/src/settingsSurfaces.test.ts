import { describe, expect, it } from "vitest";
import { USER_ROLES, type UserRole } from "./constants.js";
import { callerCanManage, callerCanView, isReadOnly, type SectionClaim } from "./auth.js";
import { surfaceAllowed, surfaceStartsOn } from "./surfaces.js";
import { ADMIN_ONLY_SURFACES, GRANTABLE_SURFACES, NAV_SURFACES, SURFACES, directoryScreens } from "./surfaceCatalogue.js";

/**
 * The Settings screens as permissions (SETTINGS-PERMISSIONS-PLAN.md SP1, Q-SET1..3 ruled (a) on
 * 2026-09-30).
 *
 * The step is worth nothing if it changes who gets in on the day it ships — Q-SET2 ruled exactly
 * that out — and a gate moved from four hand-written places into a catalogue is the kind of change
 * where a wrong answer is invisible in review. So the first block asserts EQUIVALENCE: for every
 * role, with the shipped matrix and no org answers, each screen resolves as the pre-SP1 route did.
 * `BEFORE` is that route gate, transcribed once here as the oracle and nowhere else: `requiresAdmin`
 * (a role test), `requiresAuditAccess` (admin or the read-only reviewer), or the section the old
 * catalogue entry named.
 */
const role = (r: UserRole) => r === "admin";
const BEFORE: Record<string, (r: UserRole) => boolean> = {
  "admin.settings.org": role,
  "admin.settings.notifications": role,
  "admin.settings.permissions": role,
  "admin.settings.efs": role,
  "admin.settings.card-control": role,
  "admin.settings.thresholds": role,
  "admin.settings.driver-performance": role,
  "admin.settings.fuel-planning": role,
  "admin.settings.audit": (r) => r === "admin" || isReadOnly(r),
  "admin.settings.data": (r) => callerCanManage(r, "settings", null),
  "admin.settings.driver-app": (r) => callerCanManage(r, "roster", null),
  "admin.recruiting": (r) => callerCanView(r, "recruitment", null),
  "admin.reports": (r) => callerCanView(r, "settings", null),
  "admin.coverage": (r) => callerCanView(r, "settings", null),
  "admin.reefer-coverage": (r) => callerCanView(r, "settings", null),
  "admin.recall-audit": (r) => callerCanView(r, "settings", null),
};
const surface = (key: string) => SURFACES.find((s) => s.key === key)!;
// A driver never reaches a web route (the guard sends them to the app first), so they are not a case.
const OFFICE_ROLES = USER_ROLES.filter((r) => r !== "driver");

describe("SP1 changes nobody's access on the day it ships (Q-SET2)", () => {
  it("covers every screen the Settings directory links to, so a new one cannot skip this test", () => {
    expect(directoryScreens("admin.settings").map((s) => s.key).sort()).toEqual(Object.keys(BEFORE).sort());
  });

  for (const r of OFFICE_ROLES) {
    it(`resolves each Settings screen for ${r} exactly as its route did before`, () => {
      for (const [key, before] of Object.entries(BEFORE))
        expect(surfaceAllowed(surface(key), r, null, null), `${key} for ${r}`).toBe(before(r));
    });
  }

  it("keeps a screen that starts off OFF when the screen claim could not be read", () => {
    // `surfaceClaimFor` fails open to `{}`. Before SP1, `{}` meant "no denials"; for a screen that
    // starts off it must still mean off, or a database blip would hand a fleet manager Organization.
    expect(surfaceAllowed(surface("admin.settings.org"), "fleet_manager", null, {})).toBe(false);
  });
});

describe("a section can open the door, but only an admin's answer walks a role through it", () => {
  it("does not grant a screen that starts off when an org widens the role's section", () => {
    const widened: SectionClaim = { settings: "manage" };
    expect(surfaceAllowed(surface("admin.settings.org"), "dispatcher", widened, null)).toBe(false);
    expect(surfaceAllowed(surface("admin.settings.audit"), "dispatcher", widened, null)).toBe(false);
    // …while a screen the section decides follows the section, as it always has.
    expect(surfaceAllowed(surface("admin.settings.data"), "dispatcher", widened, null)).toBe(true);
  });

  it("turns a screen on for a role or a person that holds its section", () => {
    expect(surfaceAllowed(surface("admin.settings.org"), "fleet_manager", null, { "admin.settings.org": true })).toBe(true);
  });

  it("never lifts a role past a section it does not hold (D-SURF2)", () => {
    expect(surfaceAllowed(surface("admin.settings.org"), "dispatcher", null, { "admin.settings.org": true })).toBe(false);
    expect(
      surfaceAllowed(surface("admin.settings.org"), "fleet_manager", { settings: "none" }, { "admin.settings.org": true }),
    ).toBe(false);
  });

  it("turns the audit log off for an auditor when the org says so (Q-SET3)", () => {
    expect(surfaceAllowed(surface("admin.settings.audit"), "auditor", null, { "admin.settings.audit": false })).toBe(false);
  });

  it("starts off only editable roles: admin keeps every screen, since nobody can answer for them", () => {
    expect(surfaceStartsOn(surface("admin.settings.org"), "admin")).toBe(true);
    expect(surfaceStartsOn(surface("admin.settings.org"), "fleet_manager")).toBe(false);
    expect(surfaceStartsOn(surface("admin.settings.audit"), "auditor")).toBe(true);
    expect(surfaceStartsOn(surface("admin.settings.data"), "fleet_manager")).toBe(true);
  });
});

describe("the catalogue says what the rulings said", () => {
  it("keeps exactly Q-SET1's four screens admin-only", () => {
    expect(ADMIN_ONLY_SURFACES.map((s) => s.key).sort()).toEqual(
      ["admin.settings.card-control", "admin.settings.efs", "admin.settings.permissions", "admin.users"],
    );
  });

  it("offers every other Settings screen as its own permission, and none of them in the sidebar", () => {
    const grantable = new Set(GRANTABLE_SURFACES.map((s) => s.key));
    const nav = new Set(NAV_SURFACES.map((s) => s.key));
    for (const s of directoryScreens("admin.settings")) {
      expect(grantable.has(s.key), s.key).toBe(s.gate.kind !== "admin");
      expect(nav.has(s.key), s.key).toBe(false);
    }
  });
});
