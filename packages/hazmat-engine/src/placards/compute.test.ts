import { describe, expect, it } from "vitest";
import { evaluateLoad } from "../index.js";
import type { LoadInput } from "../types.js";

/**
 * Developer unit tests for computePlacards (fuel scope). NOTE: these are the IMPLEMENTER's tests, not
 * the certification golden suite — that is authored independently by the SME (D11), the same
 * independence discipline as the dataset's second source.
 *
 * A synthetic dataset (only the fields computePlacards reads) is passed through `load.dataset`, matching
 * the real @hazmat/data shape (entries + §172.504 placards + erg).
 */
const DATASET = {
  version: "test-1", provisional: false,
  entries: [
    { entryId: "UN1203-gasoline", psnPrinted: "Gasoline", hazardClass: "3", idPrefix: "UN", idNumber: "1203", pgRows: [{ pg: "II" }] },
    { entryId: "UN1202-diesel-fuel", psnPrinted: "Diesel fuel", hazardClass: "3", idPrefix: "UN", idNumber: "1202", pgRows: [{ pg: "III" }] },
    { entryId: "NA1993-fuel-oil", psnPrinted: "Fuel oil", hazardClass: "3", idPrefix: "NA", idNumber: "1993", pgRows: [{ pg: "III" }] },
    { entryId: "UN1075-lpg", psnPrinted: "Petroleum gases, liquefied", hazardClass: "2.1", idPrefix: "UN", idNumber: "1075", pgRows: [{ pg: null }] },
    { entryId: "UN3257-hot", psnPrinted: "Elevated temperature liquid, n.o.s.", hazardClass: "9", idPrefix: "UN", idNumber: "3257", pgRows: [{ pg: "III" }] },
    { entryId: "UN0027-blackpowder", psnPrinted: "Black powder", hazardClass: "1.1D", idPrefix: "UN", idNumber: "0027", pgRows: [{ pg: "II" }] },
  ],
  placards: [
    { classOrDivision: "3", table: 2, placardName: "FLAMMABLE", designRef: "172.542", wordingOptions: ["GASOLINE"] },
    { classOrDivision: "Combustible liquid", table: 2, placardName: "COMBUSTIBLE", designRef: "172.544", wordingOptions: ["FUEL OIL"] },
    { classOrDivision: "2.1", table: 2, placardName: "FLAMMABLE GAS", designRef: "172.532", wordingOptions: [] },
    { classOrDivision: "9", table: 2, placardName: "CLASS 9", designRef: "172.560", wordingOptions: [] },
    { classOrDivision: "1.1", table: 1, placardName: "EXPLOSIVES 1.1", designRef: "172.522", wordingOptions: [] },
  ],
  erg: [{ idNumber: "1203", guideNumber: "128" }, { idNumber: "1075", guideNumber: "115" }, { idNumber: "3257", guideNumber: "128" }],
};

const line = (over: Record<string, unknown> = {}): LoadInput["lines"][number] =>
  ({
    hmtRef: "UN1203-gasoline#II", reclassedCombustible: false, quantity: { value: 5000, unit: "gal" },
    grossWeightLb: 32000, compartmentIndex: null, isResidueLine: false, flashPointF: -45, ethanolPct: null,
    packagingKind: "bulk", packageCount: null, ...over,
  }) as unknown as LoadInput["lines"][number];

const load = (over: Partial<LoadInput> = {}): LoadInput =>
  ({
    evaluatedAt: "2026-07-30T00:00:00Z",
    vehicle: { kind: "cargo_tank", cargoTankCapacityGal: 9000, compartments: null },
    tankState: "loaded", lines: [line()],
    claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: [] },
    portContext: { vesselConnected: null, imdgPapers: null },
    tripContext: { previousOrCurrentBusinessDayIds: null, carrierRelationship: "unknown" },
    policy: null, dataset: DATASET, ...over,
  }) as unknown as LoadInput;

const names = (v: ReturnType<typeof evaluateLoad>) => v.placards.required.map((r) => r.placard);
const subs = (v: ReturnType<typeof evaluateLoad>) => v.placards.optionalSubstitutions.map((s) => `${s.instead}->${s.use}`);

