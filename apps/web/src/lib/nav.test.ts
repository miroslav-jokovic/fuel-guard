import { describe, expect, it } from "vitest";
import type { ModuleSet } from "@silvicom/shared";
import {
  BuildingOffice2Icon,
  HazmatPlacardIcon,
  LicenseIcon,
  ShieldExclamationIcon,
  UserListIcon,
} from "@silvicom/ui/icons";
import { buildNavGroups } from "./nav";

const withHazmat = new Set(["hazmatguard"]) as unknown as ModuleSet;

describe("buildNavGroups", () => {
  it("shows ONE hazmat entry — the HazmatGuard hub — never the sub-pages (H-C4)", () => {
    const safety = buildNavGroups("admin", withHazmat, { hazmatReview: 3 }).find((g) => g.label === "Safety");
    const names = safety?.items.map((i) => i.name) ?? [];
    expect(names).toContain("HazmatGuard");
    for (const gone of ["Placard Calculator", "Hazmat Loads", "Hazmat Review", "Cargo-Tank Profiles"]) {
      expect(names).not.toContain(gone);
    }
    // The review badge rides on the hub now.
    const hazmat = safety?.items.find((i) => i.name === "HazmatGuard");
    expect(hazmat?.badge).toBe(3);
    expect(hazmat?.icon).toBe(HazmatPlacardIcon);
    expect(hazmat?.icon).not.toBe(ShieldExclamationIcon);
  });

  it("hides HazmatGuard entirely without the module entitlement", () => {
    const safety = buildNavGroups("admin", null).find((g) => g.label === "Safety");
    expect(safety?.items.map((i) => i.name)).not.toContain("HazmatGuard");
  });

  it("places Driver Qualification in Safety without duplicating it in Fleet", () => {
    const groups = buildNavGroups("admin", null);
    const safety = groups.find((group) => group.label === "Safety");
    const fleet = groups.find((group) => group.label === "Fleet");

    expect(safety?.items.map((item) => item.name)).toContain("Driver Qualification");
    expect(fleet?.items.map((item) => item.name)).not.toContain("Driver Qualification");
  });

  it("preserves the existing Fleet permission gate for Driver Qualification", () => {
    const dispatcherSafety = buildNavGroups("dispatcher", null).find((group) => group.label === "Safety");
    const driverSafety = buildNavGroups("driver", null).find((group) => group.label === "Safety");

    expect(dispatcherSafety?.items.map((item) => item.name)).toEqual(["Driver Qualification"]);
    expect(driverSafety).toBeUndefined();
  });
});

describe("fuel cards", () => {
  it("shows Cards to every role that can VIEW the fuel section", () => {
    for (const role of ["admin", "fleet_manager", "dispatcher", "safety_manager", "auditor"] as const) {
      const fuel = buildNavGroups(role, null).find((g) => g.label === "Fuel");
      expect(fuel?.items.filter((i) => i.show).map((i) => i.name)).toContain("Cards");
    }
  });

  it("hides Cards from a driver", () => {
    // The card inventory is a fraud-detection surface; a driver reading it is reading about themselves.
    const fuel = buildNavGroups("driver", null).find((g) => g.label === "Fuel");
    expect(fuel?.items.filter((i) => i.show).map((i) => i.name) ?? []).not.toContain("Cards");
  });

  it("needs no module entitlement — card control is not a separate product", () => {
    // It is what the EFS integration the customer already pays for does once EFS allows it.
    const fuel = buildNavGroups("admin", null).find((g) => g.label === "Fuel");
    expect(fuel?.items.find((i) => i.name === "Cards")?.show).toBe(true);
  });
});

/**
 * U1/D-UI1 — the two recruitment sub-pages, and the glyph rule that made them findable.
 *
 * Both routes were registered on 2026-08-20 to close a P0b incident (the URLs fell through to
 * nothing) and then had no nav entry for a day, so they were reachable only from two buttons on the
 * Applicants page. The first test below is the half a route record cannot assert.
 */
describe("recruitment is navigable, not just routed", () => {
  it("publishes all three recruitment surfaces to a recruiter", () => {
    const group = buildNavGroups("recruiter", null).find((g) => g.label === "Recruitment");
    expect(group?.items.map((i) => i.to)).toEqual([
      "/recruitment",
      "/recruitment/screening",
      "/recruitment/inquiries",
    ]);
  });

  it("shows a driver none of it", () => {
    expect(buildNavGroups("driver", null).find((g) => g.label === "Recruitment")).toBeUndefined();
  });

  /**
   * U5/D-UI6 — broadened from U1's recruitment-only version once the collisions were actually fixed.
   *
   * ⚠ The rule is **no two ITEMS share a glyph**. Assignments and Driver Qualification did: one glyph
   * on two unrelated items in two different sections, both on screen at once in an expanded sidebar.
   * A defect a person only notices by looking, and never notices while reading a diff — which is
   * exactly the kind a test should hold instead.
   *
   * Section icons are deliberately OUT of scope: `MapIcon` marks the Dispatch section and Fuel
   * Planning, `Cog6ToothIcon` marks Admin and Settings. A section glyph reappearing on a member is a
   * hierarchy reading correctly, not two things wearing one face.
   */
  it("gives every nav ITEM a glyph no other item wears", () => {
    const items = buildNavGroups("admin", new Set(["hazmatguard", "dispatch", "messages"]) as never).flatMap(
      (g) => g.items,
    );
    const byIcon = new Map<unknown, string[]>();
    for (const item of items) byIcon.set(item.icon, [...(byIcon.get(item.icon) ?? []), item.name]);

    const collisions = [...byIcon.values()].filter((names) => names.length > 1);
    expect(collisions).toEqual([]);
  });

  it("gives the recruitment items glyphs that say what they are", () => {
    const items = buildNavGroups("admin", null).flatMap((g) => g.items);
    const applicants = items.find((i) => i.to === "/recruitment");
    // ⚠ It rendered Building02Icon — a building, for the person applying.
    expect(applicants?.icon).toBe(UserListIcon);
    expect(applicants?.icon).not.toBe(BuildingOffice2Icon);

    const qualification = items.find((i) => i.to === "/compliance");
    expect(qualification?.icon).toBe(LicenseIcon);
    expect(qualification?.icon).not.toBe(items.find((i) => i.to === "/assignments")?.icon);
  });
});
