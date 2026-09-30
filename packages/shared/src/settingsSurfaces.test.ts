import { describe, expect, it } from "vitest";
import { USER_ROLES } from "./constants.js";
import { callerCanView, type SectionClaim } from "./auth.js";
import { surfaceAllowed, surfaceGateAllows, surfaceStartsOn } from "./surfaces.js";
import { ADMIN_ONLY_SURFACES, GRANTABLE_SURFACES, NAV_SURFACES, SURFACES, directoryScreens } from "./surfaceCatalogue.js";

/**
 * The Settings screens as permissions (SETTINGS-PERMISSIONS-PLAN.md SP1, Q-SET1..3 ruled (a) on
 * 2026-09-30, and Q-SET2 revised by the owner the same day: *"make all admin only by default, hide
 * Settings too"*).
 *
 * So the day-one answer is one sentence, and the first block asserts it for every role against every
 * screen the directory links to — iterated from the catalogue, so a screen added later is held to it
 * without anyone remembering this file: with the shipped matrix and no org answers, only the admin
 * reaches any Settings screen, or the Settings entry itself.
 */
const surface = (key: string) => SURFACES.find((s) => s.key === key)!;
const SETTINGS = surface("admin.settings");
// A driver never reaches a web route (the guard sends them to the app first), so they are not a case.
const OFFICE_ROLES = USER_ROLES.filter((r) => r !== "driver");

describe("by default only the admin sees Settings (Q-SET2 as revised)", () => {
  it("links the directory to all sixteen screens, so this block is not vacuous", () => {
    expect(directoryScreens("admin.settings")).toHaveLength(16);
  });

  for (const r of OFFICE_ROLES) {
    it(`resolves every Settings screen, and the Settings entry, for ${r} as ${r === "admin" ? "open" : "closed"}`, () => {
      for (const s of directoryScreens("admin.settings"))
        expect(surfaceAllowed(s, r, null, null), `${s.key} for ${r}`).toBe(r === "admin");
      expect(surfaceAllowed(SETTINGS, r, null, null), `the Settings entry for ${r}`).toBe(r === "admin");
    });
  }

  it("keeps a screen that starts off OFF when the screen claim could not be read", () => {
    // `surfaceClaimFor` fails open to `{}`. Before SP1, `{}` meant "no denials"; for a screen that
    // starts off it must still mean off, or a database blip would hand a fleet manager Organization.
    expect(surfaceAllowed(surface("admin.settings.org"), "fleet_manager", null, {})).toBe(false);
    expect(surfaceAllowed(SETTINGS, "fleet_manager", null, {})).toBe(false);
  });
});

describe("the Settings entry follows the screens behind it", () => {
  it("appears for a role the admin has turned one screen on for, and only that", () => {
    expect(surfaceAllowed(SETTINGS, "fleet_manager", null, { "admin.settings.org": true })).toBe(true);
    expect(surfaceAllowed(SETTINGS, "auditor", null, { "admin.settings.org": true })).toBe(false);
  });

  it("appears for a safety manager given Recruiting, though they hold no settings section", () => {
    // The directory has no section of its own to refuse them with — its screens ask their own.
    expect(callerCanView("safety_manager", "settings", null)).toBe(false);
    expect(surfaceAllowed(SETTINGS, "safety_manager", null, { "admin.recruiting": true })).toBe(true);
  });

  it("stays hidden when the only screen turned on is one the role's section cannot reach (D-SURF2)", () => {
    expect(surfaceAllowed(SETTINGS, "dispatcher", null, { "admin.settings.org": true })).toBe(false);
  });

  it("answers the role half too: a role no Settings screen's section reaches cannot reach the entry", () => {
    // `canReachSurface` is AND-ed with `surfaceAllowed` in the sidebar, so it must not say yes to the
    // entry for a role whose sections could never open anything behind it.
    expect(surfaceGateAllows(SETTINGS, "technician", null)).toBe(false);
    expect(surfaceGateAllows(SETTINGS, "safety_manager", null)).toBe(true);
    expect(surfaceGateAllows(SETTINGS, "technician", { recruitment: "view" })).toBe(true);
  });

  it("is filled from `reachedFrom` alone, so the entry and the cards are one list", () => {
    expect(SETTINGS.gate.kind).toBe("directory");
    if (SETTINGS.gate.kind === "directory")
      expect(SETTINGS.gate.screens.map((s) => s.key)).toEqual(directoryScreens("admin.settings").map((s) => s.key));
  });
});

describe("a section can open the door, but only an admin's answer walks a role through it", () => {
  it("does not grant a screen that starts off when an org widens the role's section", () => {
    const widened: SectionClaim = { settings: "manage" };
    expect(surfaceAllowed(surface("admin.settings.org"), "dispatcher", widened, null)).toBe(false);
    expect(surfaceAllowed(surface("admin.settings.audit"), "dispatcher", widened, null)).toBe(false);
    // …while a screen outside Settings still follows the section alone, as it always has.
    expect(surfaceAllowed(surface("fuel.log"), "dispatcher", { fuel: "manage" }, null)).toBe(true);
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

  it("turns the audit log on for an auditor only when the org says so (Q-SET3)", () => {
    expect(surfaceAllowed(surface("admin.settings.audit"), "auditor", null, null)).toBe(false);
    expect(surfaceAllowed(surface("admin.settings.audit"), "auditor", null, { "admin.settings.audit": true })).toBe(true);
  });

  it("starts off only editable roles: admin keeps every screen, since nobody can answer for them", () => {
    expect(surfaceStartsOn(surface("admin.settings.org"), "admin")).toBe(true);
    expect(surfaceStartsOn(surface("admin.settings.org"), "fleet_manager")).toBe(false);
    expect(surfaceStartsOn(surface("admin.settings.audit"), "auditor")).toBe(false);
    // A screen with no starting default still starts on — the rule is Settings', not everyone's.
    expect(surfaceStartsOn(surface("fuel.log"), "fleet_manager")).toBe(true);
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