describe("computePlacards — fuel scope (§172.504)", () => {
  it("gasoline cargo tank ≥1,001 lb → FLAMMABLE required, GASOLINE offered, UN1203 displayed, ERG 128", () => {
    const v = evaluateLoad(load());
    expect(names(v)).toEqual(["FLAMMABLE"]);
    expect(subs(v)).toContain("FLAMMABLE->GASOLINE");
    expect(v.placards.idDisplays.map((d) => d.idNumber)).toEqual(["UN1203"]);
    expect(v.placards.ergGuides).toContainEqual({ idNumber: "1203", guide: "128" });
  });

  it("below 1,001 lb non-bulk aggregate → no placards required (§172.504(c))", () => {
    const v = evaluateLoad(load({
      vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
      lines: [line({ grossWeightLb: 800, packagingKind: "non_bulk" })],
    }));
    expect(v.placards.required).toEqual([]);
    expect(v.trace.some((t) => t.ruleId === "weight_threshold_1001lb")).toBe(true);
    expect(v.eligibility.blocks.map((b) => b.ruleId)).not.toContain("aggregate_weight_unknown");
  });

  it("unknown weight on non-bulk material → placard conservatively + a weight-unknown conditional", () => {
    const v = evaluateLoad(load({
      vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
      lines: [line({ grossWeightLb: null, packagingKind: "non_bulk" })],
    }));
    expect(names(v)).toEqual(["FLAMMABLE"]);
    expect(v.eligibility.blocks.map((b) => b.ruleId)).toContain("aggregate_weight_unknown");
  });

  it("diesel elected combustible (§173.150(f)) → COMBUSTIBLE (with FUEL OIL only for actual fuel oil)", () => {
    const v = evaluateLoad(load({ lines: [line({ hmtRef: "UN1202-diesel-fuel#III", reclassedCombustible: true })] }));
    expect(names(v)).toEqual(["COMBUSTIBLE"]);
    expect(subs(v)).not.toContain("COMBUSTIBLE->FUEL_OIL"); // diesel isn't "Fuel oil"
    const fo = evaluateLoad(load({ lines: [line({ hmtRef: "NA1993-fuel-oil#III", reclassedCombustible: true })] }));
    expect(subs(fo)).toContain("COMBUSTIBLE->FUEL_OIL");
  });

  it("mixed gasoline + LPG on a non-bulk vehicle → both specific placards required + a DANGEROUS option for each (§172.504(b))", () => {
    const v = evaluateLoad(load({
      vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
      lines: [line({ grossWeightLb: 600, packagingKind: "non_bulk" }), line({ hmtRef: "UN1075-lpg#none", grossWeightLb: 600, packagingKind: "non_bulk" })],
    }));
    expect(names(v).sort()).toEqual(["FLAMMABLE", "FLAMMABLE_GAS"]);
    expect(subs(v)).toContain("FLAMMABLE->DANGEROUS");
    expect(subs(v)).toContain("FLAMMABLE_GAS->DANGEROUS");
  });

  it("elevated-temperature liquid (UN3257) → CLASS 9 + HOT mark (§172.325)", () => {
    const v = evaluateLoad(load({ lines: [line({ hmtRef: "UN3257-hot#III" })] }));
    expect(names(v)).toEqual(["CLASS_9"]);
    expect(v.placards.marks.map((m) => m.mark)).toContain("HOT");
  });

  it("a line that does not resolve → determination withheld, never a guess", () => {
    const v = evaluateLoad(load({ lines: [line({ hmtRef: "UN9999-mystery#II" })] }));
    expect(v.placards.required).toEqual([]);
    expect(v.eligibility.blocks.map((b) => b.ruleId)).toContain("placard_determination_withheld");
  });

  it("provisional dataset → placards computed for reference but flagged not-cleared", () => {
    const v = evaluateLoad(load({ dataset: { ...DATASET, provisional: true } as unknown as LoadInput["dataset"] }));
    expect(names(v)).toEqual(["FLAMMABLE"]);
    expect(v.eligibility.status).toBe("not_checked");
    expect(v.eligibility.blocks.map((b) => b.ruleId)).toContain("dataset_provisional");
  });

  it("stamps the bumped engine version", () => {
    expect(evaluateLoad(load()).engineVersion).toBe("0.15.0");
  });

  // D4-revised Table 1 gate: recognized and blocked, never assessed (fail-closed, D2).
  it("Table 1 material (explosive 1.1) → blocked, NO placards computed", () => {
    const v = evaluateLoad(load({ lines: [line({ hmtRef: "UN0027-blackpowder#II" })] }));
    expect(v.placards.required).toEqual([]);
    expect(v.placards.idDisplays).toEqual([]);
    expect(v.eligibility.status).toBe("blocked");
    const block = v.eligibility.blocks.find((b) => b.ruleId === "table1_out_of_scope_v1");
    expect(block?.tier).toBe("violation");
    expect(v.trace.some((t) => t.ruleId === "table1_out_of_scope_v1" && t.fired)).toBe(true);
  });

  it("a single Table 1 line poisons the whole load → no fuel placards emitted either", () => {
    const v = evaluateLoad(load({ lines: [line(), line({ hmtRef: "UN0027-blackpowder#II", grossWeightLb: 500 })] }));
    expect(v.placards.required).toEqual([]); // the in-scope gasoline placard is withheld too
    expect(v.eligibility.status).toBe("blocked");
    expect(v.eligibility.blocks.map((b) => b.ruleId)).toContain("table1_out_of_scope_v1");
  });

  // §172.301(a)(3) — the non-bulk single-material ID-display rule (R1, resolved from the CFR + PHMSA Chart 15)
  const flatbed = (over: Record<string, unknown> = {}): Partial<LoadInput> => ({
    vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
    lines: [line({ packagingKind: "non_bulk", ...over })],
  });

  it("non-bulk single material ≥ 8,820 lb → display the ID number (§172.301(a)(3))", () => {
    const v = evaluateLoad(load(flatbed({ grossWeightLb: 10000 })));
    expect(v.placards.idDisplays.map((d) => d.idNumber)).toEqual(["UN1203"]);
    expect(v.placards.idDisplays[0]!.because.some((c) => c.cfr === "49 CFR 172.301(a)(3)")).toBe(true);
    expect(v.eligibility.blocks.map((b) => b.ruleId)).toContain("nonbulk_single_material_id_display");
  });

  it("non-bulk single material below 8,820 lb → no vehicle ID display", () => {
    const v = evaluateLoad(load(flatbed({ grossWeightLb: 5000 })));
    expect(v.placards.idDisplays).toEqual([]);
    expect(v.eligibility.blocks.map((b) => b.ruleId)).not.toContain("nonbulk_single_material_id_display");
  });

  it("non-bulk with TWO different materials → not a §172.301(a)(3) single-material load", () => {
    const v = evaluateLoad(
      load({
        vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
        lines: [
          line({ packagingKind: "non_bulk", grossWeightLb: 6000 }),
          line({ hmtRef: "UN1202-diesel-fuel#III", packagingKind: "non_bulk", grossWeightLb: 6000 }),
        ],
      }),
    );
    expect(v.eligibility.blocks.map((b) => b.ruleId)).not.toContain("nonbulk_single_material_id_display");
  });
});

