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
  /**
   * D-H15 (owner, 2026-08-30) replaces H-C4's single hub entry with two. H-C4 cut FIVE items to one
   * because four duplicated Loads, Trailers and Compliance — that reasoning retires the duplicates,
   * not the surfaces. What must stay dead is the DUPLICATION: no hazmat loads board, no cargo-tank
   * page, and no hub in between.
   */
  it("shows exactly two hazmat entries, and never the surfaces that duplicate Loads or Trailers", () => {
    const safety = buildNavGroups("admin", withHazmat, { hazmatReview: 3 }).find((g) => g.label === "Safety");
    const names = safety?.items.map((i) => i.name) ?? [];
    expect(names).toContain("Placard calculator");
    expect(names).toContain("Hazmat review");
    for (const gone of ["HazmatGuard", "Hazmat Loads", "Cargo-Tank Profiles", "Tank Equipment"]) {
      expect(names).not.toContain(gone);
    }
  });

  it("puts the review badge on the review queue, where it means something", () => {
    const safety = buildNavGroups("admin", withHazmat, { hazmatReview: 3 }).find((g) => g.label === "Safety");
    const review = safety?.items.find((i) => i.name === "Hazmat review");
    const calculator = safety?.items.find((i) => i.name === "Placard calculator");
    expect(review?.badge).toBe(3);
    expect(review?.icon).toBe(ShieldExclamationIcon);
    // A count of pending reviews on an item that opens a calculator would be a lie.
    expect(calculator?.badge).toBeUndefined();
    expect(calculator?.icon).toBe(HazmatPlacardIcon);
  });

  it("hides both hazmat entries without the module entitlement", () => {
    const safety = buildNavGroups("admin", null).find((g) => g.label === "Safety");
    const names = safety?.items.map((i) => i.name) ?? [];
    expect(names).not.toContain("Placard calculator");
    expect(names).not.toContain("Hazmat review");
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

/**
 * A SECTION icon renders only in the COLLAPSED RAIL (`SidebarFlyoutSection`'s trigger), where there
 * are no labels at all — so two sections sharing a glyph are two wordless, identical buttons stacked
 * on each other. Maintenance and Admin both wore `Cog6ToothIcon` and did exactly that.
 *
 * This is the same failure U5/D-UI6 fixed for nav ITEMS, one level up and with worse consequences,
 * because an item at least has its label beside it.
 */
describe("the collapsed rail can tell its sections apart", () => {
  it("gives every labelled section its own glyph", () => {
    const groups = buildNavGroups("admin", new Set(["hazmatguard", "dispatch", "messages"]) as never);
    const sections = groups.filter((g) => g.label != null);
    const icons = sections.map((g) => g.icon);
    expect(icons.every((i) => i != null)).toBe(true);
    expect(new Set(icons).size).toBe(sections.length);
  });

  it("keeps the cog for Admin, whose child Settings is the one thing a cog really means", () => {
    const groups = buildNavGroups("admin", new Set(["hazmatguard", "dispatch"]) as never);
    const admin = groups.find((g) => g.label === "Admin");
    const maintenance = groups.find((g) => g.label === "Maintenance");
    expect(admin?.icon).not.toBe(maintenance?.icon);
    expect(admin?.items.find((i) => i.name === "Settings")?.icon).toBe(admin?.icon);
  });
});
