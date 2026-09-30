import { describe, expect, it } from "vitest";
import { pathOpens } from "./nav";

/**
 * The account menu's Settings link reads `pathOpens("/settings", …)`. It must say what the guard
 * says, which since 2026-09-30 is "the admin, or a role with a Settings screen turned on" — not
 * `can("settings")`, which says yes to a fleet manager the guard sends away.
 */
describe("pathOpens", () => {
  it("opens /settings to the admin and closes it to a fleet manager with nothing turned on", () => {
    expect(pathOpens("/settings", "admin", null, null)).toBe(true);
    expect(pathOpens("/settings", "fleet_manager", null, null)).toBe(false);
  });

  it("opens /settings to a fleet manager once one screen behind it is turned on", () => {
    expect(pathOpens("/settings", "fleet_manager", null, { "admin.settings.org": true })).toBe(true);
  });

  it("answers false for a path the catalogue does not know, rather than guessing", () => {
    expect(pathOpens("/nowhere", "admin", null, null)).toBe(false);
  });
});
