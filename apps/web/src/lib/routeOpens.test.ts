import { describe, expect, it } from "vitest";
import { routeOpens, type RouteCaller } from "./routeOpens";

/**
 * `routeOpens` is the router guard's decision and every link's (SP5, plan §4b). These pin it on the
 * DECLARED path, which is what the guard hands it; resolving a URL to that path is `useOpens`'s job
 * and is pinned in `useOpens.test.ts`.
 */
const as = (role: RouteCaller["role"], extra: Partial<RouteCaller> = {}): RouteCaller => ({
  role,
  admin: role === "admin",
  sections: null,
  surfaces: null,
  ...extra,
});

describe("routeOpens", () => {
  it("opens /settings to the admin and closes it to a fleet manager with nothing turned on", () => {
    expect(routeOpens("/settings", {}, as("admin"))).toBe(true);
    expect(routeOpens("/settings", {}, as("fleet_manager"))).toBe(false);
  });

  it("opens /settings to a fleet manager once one screen behind it is turned on", () => {
    expect(routeOpens("/settings", {}, as("fleet_manager", { surfaces: { "admin.settings.org": true } }))).toBe(true);
  });

  it("judges a detail route by its declared path and its parent's screen", () => {
    expect(routeOpens("/vehicles/:id", {}, as("fleet_manager"))).toBe(true);
    // D-SURF8: switching Vehicles off for one person also shuts the vehicle a link points at.
    expect(routeOpens("/vehicles/:id", {}, as("fleet_manager", { surfaces: { "fleet.vehicles": false } }))).toBe(false);
  });

  it("reads the org's section claim, not the shipped matrix", () => {
    // A dispatcher holds `recruitment: none` as shipped; the org granting it opens the board.
    expect(routeOpens("/recruitment", {}, as("dispatcher"))).toBe(false);
    expect(routeOpens("/recruitment", {}, as("dispatcher", { sections: { recruitment: "view" } }))).toBe(true);
    // And narrowing a section the shipped matrix gives closes it.
    expect(routeOpens("/vehicles", {}, as("fleet_manager", { sections: { equipment: "none" } }))).toBe(false);
  });

  it("refuses a requiresAdmin route to anybody but the admin, whatever the catalogue says", () => {
    expect(routeOpens("/not-in-the-catalogue", { requiresAdmin: true }, as("fleet_manager"))).toBe(false);
    expect(routeOpens("/not-in-the-catalogue", { requiresAdmin: true }, as("admin"))).toBe(true);
  });

  it("opens an uncatalogued route, exactly as the guard always has", () => {
    expect(routeOpens("/not-in-the-catalogue", {}, as("technician"))).toBe(true);
  });
});
