import { describe, expect, it } from "vitest";
import type { HazmatProduct } from "@fuelguard/shared";
import {
  buildCalcRequest,
  emptyForm,
  emptyLine,
  hasResolvedLine,
  parseBusinessDayIds,
  type CalcForm,
} from "./calcModel";

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

function formWith(overrides: Partial<CalcForm> = {}): CalcForm {
  return { ...emptyForm(), ...overrides };
}

describe("calcModel — form → /calc request (plan H5)", () => {
  it("drops lines without a resolved product (fail-closed at the source)", () => {
    const form = formWith();
    const req = buildCalcRequest(form);
    expect((req.load as { lines: unknown[] }).lines).toEqual([]);
  });

  it("maps a resolved line to a canonical engine line", () => {
    const line = { ...emptyLine(), product: gasoline, quantityValue: "8000", quantityUnit: "gal", packagingKind: "bulk", grossWeightLb: "50000" };
    const req = buildCalcRequest(formWith({ lines: [line] }));
    const load = req.load as { lines: Array<Record<string, unknown>>; vehicle: Record<string, unknown> };
    expect(load.lines).toHaveLength(1);
    expect(load.lines[0]!.hmtRef).toBe("UN1203-gasoline#II");
    expect(load.lines[0]!.quantity).toEqual({ value: 8000, unit: "gal" });
    expect(load.lines[0]!.grossWeightLb).toBe(50000);
    expect(load.lines[0]!.packagingKind).toBe("bulk");
  });

  it("nulls cargo-tank capacity for a non-tank vehicle", () => {
    const req = buildCalcRequest(formWith({ vehicleKind: "van_or_flatbed", cargoTankCapacityGal: "9200" }));
    expect((req.load as { vehicle: { cargoTankCapacityGal: unknown } }).vehicle.cargoTankCapacityGal).toBeNull();
  });

  it("keeps cargo-tank capacity for a tank, null when blank (conservative)", () => {
    expect((buildCalcRequest(formWith({ vehicleKind: "cargo_tank", cargoTankCapacityGal: "9200" })).load as { vehicle: { cargoTankCapacityGal: unknown } }).vehicle.cargoTankCapacityGal).toBe(9200);
    expect((buildCalcRequest(formWith({ vehicleKind: "cargo_tank", cargoTankCapacityGal: "" })).load as { vehicle: { cargoTankCapacityGal: unknown } }).vehicle.cargoTankCapacityGal).toBeNull();
  });

  it("parses business-day IDs and normalizes to null when blank", () => {
    expect(parseBusinessDayIds(" un1203 , UN1202 ")).toEqual(["UN1203", "UN1202"]);
    expect(parseBusinessDayIds("")).toBeNull();
    expect(parseBusinessDayIds("   ")).toBeNull();
  });

  it("hasResolvedLine reflects whether any line carries a product", () => {
    expect(hasResolvedLine(emptyForm())).toBe(false);
    expect(hasResolvedLine(formWith({ lines: [{ ...emptyLine(), product: gasoline }] }))).toBe(true);
  });
});
