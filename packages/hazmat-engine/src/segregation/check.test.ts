import { describe, expect, it } from "vitest";
import { checkSegregation, evaluateLoad } from "../index.js";
import type { LoadInput } from "../types.js";

/**
 * Developer unit tests for checkSegregation (§177.848(d)). Synthetic dataset: entries (for class
 * resolution) + a small slice of the real segregation grid (verified values: 3↔5.1 = O away-from,
 * 3↔1.1/1.2 = X prohibited, 3↔2.1 = no restriction).
 */
const DS = {
  version: "seg-test",
  provisional: false,
  entries: [
    { entryId: "gas", hazardClass: "3" },
    { entryId: "lpg", hazardClass: "2.1" },
    { entryId: "oxidizer", hazardClass: "5.1" },
    { entryId: "explosive", hazardClass: "1.1D" },
    { entryId: "hot", hazardClass: "9" },
  ],
  placards: [{ classOrDivision: "3", table: 2, placardName: "FLAMMABLE", designRef: "172.542", wordingOptions: [] }],
  erg: [],
  segregation: [
    { rowClass: "3", colClass: "5.1", value: "O", notes: null },
    { rowClass: "3", colClass: "1.1 1.2", value: "X", notes: null },
    { rowClass: "5.1", colClass: "8 liquids only", value: "O", notes: null },
  ],
};

const mkLine = (entryId: string) =>
  ({
    hmtRef: `${entryId}#x`, reclassedCombustible: false, quantity: { value: 100, unit: "gal" },
    grossWeightLb: 20000, compartmentIndex: null, isResidueLine: false, flashPointF: null, ethanolPct: null,
    packagingKind: "bulk", packageCount: null,
  }) as unknown as LoadInput["lines"][number];

const mkLoad = (entryIds: string[]): LoadInput =>
  ({
    evaluatedAt: "2026-07-30T00:00:00Z",
    vehicle: { kind: "cargo_tank", cargoTankCapacityGal: 9000, compartments: null },
    tankState: "loaded", lines: entryIds.map(mkLine),
    claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: [] },
    portContext: { vesselConnected: null, imdgPapers: null },
    tripContext: { previousOrCurrentBusinessDayIds: null, carrierRelationship: "unknown" },
    policy: null, dataset: DS,
  }) as unknown as LoadInput;

const ids = (r: ReturnType<typeof checkSegregation>) => r.findings.map((f) => f.ruleId);

describe("checkSegregation — §177.848(d)", () => {
  it("single hazard class → no restriction (info)", () => {
    const r = checkSegregation(mkLoad(["gas"]));
    expect(ids(r)).toEqual(["segregation_none"]);
    expect(r.hasViolation).toBe(false);
  });

  it("gasoline (3) + LPG (2.1) → compatible, no restriction", () => {
    const r = checkSegregation(mkLoad(["gas", "lpg"]));
    expect(ids(r)).toEqual(["segregation_none"]);
    expect(r.hasViolation).toBe(false);
  });

  it("gasoline (3) + oxidizer (5.1) → 'Away From' conditional (O)", () => {
    const r = checkSegregation(mkLoad(["gas", "oxidizer"]));
    expect(ids(r)).toContain("segregation_away_from");
    const f = r.findings.find((x) => x.ruleId === "segregation_away_from")!;
    expect(f.tier).toBe("conditional");
    expect(f.citations[0]!.cfr).toBe("49 CFR 177.848(d)");
    expect(r.hasViolation).toBe(false);
  });

  it("gasoline (3) + explosive (1.1D) → PROHIBITED (X), a violation", () => {
    const r = checkSegregation(mkLoad(["gas", "explosive"]));
    expect(ids(r)).toContain("segregation_prohibited");
    expect(r.findings.find((x) => x.ruleId === "segregation_prohibited")!.tier).toBe("violation");
    expect(r.hasViolation).toBe(true);
  });

  it("class 9 (elevated-temp) with fuel → not in the grid, no restriction", () => {
    const r = checkSegregation(mkLoad(["gas", "hot"]));
    expect(ids(r)).toEqual(["segregation_none"]);
  });

  it("evaluateLoad surfaces segregation on the verdict and BLOCKS on a prohibition", () => {
    const clean = evaluateLoad(mkLoad(["gas", "oxidizer"]));
    expect(clean.segregation.map((f) => f.ruleId)).toContain("segregation_away_from");
    expect(clean.eligibility.status).toBe("not_checked");

    const blocked = evaluateLoad(mkLoad(["gas", "explosive"]));
    expect(blocked.segregation.map((f) => f.ruleId)).toContain("segregation_prohibited");
    expect(blocked.eligibility.status).toBe("blocked");
  });
});
