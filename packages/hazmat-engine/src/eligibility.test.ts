import { describe, expect, it } from "vitest";
import { evaluateLoad } from "./index.js";
import type { LoadInput } from "./types.js";

/**
 * M5.2/M5.3 — eligibility is REACHABLE (closing G1/G3/G4), and only honestly:
 * every check clean + every provided input evaluated + dataset complete enough to check (G8).
 */
const DATASET = {
  version: "test-1", provisional: false,
  entries: [
    { entryId: "UN1203-gasoline", psnPrinted: "Gasoline", hazardClass: "3", idPrefix: "UN", idNumber: "1203", pgRows: [{ pg: "II" }] },
    { entryId: "UN1202-diesel-fuel", psnPrinted: "Diesel fuel", hazardClass: "3", idPrefix: "UN", idNumber: "1202", pgRows: [{ pg: "III" }] },
  ],
  placards: [
    { classOrDivision: "3", table: 2, placardName: "FLAMMABLE", designRef: "172.542", wordingOptions: ["GASOLINE"] },
  ],
  // A present (non-empty) segregation grid — G8's precondition for `eligible`.
  segregation: [{ classA: "3", classB: "8", code: "O" }],
  erg: [{ idNumber: "1203", guideNumber: "128" }],
  hazSubstances: [], marinePollutants: [],
};

/** A line with NO optional extras — nothing for the input audit to flag. */
const cleanLine = (): Record<string, unknown> => ({
  hmtRef: "UN1203-gasoline#II", reclassedCombustible: false,
  quantity: { value: 5000, unit: "gal" }, grossWeightLb: 32000,
  compartmentIndex: null, isResidueLine: false, flashPointF: null, ethanolPct: null,
  packagingKind: "bulk", packageCount: null,
});

const cleanLoad = (over: Partial<LoadInput> = {}): LoadInput =>
  ({
    evaluatedAt: "2026-08-05T00:00:00Z",
    vehicle: { kind: "cargo_tank", cargoTankCapacityGal: null, compartments: null },
    tankState: "loaded", lines: [cleanLine()],
    claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: [] },
    portContext: { vesselConnected: null, imdgPapers: null },
    tripContext: { previousOrCurrentBusinessDayIds: null, carrierRelationship: "carrier_supplied_cargo_tank" },
    policy: null, dataset: DATASET, ...over,
  }) as unknown as LoadInput;

describe("checkEligibility via evaluateLoad (M5.2 — G1/G3/G4)", () => {
  it("a fully-clean load REACHES eligible — G3 is closed", () => {
    const v = evaluateLoad(cleanLoad());
    expect(v.eligibility.status).toBe("eligible");
    expect(v.eligibility.blocks.filter((b) => b.tier === "violation" || b.tier === "conditional")).toEqual([]);
    expect(v.trace.some((t) => t.ruleId === "eligibility_decision")).toBe(true);
  });

  it("a provisional dataset can never be eligible", () => {
    const v = evaluateLoad(cleanLoad({ dataset: { ...DATASET, provisional: true } as LoadInput["dataset"] }));
    expect(v.eligibility.status).toBe("not_checked");
  });

  it("G8: a missing segregation grid yields an explicit finding and blocks eligible", () => {
    const noGrid = { ...DATASET, segregation: [] };
    const v = evaluateLoad(cleanLoad({ dataset: noGrid as LoadInput["dataset"] }));
    expect(v.eligibility.status).toBe("not_checked");
    expect(v.segregation.map((f) => f.ruleId)).toContain("segregation_grid_unavailable");
  });

  it("carrierRelationship does NOT block eligibility (deliberate audit exclusion — §172.506 supply duty)", () => {
    const v = evaluateLoad(cleanLoad({ tripContext: { previousOrCurrentBusinessDayIds: null, carrierRelationship: "unknown" } as LoadInput["tripContext"] }));
    expect(v.eligibility.status).toBe("eligible");
  });
});

