import { describe, expect, it } from "vitest";
import { buildNavGroups } from "./nav";

describe("buildNavGroups", () => {
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
