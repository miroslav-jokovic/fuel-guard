import { describe, expect, it } from "vitest";
import { FLEETPAL_UNIT_MAP, mapFleetpalUnit } from "./units.js";
import { UNITS_OF_MEASURE } from "../inventoryContract.js";

describe("mapFleetpalUnit (F12)", () => {
  it("maps the seven FleetPal words that have an exact counterpart, whatever their case or spacing", () => {
    expect(mapFleetpalUnit("ea")).toBe("each");
    expect(mapFleetpalUnit(" EA ")).toBe("each");
    expect(mapFleetpalUnit("bx")).toBe("box");
    expect(mapFleetpalUnit("gal")).toBe("gallon");
    expect(mapFleetpalUnit("ft")).toBe("foot");
    expect(mapFleetpalUnit("lb")).toBe("pound");
    expect(mapFleetpalUnit("pr")).toBe("pair");
    expect(mapFleetpalUnit("set")).toBe("set");
  });

  it("calls a near miss unmapped rather than guessing — a pack is not a box, a pint is not a quart", () => {
    for (const raw of ["pk", "pt", "oz", "disp", "cs", "m", "L", "hr", "cm"]) expect(mapFleetpalUnit(raw), raw).toBe("unmapped");
  });

  it("counts a part FleetPal records no unit for as each — null is not unmapped", () => {
    expect(mapFleetpalUnit(null)).toBe("each");
    expect(mapFleetpalUnit(undefined)).toBe("each");
    expect(mapFleetpalUnit("   ")).toBe("each");
  });

  it("only ever answers with a unit the catalogue's CHECK admits", () => {
    for (const v of Object.values(FLEETPAL_UNIT_MAP)) expect(UNITS_OF_MEASURE).toContain(v);
    expect(UNITS_OF_MEASURE).toContain("unmapped");
  });
});
