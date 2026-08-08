import { describe, expect, it } from "vitest";
import type { ModuleSet } from "@fuelguard/shared";
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
    expect(safety?.items.find((i) => i.name === "HazmatGuard")?.badge).toBe(3);
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