describe("input audit (M5.3 — G5: nothing accepted and silently ignored)", () => {
  const cases: Array<[string, Partial<LoadInput>, string]> = [
    ["policy", { policy: { anything: true } as unknown as LoadInput["policy"] }, "not_evaluated:policy"],
    ["cargo tank capacity", { vehicle: { kind: "cargo_tank", cargoTankCapacityGal: 9000, compartments: null } as LoadInput["vehicle"] }, "not_evaluated:vehicle.cargoTankCapacityGal"],
    ["residue tank state", { tankState: "residue_uncleaned" as LoadInput["tankState"] }, "not_evaluated:tankState=residue_uncleaned"],
    ["claimed no-placards", { claimedExceptions: { shipperClaimsNoPlacards: true, claimedSpecialPermits: [] } as LoadInput["claimedExceptions"] }, "not_evaluated:claimedExceptions.shipperClaimsNoPlacards"],
    ["special permits", { claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: ["DOT-SP 12345"] } as LoadInput["claimedExceptions"] }, "not_evaluated:claimedExceptions.claimedSpecialPermits"],
    ["port context", { portContext: { vesselConnected: true, imdgPapers: null } as LoadInput["portContext"] }, "not_evaluated:portContext.vesselConnected"],
    ["business-day IDs", { tripContext: { previousOrCurrentBusinessDayIds: ["UN1203"], carrierRelationship: "unknown" } as LoadInput["tripContext"] }, "not_evaluated:tripContext.previousOrCurrentBusinessDayIds"],
  ];
  for (const [label, over, expected] of cases) {
    it(`${label} provided → explicit conditional + not_checked (never silent)`, () => {
      const v = evaluateLoad(cleanLoad(over));
      expect(v.eligibility.status).toBe("not_checked");
      expect(v.eligibility.blocks.map((b) => b.ruleId)).toContain(expected);
    });
  }

  it("line-level extras are audited per line with their index", () => {
    const v = evaluateLoad(cleanLoad({ lines: [{ ...cleanLine(), flashPointF: -45 }] as unknown as LoadInput["lines"] }));
    expect(v.eligibility.status).toBe("not_checked");
    expect(v.eligibility.blocks.map((b) => b.ruleId)).toContain("not_evaluated:lines[0].flashPointF");
  });

  it("packageCount is EVALUATED since 0.9.0 (H-P1) — providing it never blocks auto-clear", () => {
    const v = evaluateLoad(cleanLoad({ lines: [{ ...cleanLine(), packageCount: 4 }] as unknown as LoadInput["lines"] }));
    expect(v.eligibility.blocks.map((b) => b.ruleId)).not.toContain("not_evaluated:lines[0].packageCount");
    // …and it lands in the §172.504(c) evidence rather than the ignored list.
    const threshold = v.trace.find((t) => t.ruleId === "weight_threshold_1001lb");
    expect(threshold === undefined || "countedPackages" in (threshold.inputs ?? {})).toBe(true);
  });

  it("the audit trace lists every unevaluated provided path", () => {
    const v = evaluateLoad(cleanLoad({ policy: { x: 1 } as unknown as LoadInput["policy"] }));
    const audit = v.trace.find((t) => t.ruleId === "input_audit");
    expect(audit?.fired).toBe(true);
    expect((audit?.inputs.unevaluatedProvided as string[])).toContain("policy");
  });
});

describe("validateBol folded into evaluateLoad (M5.2 — G2)", () => {
  it("the verdict carries the §172.202 basic descriptions", () => {
    const v = evaluateLoad(cleanLoad());
    expect(v.bol?.lines[0]?.basicDescription).toBe("UN1203, Gasoline, 3, II");
  });

  it("an unresolvable line blocks eligibility via a bol conditional", () => {
    const v = evaluateLoad(cleanLoad({ lines: [{ ...cleanLine(), hmtRef: "UN9999-nonsense#II" }] as unknown as LoadInput["lines"] }));
    expect(v.eligibility.status).toBe("not_checked");
    expect(v.eligibility.blocks.map((b) => b.ruleId)).toContain("bol_line_unresolved");
  });
});
