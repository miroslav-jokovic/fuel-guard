import { describe, expect, it } from "vitest";
import type { Dataset } from "./schema.js";
import { evaluateSafetyPermitApplicability, SAFETY_PERMIT_APPLICABILITY } from "./safetyPermit.js";

// Minimal dataset — the evaluator only reads entryId, hazardClass, psnPrinted, subsidiaryClasses.
function ds(entries: Array<{ entryId: string; hazardClass: string | null; psnPrinted: string; subsidiaryClasses?: string[] }>): Dataset {
  return {
    entries: entries.map((e) => ({ ...e, subsidiaryClasses: e.subsidiaryClasses ?? [] })),
  } as unknown as Dataset;
}
const line = (hmtRef: string, quantityValue: number, quantityUnit: "gal" | "lb" | "kg" | "L", packagingKind: "bulk" | "non_bulk" = "non_bulk") =>
  ({ hmtRef, quantityValue, quantityUnit, packagingKind });

describe("evaluateSafetyPermitApplicability — §385.403(b) explosives", () => {
  const data = ds([
    { entryId: "E11", hazardClass: "1.1", psnPrinted: "Explosive, blasting, type A" },
    { entryId: "E15", hazardClass: "1.5", psnPrinted: "Explosive, blasting, type E" },
    { entryId: "GAS", hazardClass: "3", psnPrinted: "Gasoline" },
    { entryId: "RAD", hazardClass: "7", psnPrinted: "Radioactive material" },
    { entryId: "PIH", hazardClass: "2.3", psnPrinted: "Toxic gas", subsidiaryClasses: ["6.1"] },
  ]);

  it("is provisional / not yet attested", () => {
    expect(SAFETY_PERMIT_APPLICABILITY.attested).toBe(false);
    expect(SAFETY_PERMIT_APPLICABILITY.explosivesNetWeightKg).toBe(25);
  });

  it("triggers on Division 1.1 over 25 kg", () => {
    const r = evaluateSafetyPermitApplicability(data, [line("E11#none", 30, "kg")]);
    expect(r.required).toBe(true);
    expect(r.reasons[0]).toMatch(/385\.403\(b\)/);
  });

  it("does NOT trigger on Division 1.1 at or under 25 kg", () => {
    expect(evaluateSafetyPermitApplicability(data, [line("E11#none", 25, "kg")]).required).toBe(false);
    expect(evaluateSafetyPermitApplicability(data, [line("E11#none", 40, "lb")]).required).toBe(false); // 40 lb ≈ 18 kg
  });

  it("fail-closes a Division 1.1 line declared in a volume unit (no mass compare)", () => {
    const r = evaluateSafetyPermitApplicability(data, [line("E11#none", 100, "gal")]);
    expect(r.required).toBe(true);
    expect(r.indeterminateLines).toBe(1);
  });

  it("triggers on any placardable Division 1.5", () => {
    expect(evaluateSafetyPermitApplicability(data, [line("E15#none", 1, "kg")]).required).toBe(true);
  });

  it("does NOT trigger on non-explosives fuel (Gasoline, Class 3)", () => {
    expect(evaluateSafetyPermitApplicability(data, [line("GAS#II", 8000, "gal", "bulk")]).required).toBe(false);
  });

  it("records Class 7 and PIH candidates as undetected (not auto-triggered — SME/dataset pending)", () => {
    const r = evaluateSafetyPermitApplicability(data, [line("RAD#none", 5, "kg"), line("PIH#none", 5, "L")]);
    expect(r.required).toBe(false);
    expect(r.undetectedCandidates.some((c) => /Class 7/.test(c))).toBe(true);
    expect(r.undetectedCandidates.some((c) => /inhalation/i.test(c))).toBe(true);
  });
});
