import { describe, it, expect } from "vitest";
import { suggestIdleEquipment } from "./idleEquipment.js";

describe("suggestIdleEquipment", () => {
  it("suggests optimized idle for a modern Cascadia", () => {
    const s = suggestIdleEquipment({ make: "Freightliner", model: "Cascadia", year: 2019 });
    expect(s?.hasOptimizedIdle).toBe(true);
    expect(s?.label).toBe("Optimized idle");
  });
  it("suggests it even when the year is unknown", () => {
    expect(suggestIdleEquipment({ model: "Cascadia" })?.hasOptimizedIdle).toBe(true);
  });
  it("does not suggest for a very old Cascadia", () => {
    expect(
      suggestIdleEquipment({ make: "Freightliner", model: "Cascadia", year: 2008 }),
    ).toBeNull();
  });
  it("returns null for other trucks", () => {
    expect(suggestIdleEquipment({ make: "Ford", model: "F-450", year: 2021 })).toBeNull();
    expect(suggestIdleEquipment({})).toBeNull();
  });
});
