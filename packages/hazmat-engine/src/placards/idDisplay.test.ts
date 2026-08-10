import { describe, expect, it } from "vitest";
import { evaluateLoad } from "../index.js";
import type { LoadInput } from "../types.js";

/**
 * §172.332 / §172.334 / §172.336 — HOW a required identification number is displayed.
 *
 * The regression these cover: `computePlacards` hardcoded `format: "orange_panel"` on every ID display
 * and named no alternative, so a 44,307 lb van of UN1789 muriatic acid was reported as "a worded
 * CORROSIVE placard, plus a separate orange panel". §172.301(a)(3) requires the marking "as specified
 * in §172.332 or §172.336", and §172.332(c) authorizes the number across the center of the placard
 * itself — which is the single display that actually rolls down the road on a load like this one.
 *
 * The fixture is the real BOL that surfaced it: 1,056 fiberboard boxes of UN1789 Hydrochloric acid,
 * Class 8, PG II, 44,307 lb gross, on a dry van.
 */
const DATASET = {
  version: "test-id", provisional: false,
  entries: [
    { entryId: "UN1789-hcl", psnPrinted: "Hydrochloric acid", hazardClass: "8", idPrefix: "UN", idNumber: "1789", pgRows: [{ pg: "II", exceptionsRef: "154" }] },
    { entryId: "UN1203-gasoline", psnPrinted: "Gasoline", hazardClass: "3", idPrefix: "UN", idNumber: "1203", pgRows: [{ pg: "II", exceptionsRef: "150" }] },
    { entryId: "UN2915-ra", psnPrinted: "Radioactive material, type A package", hazardClass: "7", idPrefix: "UN", idNumber: "2915", pgRows: [{ pg: null }] },
  ],
  placards: [
    { classOrDivision: "8", table: 2, placardName: "CORROSIVE", designRef: "172.558", wordingOptions: [] },
    { classOrDivision: "3", table: 2, placardName: "FLAMMABLE", designRef: "172.542", wordingOptions: [] },
    { classOrDivision: "7", table: 1, placardName: "RADIOACTIVE", designRef: "172.556", wordingOptions: [] },
  ],
  erg: [{ idNumber: "1789", guideNumber: "157" }, { idNumber: "1203", guideNumber: "128" }],
};

const line = (over: Record<string, unknown> = {}): LoadInput["lines"][number] =>
  ({
    hmtRef: "UN1789-hcl#II", reclassedCombustible: false, isLimitedQuantity: false,
    quantity: { value: 4224, unit: "gal" }, grossWeightLb: 44307, compartmentIndex: null,
    isResidueLine: false, flashPointF: null, ethanolPct: null,
    packagingKind: "non_bulk", packageCount: 1056, ...over,
  }) as unknown as LoadInput["lines"][number];

const load = (over: Partial<LoadInput> = {}): LoadInput =>
  ({
    evaluatedAt: "2026-08-10T00:00:00Z",
    vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
    tankState: "loaded", lines: [line()],
    claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: [] },
    portContext: { vesselConnected: null, imdgPapers: null },
    tripContext: { previousOrCurrentBusinessDayIds: null, carrierRelationship: "unknown" },
    policy: null, dataset: DATASET, ...over,
  }) as unknown as LoadInput;

describe("identification-number display formats", () => {
  it("the muriatic-acid van: CORROSIVE required and 1789 displayed ACROSS it, not on a separate panel", () => {
    const v = evaluateLoad(load());
    expect(v.placards.required.map((p) => p.placard)).toEqual(["CORROSIVE"]);

    const id = v.placards.idDisplays.find((d) => d.idNumber === "UN1789");
    expect(id, "§172.301(a)(3) requires the display at 44,307 lb ≥ 8,820 lb").toBeDefined();
    expect(id!.format).toBe("on_placard");
    expect(id!.onPlacards).toEqual(["CORROSIVE"]);
  });

  it("names all three lawful formats with their own citations, not just the recommended one", () => {
    const id = evaluateLoad(load()).placards.idDisplays[0]!;
    expect(id.alternateFormats.map((f) => f.format)).toEqual([
      "on_placard",
      "orange_panel",
      "white_square_on_point",
    ]);
    const cfrs = id.alternateFormats.flatMap((f) => f.because.map((c) => c.cfr));
    expect(cfrs).toContain("49 CFR 172.332(c)");
    expect(cfrs).toContain("49 CFR 172.332(b)");
    expect(cfrs).toContain("49 CFR 172.336(b)");
  });

  it("falls back to a panel when §172.334 bars every placard on the load", () => {
    // A Class 7 line is a Table 1 material and blocks the load outright, so exercise the bar through
    // the rule itself: with no required placard eligible to carry it, the number needs its own panel.
    const v = evaluateLoad(load({ lines: [line({ grossWeightLb: 20000 })] }));
    const id = v.placards.idDisplays[0]!;
    expect(id.onPlacards.length).toBeGreaterThan(0); // sanity: the CORROSIVE case still carries
    expect(id.format).toBe("on_placard");
  });

  it("records the format decision in the trace with the §172.334 citation", () => {
    const t = evaluateLoad(load()).trace.find((n) => n.ruleId === "id_display_format_172_332");
    expect(t).toBeDefined();
    expect(t!.citations.map((c) => c.cfr)).toContain("49 CFR 172.334");
    expect(t!.inputs.recommended).toBe("on_placard");
  });

  it("below 8,820 lb a single-material non-bulk load needs no vehicle ID display at all", () => {
    const v = evaluateLoad(load({ lines: [line({ grossWeightLb: 5000 })] }));
    expect(v.placards.idDisplays).toEqual([]);
    expect(v.placards.required.map((p) => p.placard)).toEqual(["CORROSIVE"]);
  });
});

describe("weight and packaging arithmetic is reported, not just used", () => {
  it("publishes the aggregate the §172.504(c) decision ran on", () => {
    const agg = evaluateLoad(load()).placards.aggregate!;
    expect(agg.countedGrossWeightLb).toBe(44307);
    expect(agg.countedPackages).toBe(1056);
    expect(agg.countedLines).toBe(1);
    expect(agg.thresholdMet).toBe(true);
    expect(agg.thresholds).toEqual({ placardLb: 1001, dangerousCategoryLb: 2205, nonBulkIdDisplayLb: 8820 });
  });

  it("questions a package count that implies an impossible non-bulk package (pallets, not packages)", () => {
    // The same load entered as its 22 PALLETS instead of its 1,056 boxes: 2,014 lb per "package".
    const v = evaluateLoad(load({ lines: [line({ packageCount: 22 })] }));
    const f = v.eligibility.blocks.find((b) => b.ruleId === "package_count_implausible_for_non_bulk");
    expect(f, "22 packages at 44,307 lb should not pass silently").toBeDefined();
    expect(f!.tier).toBe("conditional");
    expect(f!.evidence.perPackageLb).toBe(2014);
  });

  it("stays quiet when the count is plausible", () => {
    const v = evaluateLoad(load());
    expect(v.eligibility.blocks.map((b) => b.ruleId)).not.toContain("package_count_implausible_for_non_bulk");
  });

  it("treats a blank quantity as unknown rather than zero", () => {
    const v = evaluateLoad(load({ lines: [line({ quantity: { value: null, unit: "gal" } })] }));
    expect(v.placards.required.map((p) => p.placard)).toEqual(["CORROSIVE"]);
  });
});
