import { describe, it, expect } from "vitest";
import { VEHICLE_SECTIONS, resolveVehicleSection } from "./vehicleSections";

/**
 * The truck page's `?section=` vocabulary (UNIT-FILES-PLAN UF5), pinned the way the driver page's is:
 * it is a public surface — the Vehicles list's File cell and a binder reference link into it — so
 * every value resolves to itself, anything else lands on the overview, and every section has a label.
 */
describe("vehicleSections", () => {
  it("resolves every section to itself, in the order the page shows them", () => {
    for (const { value } of VEHICLE_SECTIONS) expect(resolveVehicleSection(value)).toBe(value);
    expect(VEHICLE_SECTIONS.map((s) => s.value)).toEqual(["overview", "file", "maintenance", "fuel"]);
  });

  it("lands an unknown, empty or missing section on the overview rather than nowhere", () => {
    for (const raw of ["", "banana", undefined, null, 42, "FILE"]) expect(resolveVehicleSection(raw)).toBe("overview");
  });

  it("gives every section a label, so no tab renders blank", () => {
    for (const s of VEHICLE_SECTIONS) expect(s.label.trim().length).toBeGreaterThan(0);
  });
});
