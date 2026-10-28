import { describe, expect, it } from "vitest";
import { NAV_SURFACES } from "@silvicom/shared";
import { buildNavGroups } from "./nav";
import { isPhoneFirst, phoneTabFor, phoneTabs } from "./phoneFirst";

/**
 * The shop's phone-first answers (DESIGN-SYSTEM-CONTRACT.md §9 rules 1 and 7). Every one is read from
 * the surface catalogue, so these pin that the reading is right rather than restating the rows.
 */
describe("which pages are phone-first", () => {
  it("is every shop screen, a detail page and a child included, and nothing outside the section", () => {
    for (const path of ["/shop", "/shop/units", "/shop/units/:kind/:id", "/shop/scan", "/shop/labels", "/shop/inspections/:id"])
      expect(isPhoneFirst(path), path).toBe(true);
    // "Who can inspect" is gated on maintenance but lives in Settings, at a desk.
    for (const path of ["/vehicles", "/settings/inspectors", "/settings/devices", "/"]) expect(isPhoneFirst(path), path).toBe(false);
  });
});

describe("the shop's tab row", () => {
  const groups = buildNavGroups("admin", null);

  it("is the section's own sidebar rows, in sidebar order, and never a child screen", () => {
    const tabs = phoneTabs("/shop/units", groups);
    const sidebar = NAV_SURFACES.filter((s) => s.group === "maintenance").map((s) => s.label);
    expect(tabs?.items.map((i) => i.name)).toEqual(sidebar);
    // Labels needs a printer: a desk child screen, not a door (rules 6, 7). Equipment is a door again
    // since M7 (Q-MX7): Shop · Trucks & trailers · Equipment · Annual inspections · Parts.
    expect(tabs?.items.map((i) => i.name)).not.toContain("Labels");
    expect(tabs?.items.map((i) => i.name)).toEqual(["Shop", "Trucks & trailers", "Equipment", "Annual inspections", "Parts"]);
  });

  it("is drawn under the shop only", () => {
    expect(phoneTabs("/shop/units/:kind/:id", groups)).not.toBeNull();
    expect(phoneTabs("/vehicles", groups)).toBeNull();
    expect(phoneTabs("/settings/inspectors", groups)).toBeNull();
  });

  it("is not drawn for a role with no maintenance section, nor for one left with a single door", () => {
    expect(phoneTabs("/shop", buildNavGroups("recruiter", null))).toBeNull();
    const one = groups.map((g) => (g.key === "maintenance" ? { ...g, items: g.items.slice(0, 1) } : g));
    expect(phoneTabs("/shop", one)).toBeNull();
  });

  it("marks the tab a page stands under by its catalogue parent, not by its path", () => {
    expect(phoneTabFor("/shop/units")).toBe("/shop/units");
    expect(phoneTabFor("/shop/units/:kind/:id")).toBe("/shop/units");
    // Equipment is its own door (M7); one item lights it, a path prefix would light Shop.
    expect(phoneTabFor("/shop/assets")).toBe("/shop/assets");
    expect(phoneTabFor("/shop/assets/:id")).toBe("/shop/assets");
    expect(phoneTabFor("/shop/scan")).toBe("/shop");
    expect(phoneTabFor("/shop/inspections/:id")).toBe("/shop/inspections");
  });
});
