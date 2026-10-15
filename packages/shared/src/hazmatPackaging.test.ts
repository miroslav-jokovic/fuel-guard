import { describe, expect, it } from "vitest";
import {
  capacityFromForm,
  classifyByCapacity,
  derivePackaging,
  packageTypeFromPrinted,
  packagingKindFor,
  phaseForHazardClass,
  weightToLb,
  L_PER_GAL,
} from "./hazmatPackaging.js";

/**
 * D-H14 — the §171.8 capacity classifier. Thresholds verified against the eCFR text and PHMSA
 * interpretations 19-0045 / 10-0055 (research 2026-08-08): liquids > 450 L; solids > 400 kg AND
 * > 450 L (two-part); gases > 454 kg water capacity, METRIC governing.
 */
describe("phaseForHazardClass", () => {
  it("Class 2 (all divisions) → gas; everything else → liquid (the conservative default)", () => {
    expect(phaseForHazardClass("2.1")).toBe("gas");
    expect(phaseForHazardClass("2.2")).toBe("gas");
    expect(phaseForHazardClass("2.3")).toBe("gas");
    expect(phaseForHazardClass("2")).toBe("gas");
    expect(phaseForHazardClass("3")).toBe("liquid");
    expect(phaseForHazardClass("8")).toBe("liquid");
    expect(phaseForHazardClass("5.1")).toBe("liquid");
    expect(phaseForHazardClass(null)).toBe("liquid");
    // "2.1" must not be confused with classes that merely contain a 2
    expect(phaseForHazardClass("4.2")).toBe("liquid");
  });
});

describe("classifyByCapacity — liquids (§171.8(1): > 450 L)", () => {
  it("55-gal drum is non-bulk; 130-gal oversized drum is bulk; 119 gal sits exactly at the line (non-bulk)", () => {
    expect(classifyByCapacity("liquid", { volumeL: 55 * L_PER_GAL })?.kind).toBe("non_bulk");
    expect(classifyByCapacity("liquid", { volumeL: 130 * L_PER_GAL })?.kind).toBe("bulk");
    expect(classifyByCapacity("liquid", { volumeL: 450 })?.kind).toBe("non_bulk"); // "greater than", not "at least"
    expect(classifyByCapacity("liquid", { volumeL: 450.01 })?.kind).toBe("bulk");
  });

  it("no volume → null (caller falls back to the type default)", () => {
    expect(classifyByCapacity("liquid", {})).toBeNull();
    expect(classifyByCapacity("liquid", { waterCapacityKg: 500 })).toBeNull();
  });
});

describe("classifyByCapacity — gases (§171.8(3): > 454 kg water capacity, metric governs)", () => {
  it("the 420-lb propane cylinder (1,000 lb WC) is NON-bulk — PHMSA 19-0045's exact case", () => {
    const c = classifyByCapacity("gas", capacityFromForm(1000, "lb")!);
    expect(c?.kind).toBe("non_bulk"); // 1,000 lb = 453.59 kg ≤ 454 kg
  });

  it("every consumer size below it is non-bulk; a 500-gal ASME tank is decisively bulk", () => {
    expect(classifyByCapacity("gas", capacityFromForm(48, "lb")!)?.kind).toBe("non_bulk"); // 20-lb grill bottle ≈ 48 lb WC
    expect(classifyByCapacity("gas", capacityFromForm(239, "lb")!)?.kind).toBe("non_bulk"); // 100-lb cylinder
    expect(classifyByCapacity("gas", capacityFromForm(500, "gal")!)?.kind).toBe("bulk"); // ≈1,893 kg water
    expect(classifyByCapacity("gas", { waterCapacityKg: 454 })?.kind).toBe("non_bulk"); // exactly 454 kg — "greater than"
    expect(classifyByCapacity("gas", { waterCapacityKg: 454.1 })?.kind).toBe("bulk");
  });

  it("volume-stated water capacity converts via 1 L = 1 kg", () => {
    expect(classifyByCapacity("gas", { volumeL: 400 })?.kind).toBe("non_bulk");
    expect(classifyByCapacity("gas", { volumeL: 455 })?.kind).toBe("bulk");
  });
});

describe("classifyByCapacity — solids (§171.8(2): the TWO-part test)", () => {
  it("heavy but compact stays NON-bulk: 1,500 lb super-sack under 119 gal fails the volume half", () => {
    const c = classifyByCapacity("solid", { volumeL: 400, netMassKg: 680 });
    expect(c?.kind).toBe("non_bulk");
  });

  it("big but light stays NON-bulk: 500 L of 300 kg product fails the mass half", () => {
    expect(classifyByCapacity("solid", { volumeL: 500, netMassKg: 300 })?.kind).toBe("non_bulk");
  });

  it("both halves exceeded → bulk; volume over with UNKNOWN mass → bulk conservatively (D2)", () => {
    expect(classifyByCapacity("solid", { volumeL: 500, netMassKg: 450 })?.kind).toBe("bulk");
    const conservative = classifyByCapacity("solid", { volumeL: 500 });
    expect(conservative?.kind).toBe("bulk");
    expect(conservative?.because).toContain("conservatively");
  });
});

