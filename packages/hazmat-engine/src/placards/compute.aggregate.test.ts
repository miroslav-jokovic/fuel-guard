import { describe, expect, it } from "vitest";
import { computePlacards } from "./compute.js";
import type { LoadInput } from "../types.js";

/**
 * F-P3 — the §172.504(c) aggregate and the §172.504(b) DANGEROUS restrictions.
 *
 * The code summed every Table 2 line regardless of packaging, so a cargo tank under 1,001 lb came back
 * with NO placards — a cargo tank is bulk packaging and the threshold has never applied to it. It also
 * offered DANGEROUS on cargo tanks, where the rule is a hard block, and ignored the 2,205 lb
 * single-category bar entirely. All three were documented in the plan and none were code.
 */

const PLACARDS = [
  { classOrDivision: "1.4", table: 2 as const, placardName: "EXPLOSIVES 1.4", designRef: "172.523", wordingOptions: [] },
  { classOrDivision: "3", table: 2 as const, placardName: "FLAMMABLE", designRef: "172.542", wordingOptions: [] },
  { classOrDivision: "8", table: 2 as const, placardName: "CORROSIVE", designRef: "172.558", wordingOptions: [] },
  { classOrDivision: "5.1", table: 2 as const, placardName: "OXIDIZER", designRef: "172.550", wordingOptions: [] },
];

const ENTRY = (id: string, cls: string, sps: string[] = [], subs: string[] = []) => ({
  entryId: id, psnPrinted: id, hazardClass: cls, subsidiaryClasses: subs,
  idPrefix: "UN" as const, idNumber: id.replace(/\D/g, "") || "1203",
  pgRows: [{ pg: "II" as const, specialProvisions: sps }],
});

const LINE = (entryId: string, over: Partial<LoadInput["lines"][number]> = {}) => ({
  hmtRef: `${entryId}#II`,
  quantity: { value: 100, unit: "gal" as const },
  packagingKind: "non_bulk" as const,
  grossWeightLb: 500,
  compartmentIndex: null,
  isResidueLine: false,
  reclassedCombustible: false,
  ...over,
});

function load(over: Partial<LoadInput> & { entries: ReturnType<typeof ENTRY>[] }): LoadInput {
  const { entries, ...rest } = over;
  return {
    evaluatedAt: "2026-08-07T00:00:00.000Z",
    vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
    tankState: "loaded",
    lines: [],
    claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: [] },
    portContext: { vesselConnected: null, imdgPapers: null },
    tripContext: { previousOrCurrentBusinessDayIds: [], carrierRelationship: "unknown" },
    policy: null,
    dataset: { version: "test", provisional: false, entries, placards: PLACARDS, erg: [] },
    ...rest,
  } as unknown as LoadInput;
}

const names = (r: ReturnType<typeof computePlacards>) => r.placards.required.map((p) => p.placard);

describe("§172.504(c) — what the 1,001 lb aggregate governs", () => {
  it("a cargo tank placards at ANY quantity — the threshold never applies to bulk", () => {
    const r = computePlacards(load({
      entries: [ENTRY("UN1203", "3")],
      vehicle: { kind: "cargo_tank", cargoTankCapacityGal: 9200, compartments: null },
      lines: [LINE("UN1203", { packagingKind: "bulk", grossWeightLb: 200 })],
    } as never));
    expect(names(r)).toContain("FLAMMABLE");
  });

  it("a non-bulk load under the threshold requires nothing but PERMITS the placard (§172.502(c))", () => {
    const r = computePlacards(load({
      entries: [ENTRY("UN1203", "3")],
      lines: [LINE("UN1203", { grossWeightLb: 400 })],
    } as never));
    expect(r.placards.required).toHaveLength(0);
    expect(r.placards.permitted.map((p) => p.placard)).toEqual(["FLAMMABLE"]);
  });

  it("residue-only non-bulk lines are excluded from the aggregate", () => {
    // 900 real + 900 residue. Counting the residue would cross 1,001 lb; excluding it must not.
    const r = computePlacards(load({
      entries: [ENTRY("UN1203", "3"), ENTRY("UN1789", "8")],
      lines: [LINE("UN1203", { grossWeightLb: 900 }), LINE("UN1789", { grossWeightLb: 900, isResidueLine: true })],
    } as never));
    expect(r.placards.required).toHaveLength(0);
    expect(r.findings.map((f) => f.ruleId)).toContain("residue_excluded_from_aggregate");
  });

  it("a bulk line placards even while its non-bulk companions stay under the threshold", () => {
    const r = computePlacards(load({
      entries: [ENTRY("UN1203", "3"), ENTRY("UN1789", "8")],
      lines: [LINE("UN1203", { packagingKind: "bulk", grossWeightLb: 100 }), LINE("UN1789", { grossWeightLb: 200 })],
    } as never));
    expect(names(r)).toEqual(["FLAMMABLE"]);
    expect(r.placards.permitted.map((p) => p.placard)).toEqual(["CORROSIVE"]);
  });

  it("unknown weight still placards conservatively", () => {
    const r = computePlacards(load({
      entries: [ENTRY("UN1203", "3")],
      lines: [LINE("UN1203", { grossWeightLb: null })],
    } as never));
    expect(names(r)).toContain("FLAMMABLE");
    expect(r.findings.map((f) => f.ruleId)).toContain("aggregate_weight_unknown");
  });
});

