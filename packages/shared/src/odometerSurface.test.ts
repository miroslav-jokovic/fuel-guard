import { describe, expect, it } from "vitest";
import { USER_ROLES } from "./constants.js";
import { sectionAccess } from "./auth.js";
import { surfaceAllowed } from "./surfaces.js";
import { SURFACES } from "./surfaceCatalogue.js";

/**
 * The Odometer screen is gated by the fuel section, because its rows are fuel fills (database audit
 * 2026-10-03, finding 1; owner's ruling the same day).
 *
 * What can be wrong:
 *
 *  - IT WAS GATED ON THE WRONG QUESTION. `fleet.odometer` asked for `equipment: view`, which a technician
 *    holds, for a page whose rows come from `fuel_transactions` and carry the driver's name. A matrix over
 *    the catalogue cannot see that, because every entry passes a gate that merely EXISTS. The case below
 *    asserts the gate's answer for EVERY role against the shared section matrix, so it is derived from
 *    `SECTION_ACCESS` and a role added later is covered without anyone editing this file.
 *  - THE OLD GATE'S ROLES MUST NOT SURVIVE BY ACCIDENT. A role with equipment but not fuel (technician) is
 *    named and asserted refused, and one with fuel but not equipment (accountant) asserted admitted: those
 *    two are the whole change, and a regression that restored the equipment gate would still pass every
 *    case that only looks at roles holding both.
 *  - AN ORG'S `true` MUST NOT LIFT A ROLE PAST THE SECTION (D-SURF2), AND A STORED `false` STILL NARROWS.
 *    Production holds two `false` answers for this key; they keep their effect under the new gate.
 */
const odometer = SURFACES.find((s) => s.key === "fleet.odometer")!;
const OFFICE_ROLES = USER_ROLES.filter((r) => r !== "driver");

describe("the Odometer screen follows the fuel section", () => {
  it("exists in the catalogue and is gated by a section, so the cases below are not vacuous", () => {
    expect(odometer).toBeDefined();
    expect(odometer.gate).toEqual({ kind: "section", section: "fuel", level: "view" });
  });

  for (const role of OFFICE_ROLES) {
    const fuel = sectionAccess(role, "fuel");
    it(`${role} (fuel ${fuel}) ${fuel === "none" ? "cannot" : "can"} open it as shipped`, () => {
      expect(surfaceAllowed(odometer, role, null, null)).toBe(fuel !== "none");
    });
  }

  it("a technician — equipment view, fuel none — can no longer open it", () => {
    expect(sectionAccess("technician", "equipment")).not.toBe("none");
    expect(sectionAccess("technician", "fuel")).toBe("none");
    expect(surfaceAllowed(odometer, "technician", null, null)).toBe(false);
  });

  it("an accountant — fuel view, equipment none — can open it", () => {
    expect(sectionAccess("accountant", "equipment")).toBe("none");
    expect(sectionAccess("accountant", "fuel")).not.toBe("none");
    expect(surfaceAllowed(odometer, "accountant", null, null)).toBe(true);
  });

  it("an org's `true` for a role without fuel does not lift it past the section (D-SURF2)", () => {
    expect(surfaceAllowed(odometer, "technician", null, { "fleet.odometer": true })).toBe(false);
  });

  it("an org's `false` still narrows a role that holds fuel (the two stored production answers)", () => {
    expect(surfaceAllowed(odometer, "dispatcher", null, { "fleet.odometer": false })).toBe(false);
    expect(surfaceAllowed(odometer, "dispatcher", null, {})).toBe(true);
  });

  it("an org that revokes fuel from a role takes the screen with it", () => {
    expect(surfaceAllowed(odometer, "dispatcher", { fuel: "none" }, null)).toBe(false);
  });
});