describe("derivePackaging — measured capacity beats the type default, visibly", () => {
  it("a 'drum' at 130 gal flips to bulk with overrodeType flagged", () => {
    const d = derivePackaging({ packageType: "drum", phase: "liquid", capacity: { volumeL: 130 * L_PER_GAL } });
    expect(d.kind).toBe("bulk");
    expect(d.source).toBe("capacity");
    expect(d.overrodeType).toBe(true);
  });

  it("a 'cylinder' at 4,170 lb WC (500-gal ASME entered as cylinder) flips to bulk — the D-H14 gap closed", () => {
    const d = derivePackaging({ packageType: "cylinder", phase: "gas", capacity: capacityFromForm(4170, "lb") });
    expect(d.kind).toBe("bulk");
    expect(d.overrodeType).toBe(true);
  });

  it("no capacity → the type default, unflagged; new bulk types default bulk", () => {
    expect(derivePackaging({ packageType: "drum", phase: "liquid" })).toMatchObject({ kind: "non_bulk", source: "type", overrodeType: false });
    expect(packagingKindFor("asme_tank")).toBe("bulk");
    expect(packagingKindFor("tube_trailer")).toBe("bulk");
  });

  it("no capacity and no known type → bulk (source none) — the conservative floor", () => {
    expect(derivePackaging({ packageType: "", phase: "liquid" })).toMatchObject({ kind: "bulk", source: "none" });
  });
});

describe("form plumbing", () => {
  it("capacityFromForm maps units; junk yields null", () => {
    expect(capacityFromForm(119, "gal")?.volumeL).toBeCloseTo(450.46, 1);
    expect(capacityFromForm(1000, "lb")?.waterCapacityKg).toBeCloseTo(453.59, 1);
    expect(capacityFromForm(454, "kg")?.waterCapacityKg).toBe(454);
    expect(capacityFromForm(null, "gal")).toBeNull();
    expect(capacityFromForm(0, "gal")).toBeNull();
    expect(capacityFromForm(5, "furlongs")).toBeNull();
  });

  it("weightToLb converts kg and passes lb through; volumes refuse", () => {
    expect(weightToLb(1000, "kg")).toBeCloseTo(2204.62, 1);
    expect(weightToLb(500, "lb")).toBe(500);
    expect(weightToLb(500, "gal")).toBeNull();
  });
});

describe("packageTypeFromPrinted — the one reading of a printed packaging phrase", () => {
  it("reads each package type from how real papers print it, plurals included", () => {
    expect(packageTypeFromPrinted("10 DRUMS")).toBe("drum");
    expect(packageTypeFromPrinted("4 TOTES")).toBe("ibc_tote");
    expect(packageTypeFromPrinted("2 IBC")).toBe("ibc_tote");
    expect(packageTypeFromPrinted("1 cargo tank")).toBe("bulk_cargo");
    expect(packageTypeFromPrinted("Bulk")).toBe("bulk_cargo");
    expect(packageTypeFromPrinted("1 ISO tank")).toBe("portable_tank");
    expect(packageTypeFromPrinted("1 tank")).toBe("other_bulk");
    expect(packageTypeFromPrinted("6 pails")).toBe("pail");
    expect(packageTypeFromPrinted("12 cylinders")).toBe("cylinder");
    expect(packageTypeFromPrinted("40 CASES")).toBe("box");
    expect(packageTypeFromPrinted("20 bags")).toBe("bag");
    expect(packageTypeFromPrinted("3 packages")).toBe("other_non_bulk");
  });

  it("reads the short codes shipper systems print in the package column, each only as a whole word", () => {
    expect(packageTypeFromPrinted("6 DR")).toBe("drum");
    expect(packageTypeFromPrinted("10 DRS")).toBe("drum");
    expect(packageTypeFromPrinted("4 DRM")).toBe("drum");
    expect(packageTypeFromPrinted("40 CTN")).toBe("box");
    expect(packageTypeFromPrinted("12 CS")).toBe("box");
    expect(packageTypeFromPrinted("3 BX")).toBe("box");
    expect(packageTypeFromPrinted("36 SACKS")).toBe("bag");
    expect(packageTypeFromPrinted("20 BG")).toBe("bag");
    expect(packageTypeFromPrinted("2 CYL")).toBe("cylinder");
    expect(packageTypeFromPrinted("48 Non-Removable Head Plastic Jerrican")).toBe("pail");
    expect(packageTypeFromPrinted("6 DRY")).toBe("");
    expect(packageTypeFromPrinted("12 PL")).toBe("");
    expect(packageTypeFromPrinted("1 IBC of 6 DR")).toBe("ibc_tote");
  });

  it("lets a bulk word win over a package word (toward bulk, D2), and knows nothing it was not told", () => {
    expect(packageTypeFromPrinted("4 totes of drums")).toBe("ibc_tote");
    expect(packageTypeFromPrinted("1 TT")).toBe("");
    expect(packageTypeFromPrinted(null)).toBe("");
  });
});
