import { describe, expect, it } from "vitest";
import { EDITABLE_ROLES } from "./auth.js";
import { surfaceAllowed } from "./surfaces.js";
import { NAV_SURFACES, SURFACES } from "./surfaceCatalogue.js";

/**
 * Tier C is hidden until each screen has a named first user (Q-PR2, owner's ruling 2026-10-06:
 * "hide; retire nothing"; F02-F04 PLAN.md chunk 2). Hazmat, Messages and Ask AI here.
 *
 * What can be wrong:
 *
 *  - A SCREEN COMES BACK BY ACCIDENT. Deleting one `startsOnFor: []` puts the screen back in every
 *    role's sidebar on the next deploy, and nothing else would notice. The keys are written out here
 *    on purpose — they are the ruling, not a fact the catalogue can derive.
 *  - A DETAIL PAGE STAYS OPEN. A child answers to its parent's key (D-SURF8) but used to start ON
 *    whatever its parent did, so `/hazmat/loads/:id` would have opened after Hazmat review was
 *    hidden. The children are DERIVED from `parent`, so a detail added later is held to this.
 *  - THE ADMIN LOSES IT, OR A GRANT CANNOT BRING IT BACK. The ruling hides; it does not lock.
 *
 * Inventory and driver-app duty are in the ruling too and are not here yet: the plan's chunk 2
 * records why each waits on the owner.
 */
const TIER_C = ["ask-ai", "safety.placard-calculator", "safety.hazmat-review", "dispatch.messages"] as const;

const surface = (key: string) => SURFACES.find((s) => s.key === key)!;
const CHILDREN = SURFACES.filter((s) => s.parent && (TIER_C as readonly string[]).includes(s.parent));
const ALL = [...TIER_C.map(surface), ...CHILDREN];

describe("Tier C starts hidden for every role but the admin (Q-PR2)", () => {
  it("names real sidebar screens and their detail pages, so the cases below are not vacuous", () => {
    for (const key of TIER_C) expect(NAV_SURFACES.map((s) => s.key)).toContain(key);
    expect(CHILDREN.map((s) => s.key)).toEqual(["safety.hazmat-load.detail"]);
  });

  for (const s of ALL) {
    it(`${s.key} is closed to every editable role as shipped`, () => {
      for (const role of EDITABLE_ROLES) expect(surfaceAllowed(s, role, null, null), role).toBe(false);
    });

    it(`${s.key} still opens for the admin`, () => {
      expect(surfaceAllowed(s, "admin", null, null)).toBe(true);
    });
  }

  it("an admin's grant to a role turns a screen and its detail page back on", () => {
    const grant = { "safety.hazmat-review": true };
    expect(surfaceAllowed(surface("safety.hazmat-review"), "dispatcher", null, grant)).toBe(true);
    expect(surfaceAllowed(surface("safety.hazmat-load.detail"), "dispatcher", null, grant)).toBe(true);
  });

  it("a grant does not lift a role past its section (D-SURF2)", () => {
    // A recruiter holds `dispatch: none`; turning Messages on for them must not open it.
    expect(surfaceAllowed(surface("dispatch.messages"), "recruiter", null, { "dispatch.messages": true })).toBe(false);
  });

  it("a detail page under a screen that was not hidden still starts on", () => {
    expect(surfaceAllowed(surface("dispatch.loads.detail"), "dispatcher", null, null)).toBe(true);
  });
});

/**
 * The unused fuel tools (Q-F4, owner's ruling 2026-10-06: hidden for every role but admin, nothing
 * retired; F02-F04 PLAN.md chunk 13).
 *
 * Nothing in the catalogue changed for this ruling: Q-SET2 had already started every Settings screen
 * off a week earlier, and `settingsSurfaces.test.ts` iterates that directory. That is exactly why the
 * five are written out here. If Q-SET2 is relaxed later — say the reports block is opened to the
 * fleet manager again — that test is edited on purpose, and without this block Q-F4 would go with it
 * silently. Production stored no answer for any of the five keys when this was written (2026-10-09).
 */
const UNUSED_TOOLS = [
  "admin.recall-audit",
  "admin.settings.card-control",
  "admin.settings.thresholds",
  "admin.coverage",
  "admin.reefer-coverage",
] as const;

describe("the unused fuel tools start hidden for every role but the admin (Q-F4)", () => {
  it("names real screens, so the cases below are not vacuous", () => {
    for (const key of UNUSED_TOOLS) expect(SURFACES.map((s) => s.key)).toContain(key);
  });

  for (const key of UNUSED_TOOLS) {
    it(`${key} is closed to every editable role as shipped, and opens for the admin`, () => {
      for (const role of EDITABLE_ROLES) expect(surfaceAllowed(surface(key), role, null, null), role).toBe(false);
      expect(surfaceAllowed(surface(key), "admin", null, null)).toBe(true);
    });
  }

  it("an admin's grant brings a tool back for a role whose section reaches it", () => {
    // Written out, not filtered on `gate.kind`: a filter would quietly drop a tool that became
    // admin-locked, which is the retirement the ruling forbids. `admin.settings.thresholds` asks
    // `settings: manage`, which the fleet manager holds as shipped.
    for (const key of UNUSED_TOOLS.filter((k) => k !== "admin.settings.card-control")) {
      expect(surfaceAllowed(surface(key), "fleet_manager", null, { [key]: true }), key).toBe(true);
    }
  });

  it("Card control stays the admin's even when a role is granted it (Q-SET1)", () => {
    const key = "admin.settings.card-control";
    expect(surfaceAllowed(surface(key), "fleet_manager", null, { [key]: true })).toBe(false);
  });
});
