import { describe, expect, it } from "vitest";
import type { HazmatProduct } from "@fuelguard/shared";
import {
  buildCalcRequest,
  emptyForm,
  emptyLine,
  equipmentFromTrailerType,
  hasResolvedLine,
  linePackagingKind,
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

describe("calcModel — form → /calc request (plan H5, reworked by H-P1)", () => {
  it("drops lines without a resolved product (fail-closed at the source)", () => {
    const form = formWith();
    const req = buildCalcRequest(form);
    expect((req.load as { lines: unknown[] }).lines).toEqual([]);
  });

  it("maps a resolved tanker line to a canonical engine line (loose bulk, no package count)", () => {
    const line = { ...emptyLine("tanker"), product: gasoline, quantityValue: "8000", grossWeightValue: "50000" };
    const req = buildCalcRequest(formWith({ equipmentType: "tanker", lines: [line] }));
    const load = req.load as { lines: Array<Record<string, unknown>>; vehicle: Record<string, unknown> };
    expect(load.lines).toHaveLength(1);
    expect(load.lines[0]!.hmtRef).toBe("UN1203-gasoline#II");
    expect(load.lines[0]!.quantity).toEqual({ value: 8000, unit: "gal" });
    expect(load.lines[0]!.grossWeightLb).toBe(50000);
    expect(load.lines[0]!.packagingKind).toBe("bulk");
    expect(load.lines[0]!.packageCount).toBeNull(); // the vehicle is the packaging
    expect(load.vehicle.kind).toBe("cargo_tank");
  });

  it("derives bulk from the PACKAGE type, not the equipment: a tote on a van is bulk (§171.8)", () => {
    const line = { ...emptyLine("van"), product: gasoline, packageType: "ibc_tote", packageCount: "4" };
    const req = buildCalcRequest(formWith({ equipmentType: "van", lines: [line] }));
    const built = (req.load as { lines: Array<Record<string, unknown>> }).lines[0]!;
    expect(built.packagingKind).toBe("bulk");
    expect(built.packageCount).toBe(4);
    expect((req.load as { vehicle: { kind: string } }).vehicle.kind).toBe("van_or_flatbed");
  });

  it("drums on a van are non-bulk; unset package type falls back to the equipment default", () => {
    expect(linePackagingKind({ ...emptyLine("van"), packageType: "drum" }, "van")).toBe("non_bulk");
    expect(linePackagingKind(emptyLine("van"), "van")).toBe("non_bulk");
    // A hopper is bulk packaging even though the engine kind is van_or_flatbed (the old mapping's bug).
    expect(linePackagingKind(emptyLine("hopper"), "hopper")).toBe("bulk");
    const req = buildCalcRequest(formWith({ equipmentType: "hopper", lines: [{ ...emptyLine("hopper"), product: gasoline }] }));
    expect((req.load as { vehicle: { kind: string } }).vehicle.kind).toBe("van_or_flatbed");
    expect((req.load as { lines: Array<Record<string, unknown>> }).lines[0]!.packagingKind).toBe("bulk");
  });

  it("converts kg gross weight to lb (§172.504(c) evaluates pounds)", () => {
    const line = { ...emptyLine("van"), product: gasoline, packageType: "drum", grossWeightValue: "1000", grossWeightUnit: "kg" };
    const req = buildCalcRequest(formWith({ equipmentType: "van", lines: [line] }));
    const gross = (req.load as { lines: Array<{ grossWeightLb: number }> }).lines[0]!.grossWeightLb;
    expect(gross).toBeCloseTo(2204.62, 1);
  });

  it("nulls cargo-tank capacity for package equipment, keeps it for a tanker", () => {
    const vehicleOf = (form: CalcForm) => (buildCalcRequest(form).load as { vehicle: { cargoTankCapacityGal: unknown } }).vehicle;
    expect(vehicleOf(formWith({ equipmentType: "van", cargoTankCapacityGal: "9200" })).cargoTankCapacityGal).toBeNull();
    expect(vehicleOf(formWith({ equipmentType: "tanker", cargoTankCapacityGal: "9200" })).cargoTankCapacityGal).toBe(9200);
    expect(vehicleOf(formWith({ equipmentType: "tanker", cargoTankCapacityGal: "" })).cargoTankCapacityGal).toBeNull();
  });

  it("maps the fleet's trailer_type vocabulary onto the calculator's equipment vocabulary", () => {
    expect(equipmentFromTrailerType("tanker")).toBe("tanker");
    expect(equipmentFromTrailerType("hopper")).toBe("hopper");
    expect(equipmentFromTrailerType("dry_van")).toBe("van");
    expect(equipmentFromTrailerType("other")).toBe("");
    expect(equipmentFromTrailerType(null)).toBe("");
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