describe("§172.504(b) — DANGEROUS", () => {
  it("is PROHIBITED on a cargo tank, never merely unoffered", () => {
    const r = computePlacards(load({
      entries: [ENTRY("UN1203", "3"), ENTRY("UN1789", "8")],
      vehicle: { kind: "cargo_tank", cargoTankCapacityGal: 9200, compartments: null },
      lines: [LINE("UN1203", { packagingKind: "bulk" }), LINE("UN1789", { packagingKind: "bulk" })],
    } as never));
    expect(r.placards.prohibited.map((p) => p.placard)).toContain("DANGEROUS");
    expect(r.placards.optionalSubstitutions.some((s) => s.use === "DANGEROUS")).toBe(false);
  });

  it("is offered for two non-bulk categories that are each under the 2,205 lb bar", () => {
    const r = computePlacards(load({
      entries: [ENTRY("UN1203", "3"), ENTRY("UN1789", "8")],
      lines: [LINE("UN1203", { grossWeightLb: 900 }), LINE("UN1789", { grossWeightLb: 900 })],
    } as never));
    expect(r.placards.optionalSubstitutions.filter((s) => s.use === "DANGEROUS")).toHaveLength(2);
  });

  it("a category at or over 2,205 lb keeps its own placard and drops out of the substitution", () => {
    const r = computePlacards(load({
      entries: [ENTRY("UN1203", "3"), ENTRY("UN1789", "8"), ENTRY("UN1479", "5.1")],
      lines: [
        LINE("UN1203", { grossWeightLb: 3000 }),
        LINE("UN1789", { grossWeightLb: 900 }),
        LINE("UN1479", { grossWeightLb: 900 }),
      ],
    } as never));
    const subs = r.placards.optionalSubstitutions.filter((s) => s.use === "DANGEROUS").map((s) => s.instead);
    expect(subs).not.toContain("FLAMMABLE");
    expect(subs.sort()).toEqual(["CORROSIVE", "OXIDIZER"]);
  });
});

describe("§172.505 — subsidiary placards", () => {
  it("a Table 2 material asserting poison-by-inhalation also needs POISON INHALATION HAZARD", () => {
    const r = computePlacards(load({
      entries: [ENTRY("UN1789", "8", ["2"])],
      lines: [LINE("UN1789", { grossWeightLb: 100 })],
    } as never));
    expect(names(r)).toContain("POISON_INHALATION_HAZARD");
    expect(names(r)).toContain("CORROSIVE"); // and it placards regardless of the aggregate
  });

  it("a subsidiary 4.3 also needs DANGEROUS WHEN WET", () => {
    const r = computePlacards(load({
      entries: [ENTRY("UN1479", "5.1", [], ["4.3"])],
      lines: [LINE("UN1479", { grossWeightLb: 100 })],
    } as never));
    expect(names(r)).toContain("DANGEROUS_WHEN_WET");
  });
});

describe("D4 — explosives are Table 2 rows but deferred logic", () => {
  /**
   * §172.504(e) puts 1.4/1.5/1.6 in Table 2 and the dataset is right to record that. D4 defers
   * explosives *logic*, which is a different statement — so the engine blocks rather than emitting a
   * bare diamond. Editing the dataset to call them Table 1 was rejected: the dataset states the
   * regulation, and the parser asserts its own table signatures so no row can be quietly moved.
   */
  it("blocks an explosives load instead of computing a placard for it", () => {
    const r = computePlacards(load({
      entries: [ENTRY("UN0336", "1.4")],
      lines: [LINE("UN0336", { grossWeightLb: 5000 })],
    } as never));
    expect(r.placards.required).toHaveLength(0);
    const block = r.findings.find((f) => f.ruleId === "explosives_out_of_scope_v1");
    expect(block?.tier).toBe("violation");
  });

  it("blocks the WHOLE load — a companion Table 2 line gets no placard either", () => {
    const r = computePlacards(load({
      entries: [ENTRY("UN0336", "1.4"), ENTRY("UN1203", "3")],
      lines: [LINE("UN0336", { grossWeightLb: 5000 }), LINE("UN1203", { grossWeightLb: 5000 })],
    } as never));
    expect(r.placards.required).toHaveLength(0);
    expect(r.findings.map((f) => f.ruleId)).toContain("explosives_out_of_scope_v1");
  });

  it("leaves ordinary Table 2 loads alone", () => {
    const r = computePlacards(load({
      entries: [ENTRY("UN1203", "3")],
      lines: [LINE("UN1203", { grossWeightLb: 5000 })],
    } as never));
    expect(names(r)).toEqual(["FLAMMABLE"]);
  });
});
