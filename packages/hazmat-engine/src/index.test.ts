import { describe, expect, it } from "vitest";
import { evaluateLoad, ENGINE_VERSION, type LoadInput } from "./index";

const base = (over: Partial<LoadInput> = {}): LoadInput =>
  ({
    evaluatedAt: "2026-07-29T00:00:00Z",
    vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
    tankState: "loaded",
    lines: [],
    claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: [] },
    portContext: { vesselConnected: null, imdgPapers: null },
    tripContext: { previousOrCurrentBusinessDayIds: null, carrierRelationship: "unknown" },
    policy: null,
    dataset: { version: "2026.02", provisional: true },
    ...over,
  }) as LoadInput;

const gasLine = {
  hmtRef: "T-UN0002#III",
  reclassedCombustible: false,
  isLimitedQuantity: false,
  quantity: { value: 5000, unit: "gal" as const },
  grossWeightLb: 32000,
  compartmentIndex: null,
  isResidueLine: false,
  flashPointF: -45,
  ethanolPct: null,
  packagingKind: "bulk" as const,
  packageCount: null,
  marinePollutantConcentrationPct: null,
};

describe("evaluateLoad — H2 confirmed gates", () => {
  it("stamps engine + dataset versions on every verdict (D9/G6)", () => {
    const v = evaluateLoad(base());
    expect(v.engineVersion).toBe(ENGINE_VERSION);
    expect(v.datasetVersion).toBe("2026.02");
  });

  it("no hazmat lines → no placards, eligible, definitive (no review)", () => {
    const v = evaluateLoad(base({ lines: [] }));
    expect(v.placards.required).toEqual([]);
    expect(v.eligibility.status).toBe("eligible");
    expect(v.trace.find((t) => t.ruleId === "no_hazmat_load")?.fired).toBe(true);
  });

  it("cleaned-and-purged cargo tank → ALL placards prohibited (§172.502(a)/§172.303)", () => {
    const v = evaluateLoad(
      base({
        vehicle: { kind: "cargo_tank", cargoTankCapacityGal: 9000, compartments: null },
        tankState: "cleaned_and_purged",
        lines: [{ ...gasLine, isResidueLine: true }],
      }),
    );
    expect(v.placards.required).toEqual([]);
    expect(v.placards.prohibited.length).toBeGreaterThan(0);
    expect(v.placards.prohibited.some((p) => p.placard === "GASOLINE")).toBe(true);
  });

  it("a loaded hazmat line on a provisional dataset → fail-closed: no required placards + a conditional block", () => {
    const v = evaluateLoad(base({ lines: [gasLine] }));
    expect(v.placards.required).toEqual([]); // never under-placard, never fabricate
    expect(v.eligibility.status).toBe("not_checked");
    expect(v.eligibility.blocks.map((b) => b.ruleId)).toContain("placard_determination_withheld");
    expect(v.eligibility.blocks[0]?.tier).toBe("conditional");
  });
});
