import { describe, expect, it } from "vitest";
import { validateBol } from "../index.js";
import type { LoadInput } from "../types.js";

const DATASET = {
  version: "bol-test", provisional: false,
  entries: [
    { entryId: "UN1203-gasoline", symbols: [], psnPrinted: "Gasoline", psnAlternates: [], hazardClass: "3", subsidiaryClasses: [], idPrefix: "UN", idNumber: "1203", pgRows: [{ pg: "II" }] },
    { entryId: "UN1202-diesel-fuel", symbols: [], psnPrinted: "Diesel fuel", psnAlternates: [], hazardClass: "3", subsidiaryClasses: [], idPrefix: "UN", idNumber: "1202", pgRows: [{ pg: "III" }] },
    { entryId: "UN1075-lpg", symbols: [], psnPrinted: "Petroleum gases, liquefied", psnAlternates: ["Liquefied petroleum gas"], hazardClass: "2.1", subsidiaryClasses: [], idPrefix: "UN", idNumber: "1075", pgRows: [{ pg: null }] },
    { entryId: "UN3257-hot", symbols: ["G"], psnPrinted: "Elevated temperature liquid, n.o.s.", psnAlternates: [], hazardClass: "9", subsidiaryClasses: [], idPrefix: "UN", idNumber: "3257", pgRows: [{ pg: "III" }] },
  ],
  hazSubstances: [{ nameNormalized: "benzene" }],
  marinePollutants: [{ nameNormalized: "an example pollutant", severe: false }],
};

const line = (over: Record<string, unknown> = {}) =>
  ({ hmtRef: "UN1203-gasoline#II", reclassedCombustible: false, quantity: { value: 5000, unit: "gal" }, grossWeightLb: 30000, compartmentIndex: null, isResidueLine: false, flashPointF: null, ethanolPct: null, packagingKind: "bulk", packageCount: null, ...over }) as unknown as LoadInput["lines"][number];

const load = (lines: unknown[]): LoadInput =>
  ({ evaluatedAt: "2026-07-30T00:00:00Z", vehicle: { kind: "cargo_tank", cargoTankCapacityGal: 9000, compartments: null }, tankState: "loaded", lines, claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: [] }, portContext: { vesselConnected: null, imdgPapers: null }, tripContext: { previousOrCurrentBusinessDayIds: null, carrierRelationship: "unknown" }, policy: null, dataset: DATASET }) as unknown as LoadInput;

const ids = (r: ReturnType<typeof validateBol>) => r.findings.map((f) => f.ruleId);

describe("validateBol — §172.202/172.203 shipping-paper compliance", () => {
  it("builds the §172.202(a) basic description in ID, PSN, class, PG order", () => {
    const r = validateBol(load([line()]));
    expect(r.lines[0]!.basicDescription).toBe("UN1203, Gasoline, 3, II");
  });

  it("drops the PG for a Class 2 gas and flags a PG that shouldn't be there", () => {
    const ok = validateBol(load([line({ hmtRef: "UN1075-lpg#none" })]));
    expect(ok.lines[0]!.basicDescription).toBe("UN1075, Petroleum gases, liquefied, 2.1");
    const bad = validateBol(load([line({ hmtRef: "UN1075-lpg#II" })]));
    expect(ids(bad)).toContain("bol_pg_not_allowed");
    expect(bad.findings.find((f) => f.ruleId === "bol_pg_not_allowed")!.tier).toBe("violation");
  });

  it("uses the combustible-liquid description for a §173.150(f) election", () => {
    const r = validateBol(load([line({ hmtRef: "UN1202-diesel-fuel#III", reclassedCombustible: true })]));
    expect(r.lines[0]!.basicDescription).toBe("UN1202, Diesel fuel, Combustible liquid, III");
    expect(r.findings.find((f) => f.ruleId === "bol_basic_description")!.citations.some((c) => c.interpretation === "PHMSA 15-0187R")).toBe(true);
  });

  it("requires the technical name for a G / n.o.s. entry (§172.203(k))", () => {
    const r = validateBol(load([line({ hmtRef: "UN3257-hot#III" })]));
    expect(r.lines[0]!.additionalRequired.some((a) => /technical name/.test(a))).toBe(true);
    expect(ids(r)).toContain("bol_additional_description_required");
  });

  it("does NOT flag RQ for petroleum fuels (CERCLA exclusion)", () => {
    const r = validateBol(load([line()]));
    expect(r.lines[0]!.additionalRequired.some((a) => /RQ/.test(a))).toBe(false);
  });

  it("always lists the load-level required shipping-paper elements", () => {
    const r = validateBol(load([line()]));
    for (const id of ["bol_emergency_phone_required", "bol_certification_required", "bol_identification_required"]) {
      expect(ids(r)).toContain(id);
    }
  });

  it("fails closed on an unresolvable line", () => {
    const r = validateBol(load([line({ hmtRef: "UN9999-mystery#II" })]));
    expect(ids(r)).toContain("bol_line_unresolved");
  });
});
