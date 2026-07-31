import { describe, expect, it } from "vitest";
import type { HazmatProduct } from "@fuelguard/shared";
import { emptyLine } from "./calcModel";
import { buildCreateLoadRequest, emptyLoadForm, loadFormHasProduct, parseList, type LoadForm } from "./loadFormModel";

const gasoline: HazmatProduct = {
  hmtRef: "UN1203-gasoline#II",
  entryId: "UN1203-gasoline",
  idPrefix: "UN",
  idNumber: "1203",
  idLabel: "UN1203",
  psn: "Gasoline",
  hazardClass: "3",
  subsidiaryClasses: [],
  pg: "II",
  symbols: [],
  label: "UN1203 · Gasoline · Class 3 · PG II",
  isFuelCommon: true,
};

function formWith(overrides: Partial<LoadForm> = {}): LoadForm {
  return { ...emptyLoadForm(), ...overrides };
}

describe("loadFormModel — form → POST /hazmat/loads (plan H5)", () => {
  it("maps declared lines from resolved products and drops empty ones", () => {
    const form = formWith({ lines: [{ ...emptyLine(), product: gasoline, quantityValue: "8000" }, emptyLine()] });
    const req = buildCreateLoadRequest("11111111-1111-1111-1111-111111111111", form);
    expect(req.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(req.declaredLines).toHaveLength(1);
    expect((req.declaredLines[0] as { hmtRef: string }).hmtRef).toBe("UN1203-gasoline#II");
  });

  it("nulls empty vehicle/trailer/driver and passes context + set equipment through", () => {
    const req = buildCreateLoadRequest("id", formWith({ vehicleId: "", trailerId: "t1", driverId: "d1", tankState: "residue_uncleaned", carrierRelationship: "private_carrier" }));
    expect(req.vehicleId).toBeNull();
    expect(req.trailerId).toBe("t1");
    expect(req.driverId).toBe("d1");
    expect(req.tankState).toBe("residue_uncleaned");
    expect(req.carrierRelationship).toBe("private_carrier");
    expect(req.supersedesLoadId).toBeNull();
    // both empty → both null
    expect(buildCreateLoadRequest("id", formWith({ vehicleId: "", trailerId: "" })).trailerId).toBeNull();
  });

  it("parses special-permit lists and ISO-normalizes planned pickup", () => {
    const req = buildCreateLoadRequest("id", formWith({ specialPermitNumbers: "DOT-SP 12345, SP-20800", plannedPickupAt: "2026-08-01T09:30" }));
    expect(req.specialPermitNumbers).toEqual(["DOT-SP 12345", "SP-20800"]);
    expect(typeof req.plannedPickupAt).toBe("string");
    expect(req.plannedPickupAt).toContain("2026-08-01");
  });

  it("leaves planned pickup null when blank", () => {
    expect(buildCreateLoadRequest("id", formWith({ plannedPickupAt: "" })).plannedPickupAt).toBeNull();
  });

  it("parseList + loadFormHasProduct helpers", () => {
    expect(parseList(" a , b c ")).toEqual(["a", "b c"]);
    expect(parseList("")).toEqual([]);
    expect(loadFormHasProduct(emptyLoadForm())).toBe(false);
    expect(loadFormHasProduct(formWith({ lines: [{ ...emptyLine(), product: gasoline }] }))).toBe(true);
  });
});