// ── 0.11.0 (H-MX): the mixed-load input — §172.301(a)(3)'s "no other material" condition ─────────
describe("otherFreightAboard — the §172.301(a)(3) no-other-material condition", () => {
  const nbSingle = (over: Partial<LoadInput> = {}): LoadInput =>
    load({
      vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
      lines: [line({ packagingKind: "non_bulk", grossWeightLb: 10000, packageCount: 40 })],
      ...over,
    });

  it("unknown (null / omitted) → asserted conservatively with both assumptions (pre-0.11 behavior)", () => {
    const v = evaluateLoad(nbSingle());
    expect(v.placards.idDisplays.map((d) => d.idNumber)).toEqual(["UN1203"]);
    const f = v.eligibility.blocks.find((b) => b.ruleId === "nonbulk_single_material_id_display");
    expect(f).toBeDefined();
    expect(f!.message).toContain("no-other-material");
  });

  it("other freight aboard (true) → the ID display is NOT required, said with the citation", () => {
    const v = evaluateLoad(nbSingle({ otherFreightAboard: true } as Partial<LoadInput>));
    expect(v.placards.idDisplays).toEqual([]);
    expect(v.eligibility.blocks.map((b) => b.ruleId)).not.toContain("nonbulk_single_material_id_display");
    const t = v.trace.find((n) => n.ruleId === "nonbulk_id_display_172_301");
    expect(t).toBeDefined();
    expect(t!.fired).toBe(false);
    // The finding is informational — it never blocks eligibility.
    expect(v.eligibility.status).not.toBe("blocked");
  });

  it("other freight aboard does NOT change the §172.504(c) placard answer", () => {
    const yes = evaluateLoad(nbSingle({ otherFreightAboard: true } as Partial<LoadInput>));
    const no = evaluateLoad(nbSingle({ otherFreightAboard: false } as Partial<LoadInput>));
    expect(yes.placards.required.map((p) => p.placard)).toEqual(no.placards.required.map((p) => p.placard));
    expect(yes.placards.aggregate!.countedGrossWeightLb).toBe(no.placards.aggregate!.countedGrossWeightLb);
  });

  it("confirmed hazmat-only (false) → required, and only the loading-facility assumption remains", () => {
    const v = evaluateLoad(nbSingle({ otherFreightAboard: false } as Partial<LoadInput>));
    expect(v.placards.idDisplays.map((d) => d.idNumber)).toEqual(["UN1203"]);
    const f = v.eligibility.blocks.find((b) => b.ruleId === "nonbulk_single_material_id_display");
    expect(f).toBeDefined();
    expect(f!.message).toContain("No other freight is declared aboard");
    expect(f!.message).not.toContain("no-other-material conditions");
  });

  it("other HAZMAT aboard (a bulk line) also fails the no-other-material condition — rule not applied", () => {
    const v = evaluateLoad(
      load({
        vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
        lines: [
          line({ packagingKind: "non_bulk", grossWeightLb: 10000 }),
          line({ hmtRef: "UN1202-diesel-fuel#III", packagingKind: "bulk", grossWeightLb: 9000 }),
        ],
      }),
    );
    expect(v.eligibility.blocks.map((b) => b.ruleId)).not.toContain("nonbulk_single_material_id_display");
    // The bulk line's own §172.302 display is unaffected.
    expect(v.placards.idDisplays.map((d) => d.idNumber)).toEqual(["UN1202"]);
  });
});

describe("loadProfile — the load type, stated (0.11.0)", () => {
  it("a cargo tank is a bulk load", () => {
    expect(evaluateLoad(load()).placards.loadProfile).toEqual({
      packaging: "bulk", hazmatLines: 1, distinctPlacardCategories: 1, otherFreightAboard: null,
    });
  });

  it("packages on a van are a non-bulk load; the input tri-state is echoed", () => {
    const v = evaluateLoad(load({
      vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
      lines: [line({ packagingKind: "non_bulk", grossWeightLb: 600 })],
      otherFreightAboard: true,
    } as Partial<LoadInput>));
    expect(v.placards.loadProfile).toEqual({
      packaging: "non_bulk", hazmatLines: 1, distinctPlacardCategories: 1, otherFreightAboard: true,
    });
  });

  it("a tote and drums together are mixed packaging with the categories counted", () => {
    const v = evaluateLoad(load({
      vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
      lines: [
        line({ packagingKind: "bulk", grossWeightLb: 2400 }),
        line({ hmtRef: "UN1075-lpg#none", packagingKind: "non_bulk", grossWeightLb: 900 }),
      ],
    }));
    expect(v.placards.loadProfile).toEqual({
      packaging: "mixed", hazmatLines: 2, distinctPlacardCategories: 2, otherFreightAboard: null,
    });
  });
});
